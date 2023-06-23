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
import {parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniswapV3StrategyUtils} from "../../../UniswapV3StrategyUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {IStateNum, IStateParams, StateUtilsNum} from '../../../baseUT/utils/StateUtilsNum';
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {BigNumber} from "ethers";
import {tetuConverter} from "../../../../typechain/@tetu_io";

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

/**
 * Study noSwap-rebalance.
 * Try to change price step by step and check how strategy params are changed
 */
describe('UniswapV3ConverterStrategyDegradationTest @skip-on-coverage', function() {
//region Constants and variables
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

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
    snapshotBefore = await TimeUtils.snapshot();

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: undefined,
          },
        },
      ],
    });

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
    const state = await strategy.getState();
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

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });
//endregion before after

//region Utils
  function apiRequestUrl(methodName: string, queryParams: string) {
    const chainId = hre.network.config.chainId;
    const apiBaseUrl = 'https://api.1inch.io/v5.0/' + chainId;
    const r = (new URLSearchParams(JSON.parse(queryParams))).toString();
    return apiBaseUrl + methodName + '?' + r;
  }

  async function buildTxForSwap(params: string, tries: number = 2) {
    const url = apiRequestUrl('/swap', params);
    console.log('url', url)
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url)
        if (r && r.status === 200) {
          return (await r.json()).tx
        }
      } catch (e) {
        console.error('Err', e)
      }
    }
  }
//endregion Utils

//region Unit tests
  describe('study: UniswapV3 strategy rebalance by noSwaps tests', function() {
    it('Reduce price N steps, increase price N steps, rebalance-no-swaps each time', async() => {
      const COUNT = 4;
      const state = await strategy.getState();
      const listStates: IStateNum[] = [];

      console.log('deposit...');
      await asset.connect(user).approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, user.address, parseUnits('1000', 6));
      await vault.connect(user).deposit(parseUnits('1000', 6), user.address);

      const stateStepInitial = await StateUtilsNum.getState(signer, user, strategy, vault, `initial`);
      listStates.push(stateStepInitial);
      console.log(`initial`, stateStepInitial);

      await UniswapV3StrategyUtils.makeVolume(signer, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('500000', 6));

      for (let i = 0; i < COUNT * 2; ++i) {
        const state0 = await strategy.getState();
        console.log("state0", state0);

        console.log("Step", i);

        const swapAmount = BigNumber.from(parseUnits('20000', 6));
        console.log("swapAmount", swapAmount);

        // Decrease price at first 10 steps, increase price on other 10 steps
        while (! await strategy.needRebalance()) {
          if (i < COUNT) {
            await UniswapV3StrategyUtils.movePriceDown(
              signer,
              strategy.address,
              MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
              swapAmount,
              100001
            );
          } else {
            await UniswapV3StrategyUtils.movePriceUp(
              signer,
              strategy.address,
              MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
              swapAmount,
              100001
            );
          }
        }

        expect(await strategy.needRebalance()).eq(true);

        console.log("Start rebalance, step", i);
        await strategy.rebalanceNoSwaps({gasLimit: 19_000_000});
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
      const state = await strategy.getState();
      const listStates: IStateNum[] = [];

      console.log('deposit...');
      await asset.connect(user).approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, user.address, parseUnits('1000', 6));
      await vault.connect(user).deposit(parseUnits('1000', 6), user.address);

      const stateStepInitial = await StateUtilsNum.getState(signer, user, strategy, vault, `initial`);
      listStates.push(stateStepInitial);
      console.log(`initial`, stateStepInitial);

      await UniswapV3StrategyUtils.makeVolume(signer, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('500000', 6));

      for (let i = 0; i < COUNT; ++i) {
        const state0 = await strategy.getState();
        console.log("state0", state0);

        console.log("Step", i);

        const swapAmount = BigNumber.from(parseUnits('20000', 6));
        console.log("swapAmount", swapAmount);

        // Decrease price at first 10 steps, increase price on other 10 steps
        while (! await strategy.needRebalance()) {
          await UniswapV3StrategyUtils.movePriceDown(
            signer,
            strategy.address,
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
        await strategy.rebalanceNoSwaps({gasLimit: 19_000_000});
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

      console.log("Withdraw by iterations");
      // await vault.connect(user).withdrawAll();
      const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
      const strategyAsOperator = await strategy.connect(operator);

      await strategyAsOperator.withdrawByAggEntry();
      const proportions18 = Misc.ONE18; // we need 100% of underlying

      let completed = false;
      while (! completed) {
        const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(proportions18);
        console.log("quote", quote);


        if (quote.amountToSwap.eq(0)) {
          console.log("No swap is required");
          completed = await strategyAsOperator.callStatic.withdrawByAggStep(Misc.ZERO_ADDRESS, 0, MaticAddresses.AGG_ONEINCH_V5, "0x", proportions18);
          await strategyAsOperator.withdrawByAggStep(Misc.ZERO_ADDRESS, 0, MaticAddresses.AGG_ONEINCH_V5, "0x", proportions18);
        } else {
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

          const swapTransaction = await buildTxForSwap(JSON.stringify(params));
          console.log('Transaction for swap: ', swapTransaction);

          completed = await strategyAsOperator.callStatic.withdrawByAggStep(quote.tokenToSwap, quote.amountToSwap, MaticAddresses.AGG_ONEINCH_V5, swapTransaction.data, proportions18);
          await strategyAsOperator.withdrawByAggStep(quote.tokenToSwap, quote.amountToSwap, MaticAddresses.AGG_ONEINCH_V5, swapTransaction.data, proportions18);
        }
      }

      const stateStepFinal = await StateUtilsNum.getState(signer, user, strategy, vault, `final`);
      listStates.push(stateStepFinal);
      console.log(`final`, stateStepFinal);
    })

    it('Reduce price N steps, withdraw all', async() => {
      const COUNT = 5;
      const state = await strategy.getState();
      const listStates: IStateNum[] = [];

      console.log('deposit...');
      await asset.connect(user).approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, user.address, parseUnits('1000', 6));
      await vault.connect(user).deposit(parseUnits('1000', 6), user.address);

      const stateStepInitial = await StateUtilsNum.getState(signer, user, strategy, vault, `initial`);
      listStates.push(stateStepInitial);
      console.log(`initial`, stateStepInitial);

      await UniswapV3StrategyUtils.makeVolume(signer, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('500000', 6));

      for (let i = 0; i < COUNT; ++i) {
        const state0 = await strategy.getState();
        console.log("state0", state0);

        console.log("Step", i);

        const swapAmount = BigNumber.from(parseUnits('20000', 6));
        console.log("swapAmount", swapAmount);

        // Decrease price at first 10 steps, increase price on other 10 steps
        while (! await strategy.needRebalance()) {
          await UniswapV3StrategyUtils.movePriceDown(
            signer,
            strategy.address,
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
        await strategy.rebalanceNoSwaps({gasLimit: 19_000_000});
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

      console.log("Withdraw all");
      // await vault.connect(user).withdrawAll();
      const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
      await strategy.connect(operator).withdrawAllByLiquidator(false, 0, Misc.ZERO_ADDRESS, "0x");

      const stateStepFinal = await StateUtilsNum.getState(signer, user, strategy, vault, `final`);
      listStates.push(stateStepFinal);
      console.log(`final`, stateStepFinal);
    })
    it('Increase price N steps, withdraw all', async() => {
      const COUNT = 5;
      const state = await strategy.getState();
      const listStates: IStateNum[] = [];

      console.log('deposit...');
      await asset.connect(user).approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, user.address, parseUnits('1000', 6));
      await vault.connect(user).deposit(parseUnits('1000', 6), user.address);

      const stateStepInitial = await StateUtilsNum.getState(signer, user, strategy, vault, `initial`);
      listStates.push(stateStepInitial);
      console.log(`initial`, stateStepInitial);

      await UniswapV3StrategyUtils.makeVolume(signer, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('500000', 6));

      for (let i = 0; i < COUNT; ++i) {
        const state0 = await strategy.getState();
        console.log("state0", state0);

        console.log("Step", i);

        const swapAmount = BigNumber.from(parseUnits('20000', 6));
        console.log("swapAmount", swapAmount);

        // Decrease price at first 10 steps, increase price on other 10 steps
        while (! await strategy.needRebalance()) {
          await UniswapV3StrategyUtils.movePriceUp(
            signer,
            strategy.address,
            MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
            swapAmount,
            100001
          );
        }

        expect(await strategy.needRebalance()).eq(true);

        console.log("Start rebalance, step", i);
        await strategy.rebalanceNoSwaps({gasLimit: 19_000_000});
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

      console.log("Withdraw all");
      // await vault.connect(user).withdrawAll();
      const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
      await strategy.connect(operator).withdrawAllByLiquidator(false, 0, Misc.ZERO_ADDRESS, "0x");

      const stateStepFinal = await StateUtilsNum.getState(signer, user, strategy, vault, `final`);
      listStates.push(stateStepFinal);
      console.log(`final`, stateStepFinal);
    })
  })

})

//endregion Unit tests

