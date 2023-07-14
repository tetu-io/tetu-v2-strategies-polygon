/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {ControllerV2__factory, IController__factory, IERC20__factory, IERC20Metadata, IERC20Metadata__factory, IStrategyV2, StrategyBaseV2, StrategyBaseV2__factory, StrategySplitterV2, TetuVaultV2, UniswapV3ConverterStrategy, UniswapV3ConverterStrategy__factory, UniswapV3Reader,} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniswapV3StrategyUtils} from "../../../UniswapV3StrategyUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {IStateNum, IStateParams, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {depositToVault, printVaultState, rebalanceUniv3StrategyNoSwaps} from "../../../StrategyTestUtils";
import {BytesLike} from "ethers";
import {AggregatorUtils} from "../../../baseUT/utils/AggregatorUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: 'boolean',
      default: false,
    },
    hardhatChainId: {
      type: 'number',
      default: 137,
    },
  }).argv;

describe('UniswapV3ConverterStrategyNoSwapTest', function() {
  const ENTRY_TO_POOL_IS_ALLOWED = 1;
  const ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED = 2;
  const ENTRY_TO_POOL_WITH_REBALANCE = 3;
  const PLAN_SWAP_REPAY = 0;
  const PLAN_REPAY_SWAP_REPAY = 1;
  const PLAN_SWAP_ONLY = 2;

  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

//region Variables
  let snapshotBefore: string;

  let gov: SignerWithAddress;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

  let core: CoreAddresses;
  let strategy: UniswapV3ConverterStrategy;
  let vault: TetuVaultV2;
  let insurance: string;
  let splitter: StrategySplitterV2;
  let pool: string;
  let asset: string;
  let assetCtr: IERC20Metadata;
  let decimals: number;
  let stateParams: IStateParams;
  let reader: UniswapV3Reader;

  let strategyAsSigner: StrategyBaseV2;
  let strategyAsOperator: UniswapV3ConverterStrategy;
//endregion Variables

//region before, after
  before(async function() {
    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2] = await ethers.getSigners();
    gov = await Misc.impersonate(MaticAddresses.GOV_ADDRESS);

    core = Addresses.getCore() as CoreAddresses;
    pool = MaticAddresses.UNISWAPV3_USDC_USDT_100;
    asset = MaticAddresses.USDC_TOKEN;
    assetCtr = IERC20Metadata__factory.connect(asset, signer);
    decimals = await IERC20Metadata__factory.connect(asset, gov).decimals();
    reader = await MockHelper.createUniswapV3Reader(signer);

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset,
      'TetuV2_UniswapV3_USDC-USDT-0.01%',
      async(_splitterAddress: string) => {
        const _strategy = UniswapV3ConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          MaticAddresses.TETU_CONVERTER,
          pool,
          0,
          0,
        );

        return _strategy as unknown as IStrategyV2;
      },
      IController__factory.connect(core.controller, gov),
      gov,
      0,
      300,
      300,
      false,
    );

    vault = data.vault;
    strategy = UniswapV3ConverterStrategy__factory.connect(data.strategy.address, gov);
    splitter = data.splitter;
    insurance = await vault.insurance();

    // setup converter
    await ConverterUtils.whitelist([strategy.address]);
    const state = await strategy.getState();

    // prices should be the same in the pool and in the oracle
    await PriceOracleImitatorUtils.uniswapV3(signer, state.pool, state.tokenA);

    // prices should be the same in the pool and in the liquidator
    const pools = [
      {
        pool: state.pool,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.USDC_TOKEN,
        tokenOut: MaticAddresses.USDT_TOKEN,
      },
    ]
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    const liquidatorOperator = await Misc.impersonate('0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94')
    await tools.liquidator.connect(liquidatorOperator).addLargestPools(pools, true);
    await tools.liquidator.connect(liquidatorOperator).addBlueChipsPools(pools, true);

    // ---

    await IERC20__factory.connect(asset, signer).approve(vault.address, Misc.MAX_UINT);
    await IERC20__factory.connect(asset, signer2).approve(vault.address, Misc.MAX_UINT);

    await ControllerV2__factory.connect(core.controller, gov).registerOperator(signer.address);

    await vault.setWithdrawRequestBlocks(0);

    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN])
    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address);

    stateParams = {
      mainAssetSymbol: await IERC20Metadata__factory.connect(MaticAddresses.USDC_TOKEN, signer).symbol()
    }

    strategyAsSigner = StrategyBaseV2__factory.connect(strategy.address, signer);
    strategyAsOperator = await strategy.connect(await UniversalTestUtils.getAnOperator(strategy.address, signer));

  })

  after(async function() {
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: parseInt(process.env.TETU_MATIC_FORK_BLOCK || '', 10) || undefined,
          },
        },
      ],
    });
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Utils
  interface IPrepareOverCollateralParams {
    pathOut: string;
    countLoops: number;
    movePricesUp: boolean;
  }
  interface IPrepareOverCollateralResults {
    states: IStateNum[];
  }

  async function prepareOverCollateral(p: IPrepareOverCollateralParams) : Promise<IPrepareOverCollateralResults> {
    const states: IStateNum[] = [];
    const pathOut = p.pathOut;

    await strategy.setFuseThreshold(parseUnits('1'));
    await vault.setDoHardWorkOnInvest(false);
    await TokenUtils.getToken(asset, signer2.address, parseUnits('1', 6));
    await vault.connect(signer2).deposit(parseUnits('1', 6), signer2.address);

    const depositAmount1 = parseUnits('10000', decimals);
    await TokenUtils.getToken(asset, signer.address, depositAmount1.mul(p.countLoops));
    let swapAmount = parseUnits('100000', decimals);

    await depositToVault(vault, signer, depositAmount1, decimals, assetCtr, insurance);

    for (let i = 0; i < p.countLoops; i++) {
      const sharePriceBefore = await vault.sharePrice();
      console.log('------------------ CYCLE', i, '------------------');

      await TimeUtils.advanceNBlocks(300);

      if (p.movePricesUp) {
        await UniswapV3StrategyUtils.movePriceUp(signer2, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAmount);
      } else {
        await UniswapV3StrategyUtils.movePriceDown(signer2, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAmount);
      }
      states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, `p${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);

      // we suppose the rebalance happens immediately when it needs
      if (await strategy.needRebalance()) {
        console.log('------------------ REBALANCE' , i, '------------------');
        const rebalanced = await rebalanceUniv3StrategyNoSwaps(strategy, signer, decimals);
        await printVaultState(vault, splitter, strategyAsSigner, assetCtr, decimals);

        states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, `r${i}`, {rebalanced}));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
      }

      // decrease swap amount slowly
      swapAmount = swapAmount.mul(12).div(10); // div on 1.1
    }

    return {states};
  }

  interface IWithdrawParams {
    aggregator: string;
    planEntryData: string;
    entryToPool: number;
    saveState?: (title: string) => Promise<void>;
    singleIteration: boolean;
  }
  async function makeFullWithdraw(p: IWithdrawParams) {
    const state = await strategy.getState();
    let step = 0;
    while (true) {
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(p.planEntryData);
      console.log("makeFullWithdraw.quote", quote);

      let swapData: BytesLike = "0x";
      const tokenToSwap = quote.amountToSwap.eq(0) ? Misc.ZERO_ADDRESS : quote.tokenToSwap;
      const amountToSwap = quote.amountToSwap.eq(0) ? 0 : quote.amountToSwap;

      if (p.aggregator === MaticAddresses.AGG_ONEINCH_V5) {
        if (tokenToSwap !== Misc.ZERO_ADDRESS) {
          const params = {
            fromTokenAddress: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
            toTokenAddress: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
            amount: quote.amountToSwap.toString(),
            fromAddress: strategyAsOperator.address,
            slippage: 1,
            disableEstimate: true,
            allowPartialFill: false,
            protocols: 'POLYGON_BALANCER_V2',
          };
          console.log("params", params);

          const swapTransaction = await AggregatorUtils.buildTxForSwap(JSON.stringify(params));
          console.log('Transaction for swap: ', swapTransaction);
          swapData = swapTransaction.data;
        }
      }
      console.log("makeFullWithdraw.withdrawByAggStep.callStatic --------------------------------");
      const completed = await strategyAsOperator.callStatic.withdrawByAggStep(
        [tokenToSwap, p.aggregator],
        amountToSwap,
        swapData,
        p.planEntryData,
        p.entryToPool
      );

      console.log("makeFullWithdraw.withdrawByAggStep.execute --------------------------------");
      await strategyAsOperator.withdrawByAggStep(
        [tokenToSwap, p.aggregator],
        amountToSwap,
        swapData,
        p.planEntryData,
        p.entryToPool
      );
      console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");

      if (p.saveState) {
        await p.saveState(`u${++step}`);
      }
      if (p.singleIteration || completed) break;
    }
  }
//endregion Utils

//region Unit tests
  describe('unfold debts using single iteration', function() {
    describe("Move prices up", () => {
      describe("Liquidator, entry to pool at the end", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        interface IMakeWithdrawSingleIterationResults {
          states: IStateNum[];
        }

        async function makeWithdrawSingleIteration(): Promise<IMakeWithdrawSingleIterationResults> {
          const pathOut = "./tmp/single-iteration-entry-up.csv";
          const {states} = await prepareOverCollateral({
            countLoops: 3,
            pathOut,
            movePricesUp: true
          });
          await makeFullWithdraw({
            singleIteration: true,
            aggregator: Misc.ZERO_ADDRESS,
            entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
            planEntryData: defaultAbiCoder.encode(["uint256"], [PLAN_REPAY_SWAP_REPAY]),
            saveState: async stateTitle => {
              states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, stateTitle));
              await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
            }
          });
          return {states};
        }

        it("should reduce locked amount at least twice", async () => {
          const ret = await loadFixture(makeWithdrawSingleIteration);
          const [stateLast, statePrev, ...rest] = [...ret.states].reverse();
          expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
          expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice, 1e-6);
        });
        it("should enter to the pool at the end", async () => {
          const ret = await loadFixture(makeWithdrawSingleIteration);
          const [stateLast, ...rest] = [...ret.states].reverse();
          expect(stateLast.strategy.liquidity > 0).eq(true);
        });
      });
      describe("Liquidator, don't enter to the pool", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        interface IMakeWithdrawSingleIterationResults {
          states: IStateNum[];
        }

        async function makeWithdrawSingleIteration(): Promise<IMakeWithdrawSingleIterationResults> {
          const pathOut = "./tmp/single-iteration-exit-up.csv";
          const {states} = await prepareOverCollateral({
            countLoops: 3,
            pathOut,
            movePricesUp: true
          });
          await makeFullWithdraw({
            singleIteration: true,
            aggregator: Misc.ZERO_ADDRESS,
            entryToPool: 0, // (!) don't enter to the pool at the end
            planEntryData: defaultAbiCoder.encode(["uint256"], [PLAN_REPAY_SWAP_REPAY]),
            saveState: async stateTitle => {
              states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, stateTitle));
              await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
            }
          });
          return {states};
        }

        it("should reduce locked amount at least twice", async () => {
          const ret = await loadFixture(makeWithdrawSingleIteration);
          const [stateLast, statePrev, ...rest] = [...ret.states].reverse();
          console.log("statePrev", statePrev);
          console.log("stateLast", stateLast);
          expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
          expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice, 1e-6);
        });
        it("should not enter to the pool at the end", async () => {
          const ret = await loadFixture(makeWithdrawSingleIteration);
          const [stateLast, ...rest] = [...ret.states].reverse();
          console.log("stateLast", stateLast);
          expect(stateLast.strategy.liquidity).eq(0);
        });
      });
    });
    describe("Move prices down", () => {
      describe("Liquidator, entry to pool at the end", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        interface IMakeWithdrawSingleIterationResults {
          states: IStateNum[];
        }

        async function makeWithdrawSingleIteration(): Promise<IMakeWithdrawSingleIterationResults> {
          const pathOut = "./tmp/single-iteration-entry-down.csv";
          const {states} = await prepareOverCollateral({
            countLoops: 2,
            pathOut,
            movePricesUp: false
          });
          await makeFullWithdraw({
            singleIteration: true,
            aggregator: Misc.ZERO_ADDRESS,
            entryToPool: ENTRY_TO_POOL_IS_ALLOWED,
            planEntryData: defaultAbiCoder.encode(["uint256"], [PLAN_REPAY_SWAP_REPAY]),
            saveState: async stateTitle => {
              states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, stateTitle));
              await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
            }
          });
          return {states};
        }

        it("should reduce locked amount at least twice", async () => {
          const ret = await loadFixture(makeWithdrawSingleIteration);
          const [stateLast, statePrev, ...rest] = [...ret.states].reverse();
          expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
          expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice, 1e-5);
        });
        it("should enter to the pool at the end", async () => {
          const ret = await loadFixture(makeWithdrawSingleIteration);
          const [stateLast, ...rest] = [...ret.states].reverse();
          expect(stateLast.strategy.liquidity > 0).eq(true);
        });
      });
      describe("Liquidator, don't enter to the pool", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        interface IMakeWithdrawSingleIterationResults {
          states: IStateNum[];
        }

        async function makeWithdrawSingleIteration(): Promise<IMakeWithdrawSingleIterationResults> {
          const pathOut = "./tmp/single-iteration-exit-down.csv";
          const {states} = await prepareOverCollateral({
            countLoops: 2,
            pathOut,
            movePricesUp: false
          });
          await makeFullWithdraw({
            singleIteration: true,
            aggregator: Misc.ZERO_ADDRESS,
            entryToPool: 0, // (!) don't enter to the pool at the end
            planEntryData: defaultAbiCoder.encode(["uint256"], [PLAN_REPAY_SWAP_REPAY]),
            saveState: async stateTitle => {
              states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, stateTitle));
              await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
            }
          });
          return {states};
        }

        it("should reduce locked amount at least twice", async () => {
          const ret = await loadFixture(makeWithdrawSingleIteration);
          const [stateLast, statePrev, ...rest] = [...ret.states].reverse();
          console.log("statePrev", statePrev);
          console.log("stateLast", stateLast);
          expect(statePrev.lockedInConverter / stateLast.lockedInConverter).gt(2);
          expect(statePrev.vault.sharePrice).approximately(stateLast.vault.sharePrice, 1e-6);
        });
        it("should not enter to the pool at the end", async () => {
          const ret = await loadFixture(makeWithdrawSingleIteration);
          const [stateLast, ...rest] = [...ret.states].reverse();
          console.log("stateLast", stateLast);
          expect(stateLast.strategy.liquidity).eq(0);
        });
      });
    });
  });

  describe('withdraw all by steps', function() {
    describe('Move prices up, liquidator', function() {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      interface IMakeWithdrawSingleIterationResults {
        states: IStateNum[];
      }

      async function makeWithdrawAll(): Promise<IMakeWithdrawSingleIterationResults> {
        const pathOut = "./tmp/withdraw-all-up.csv";
        const {states} = await prepareOverCollateral({
          countLoops: 3,
          pathOut,
          movePricesUp: true
        });
        await makeFullWithdraw({
          singleIteration: false,
          aggregator: Misc.ZERO_ADDRESS,
          entryToPool: ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
          planEntryData: defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY, 0]),
          saveState: async stateTitle => {
            states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, stateTitle));
            await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
          }
        });
        return {states};
      }

      it("should reduce locked amount to zero", async () => {
        const ret = await loadFixture(makeWithdrawAll);
        const [stateLast, ...rest] = [...ret.states].reverse();
        console.log("stateLast", stateLast);
        expect(stateLast.lockedInConverter).eq(0);
      });
      it("should close all debts", async () => {
        const ret = await loadFixture(makeWithdrawAll);
        const [stateLast, ...rest] = [...ret.states].reverse();
        console.log("stateLast", stateLast);
        expect(stateLast.converterDirect.amountsToRepay.length).eq(1);
        expect(stateLast.converterDirect.amountsToRepay[0]).eq(0);

        expect(stateLast.converterDirect.collaterals.length).eq(1);
        expect(stateLast.converterDirect.collaterals[0]).eq(0);

        expect(stateLast.converterReverse.amountsToRepay.length).eq(1);
        expect(stateLast.converterReverse.amountsToRepay[0]).eq(0);

        expect(stateLast.converterReverse.collaterals.length).eq(1);
        expect(stateLast.converterReverse.collaterals[0]).eq(0);

      });
      it("should not enter to the pool at the end", async () => {
        const ret = await loadFixture(makeWithdrawAll);
        const [stateLast, ...rest] = [...ret.states].reverse();
        expect(stateLast.strategy.liquidity).eq(0);
      });
      it("should set investedAssets to zero", async () => {
        const ret = await loadFixture(makeWithdrawAll);
        const [stateLast, ...rest] = [...ret.states].reverse();
        // coverLoss can compensate loss by transferring of USDC/USDT on strategy balance
        // so, even if we are going to convert all assets to underlying, we can have small amount of not-underlying on balance
        expect(stateLast.strategy.investedAssets).lt(1);
      });
      it("should receive totalAssets on balance", async () => {
        const ret = await loadFixture(makeWithdrawAll);
        const [stateLast, ...rest] = [...ret.states].reverse();
        expect(stateLast.strategy.totalAssets).approximately(stateLast.strategy.assetBalance, 1);
      });
    });
    describe('Move prices down, liquidator', function() {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      interface IMakeWithdrawSingleIterationResults {
        states: IStateNum[];
      }

      async function makeWithdrawAll(): Promise<IMakeWithdrawSingleIterationResults> {
        const pathOut = "./tmp/withdraw-all-down.csv";
        const {states} = await prepareOverCollateral({
          countLoops: 3,
          pathOut,
          movePricesUp: false
        });
        await makeFullWithdraw({
          singleIteration: false,
          aggregator: Misc.ZERO_ADDRESS,
          entryToPool: ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
          planEntryData: defaultAbiCoder.encode(["uint256", "uint256"], [PLAN_SWAP_REPAY, 0]),
          saveState: async stateTitle => {
            states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, stateTitle));
            await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
          }
        });
        return {states};
      }

      it("should reduce locked amount to zero", async () => {
        const ret = await loadFixture(makeWithdrawAll);
        const [stateLast, ...rest] = [...ret.states].reverse();
        console.log("stateLast", stateLast);
        expect(stateLast.lockedInConverter).eq(0);
      });
      it("should close all debts", async () => {
        const ret = await loadFixture(makeWithdrawAll);
        const [stateLast, ...rest] = [...ret.states].reverse();
        console.log("stateLast", stateLast);
        expect(stateLast.converterDirect.amountsToRepay.length).eq(1);
        expect(stateLast.converterDirect.amountsToRepay[0]).eq(0);

        expect(stateLast.converterDirect.collaterals.length).eq(1);
        expect(stateLast.converterDirect.collaterals[0]).eq(0);

        expect(stateLast.converterReverse.amountsToRepay.length).eq(1);
        expect(stateLast.converterReverse.amountsToRepay[0]).eq(0);

        expect(stateLast.converterReverse.collaterals.length).eq(1);
        expect(stateLast.converterReverse.collaterals[0]).eq(0);

      });
      it("should not enter to the pool at the end", async () => {
        const ret = await loadFixture(makeWithdrawAll);
        const [stateLast, ...rest] = [...ret.states].reverse();
        expect(stateLast.strategy.liquidity).eq(0);
      });
      it("should set investedAssets to zero", async () => {
        const ret = await loadFixture(makeWithdrawAll);
        const [stateLast, ...rest] = [...ret.states].reverse();
        // coverLoss can compensate loss by transferring of USDC/USDT on strategy balance
        // so, even if we are going to convert all assets to underlying, we can have small amount of not-underlying on balance
        expect(stateLast.strategy.investedAssets).lt(1);
      });
      it("should receive totalAssets on balance", async () => {
        const ret = await loadFixture(makeWithdrawAll);
        const [stateLast, ...rest] = [...ret.states].reverse();
        expect(stateLast.strategy.totalAssets).approximately(stateLast.strategy.assetBalance, 1);
      });
    });
  });

  describe('withdraw - pure swap', function() {
// todo
  });

  describe('rebalanceNoSwaps', function() {
    it('should change needRebalance() result to false', async() => {
      const s = strategy
      const state = await s.getState()

      console.log('deposit...');
      await IERC20__factory.connect(asset, signer).approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset, signer.address, parseUnits('1000', 6));
      await vault.connect(signer).deposit(parseUnits('1000', 6), signer.address);

      await UniswapV3StrategyUtils.movePriceDown(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('600000', 6), 100001);

      const needRebalanceBefore = await s.needRebalance();
      await s.rebalanceNoSwaps(true);
      const needRebalanceAfter = await s.needRebalance();

      expect(needRebalanceBefore).eq(true);
      expect(needRebalanceAfter).eq(false);
    })
  });

//endregion Unit tests
});