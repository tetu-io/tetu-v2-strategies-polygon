/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  IERC20,
  IERC20__factory, IERC20Metadata__factory, IStrategyV2,
  ISwapper,
  ISwapper__factory, TetuVaultV2, UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
} from '../../../../typechain';
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniswapV3StrategyUtils} from "../../../baseUT/strategies/UniswapV3StrategyUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {IStateNum, IStateParams, StateUtilsNum} from '../../../baseUT/utils/StateUtilsNum';
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {BigNumber, BytesLike} from "ethers";
import {AggregatorUtils} from "../../../baseUT/utils/AggregatorUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {ENTRY_TO_POOL_IS_ALLOWED, PLAN_REPAY_SWAP_REPAY} from "../../../baseUT/AppConstants";
import { EnvSetup } from '../../../../scripts/utils/EnvSetup';
/**
 * Study noSwap-rebalance.
 * Try to change price step by step and check how strategy params are changed
 */
describe('UniswapV3ConverterStrategyDegradationTest @skip-on-coverage', function() {
//region Constants and variables

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let user: SignerWithAddress;
  let swapper: ISwapper;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: UniswapV3ConverterStrategy;
  let stateParams: IStateParams;
//endregion Constants and variables

//region before after
  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID, -1);
    snapshotBefore = await TimeUtils.snapshot();

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;


    [signer, user] = await ethers.getSigners();
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    const core = Addresses.getCore();
    const controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    const converterAddress = getConverterAddress();
    swapper = ISwapper__factory.connect(MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, signer);

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_UniswapV3_USDC_USDT-0.01%',
      async(_splitterAddress: string) => {
        const _strategy = UniswapV3ConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          converterAddress,
          MaticAddresses.UNISWAPV3_USDC_USDT_100,
          0,
          0,
          [0, 0, Misc.MAX_UINT, 0],
          [0, 0, Misc.MAX_UINT, 0],
        );

        return _strategy as unknown as IStrategyV2;
      },
      controller,
      gov,
      1_000,
      300,
      300,
      false,
    );
    strategy = data.strategy as UniswapV3ConverterStrategy
    vault = data.vault.connect(signer)

    await ConverterUtils.whitelist([strategy.address]);
    const state = await PackedData.getDefaultState(strategy);
    await PriceOracleImitatorUtils.uniswapV3(signer, state.pool, state.tokenA);

    await vault.connect(gov).setWithdrawRequestBlocks(0);

    await ConverterUtils.disableAaveV2(signer)

    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
    await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, parseUnits('0.001', 6));

    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN]);
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address);

    stateParams = {
      mainAssetSymbol: await IERC20Metadata__factory.connect(MaticAddresses.USDC_TOKEN, signer).symbol()
    }

  })

  after(async function() {
    await HardhatUtils.restoreBlockFromEnv();
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });
//endregion before after

//region Unit tests
  describe('study: UniswapV3 strategy rebalance by noSwaps tests', function() {
    it('Reduce price N steps, increase price N steps, rebalance-no-swaps each time', async() => {
      const COUNT = 4;
      const state = await PackedData.getDefaultState(strategy);
      const listStates: IStateNum[] = [];

      console.log('deposit...');
      await asset.connect(user).approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, user.address, parseUnits('1000', 6));
      await vault.connect(user).deposit(parseUnits('1000', 6), user.address);

      const stateStepInitial = await StateUtilsNum.getState(signer, user, strategy, vault, `initial`);
      listStates.push(stateStepInitial);
      console.log(`initial`, stateStepInitial);

      await UniversalUtils.makePoolVolume(signer, state, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('500000', 6));

      for (let i = 0; i < COUNT * 2; ++i) {
        const state0 = await PackedData.getDefaultState(strategy);
        console.log("state0", state0);

        console.log("Step", i);

        const swapAmount = BigNumber.from(parseUnits('20000', 6));
        console.log("swapAmount", swapAmount);

        // Decrease price at first 10 steps, increase price on other 10 steps
        while (! await strategy.needRebalance()) {
          if (i < COUNT) {
            await UniversalUtils.movePoolPriceDown(
              signer,
              state,
              MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
              swapAmount,
              100001
            );
          } else {
            await UniversalUtils.movePoolPriceUp(
              signer,
              state,
              MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
              swapAmount,
              100001
            );
          }
        }

        expect(await strategy.needRebalance()).eq(true);

        console.log("Start rebalance, step", i);
        await strategy.rebalanceNoSwaps(true,{gasLimit: 19_000_000});
        console.log("End rebalance, step", i);

        expect(await strategy.needRebalance()).eq(false);

        await TimeUtils.advanceNBlocks(300);

        const stateStep = await StateUtilsNum.getState(signer, user, strategy, vault, `step ${i}`);
        listStates.push(stateStep);
        console.log(`state ${i}`, stateStep);

        await StateUtilsNum.saveListStatesToCSVColumns(
          './tmp/degradation.csv',
          listStates,
          stateParams
        );
      }
    })
  })

  describe('study: make over-collateral, withdraw all', function() {
    it('Reduce price N steps, withdraw by iterations', async() => {
      const COUNT = 2;
      const state = await PackedData.getDefaultState(strategy);
      const listStates: IStateNum[] = [];

      // const AGGREGATOR = MaticAddresses.AGG_ONEINCH_V5; // use real aggregator for swaps
      const AGGREGATOR = Misc.ZERO_ADDRESS; // use liquidator for swaps

      const planEntryData = defaultAbiCoder.encode(
          ["uint256", "uint256"],
          [PLAN_REPAY_SWAP_REPAY, 0] // we need 100% of underlying
      );

      const AMOUNT_TO_DEPOSIT= "1000";
      const MIN_AMOUNT_TO_RECEIVE_USDT = "0";
      const MIN_AMOUNT_TO_RECEIVE_USDC = "980";

      const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
      const strategyAsOperator = await strategy.connect(operator);

      console.log('deposit...');
      await asset.connect(user).approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, user.address, parseUnits(AMOUNT_TO_DEPOSIT, 6));
      await vault.connect(user).deposit(parseUnits('1000', 6), user.address);

      const stateStepInitial = await StateUtilsNum.getState(signer, user, strategy, vault, `initial`);
      listStates.push(stateStepInitial);
      console.log(`initial`, stateStepInitial);

      // await UniswapV3StrategyUtils.makeVolume(signer, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('500000', 6));


      // move price and get over-collateral
      for (let i = 0; i < COUNT; ++i) {
        const state0 = await PackedData.getDefaultState(strategy);
        console.log("state0", state0);

        console.log("Step", i);

        const swapAmount = BigNumber.from(parseUnits('20000', 6));
        console.log("swapAmount", swapAmount);

        // Decrease price at first 10 steps, increase price on other 10 steps
        while (! await strategy.needRebalance()) {
          await UniversalUtils.movePoolPriceDown(
            signer,
            state,
            MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
            swapAmount,
            100001
          );
          // await UniswapV3StrategyUtils.movePriceUp(
          //   signer,
          //   strategy.address,
          //   MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
          //   swapAmount,
          //   100001
          // );
        }

        expect(await strategy.needRebalance()).eq(true);

        console.log("Start rebalance, step", i);
        await strategy.rebalanceNoSwaps(true,{gasLimit: 19_000_000});
        console.log("End rebalance, step", i);

        expect(await strategy.needRebalance()).eq(false);

        await TimeUtils.advanceNBlocks(300);

        const stateStep = await StateUtilsNum.getState(signer, user, strategy, vault, `step ${i}`);
        listStates.push(stateStep);
        console.log(`state ${i}`, stateStep);

        await StateUtilsNum.saveListStatesToCSVColumns(
          './tmp/degradation-withdrawAll.csv',
          listStates,
          stateParams
        );
      }


      // try to withdraw all and get the assets in required proportions on the balance
      console.log("Withdraw by iterations");

      let completed = false;
      while (! completed) {
        // get info about swap required on next iteration
        const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
        console.log("quote", quote);

        // prepare swap-data for the next iteration
        let swapData: BytesLike = "0x";
        const tokenToSwap = quote.amountToSwap.eq(0) ? Misc.ZERO_ADDRESS : quote.tokenToSwap;
        const amountToSwap = quote.amountToSwap.eq(0) ? 0 : quote.amountToSwap;

        // we can use either liquidator or real aggregator - 1inch
        // for real aggregator we should prepare swap-transaction
        if (AGGREGATOR === MaticAddresses.AGG_ONEINCH_V5) {
          if (tokenToSwap !== Misc.ZERO_ADDRESS) {
            swapData = await AggregatorUtils.buildSwapTransactionData(
              quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
              quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
              quote.amountToSwap,
              strategyAsOperator.address,
            );
          }
        }

        completed = await strategyAsOperator.callStatic.withdrawByAggStep(
            tokenToSwap,
            AGGREGATOR,
            amountToSwap,
            swapData,
            planEntryData,
            ENTRY_TO_POOL_IS_ALLOWED
        );
        await strategyAsOperator.withdrawByAggStep(
            tokenToSwap,
            AGGREGATOR,
            amountToSwap,
            swapData,
            planEntryData,
            ENTRY_TO_POOL_IS_ALLOWED
        );
      }

      const stateStepFinal = await StateUtilsNum.getState(signer, user, strategy, vault, `final`);
      listStates.push(stateStepFinal);
      console.log(`final`, stateStepFinal);

      const finalUsdcBalance = +formatUnits(await IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer).balanceOf(strategy.address), 6);
      const finalUsdtBalance = +formatUnits(await IERC20__factory.connect(PolygonAddresses.USDT_TOKEN, signer).balanceOf(strategy.address), 6);

      expect(finalUsdcBalance).gte(+MIN_AMOUNT_TO_RECEIVE_USDC);
      expect(finalUsdtBalance).gte(+MIN_AMOUNT_TO_RECEIVE_USDT);
    })
  })

})

//endregion Unit tests

