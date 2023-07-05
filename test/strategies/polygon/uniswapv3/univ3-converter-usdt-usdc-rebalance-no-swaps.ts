import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai from 'chai';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { ethers } from 'hardhat';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  ControllerV2__factory,
  IController__factory,
  IERC20__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IStrategyV2,
  StrategyBaseV2__factory,
  StrategySplitterV2,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory, UniswapV3Reader,
} from '../../../../typechain';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { TokenUtils } from '../../../../scripts/utils/TokenUtils';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { Misc } from '../../../../scripts/utils/Misc';
import { ConverterUtils } from '../../../baseUT/utils/ConverterUtils';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { UniswapV3StrategyUtils } from '../../../UniswapV3StrategyUtils';
import {
  depositToVault,
  doHardWorkForStrategy,
  printVaultState, rebalanceUniv3Strategy,
  rebalanceUniv3StrategyNoSwaps,
  redeemFromVault,
} from '../../../StrategyTestUtils';
import {BigNumber, BytesLike} from 'ethers';
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {IStateNum, IStateParams, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {AggregatorUtils} from "../../../baseUT/utils/AggregatorUtils";


const { expect } = chai;

describe('univ3-converter-usdt-usdc-rebalance-no-swaps', function() {
  const ENTRY_TO_POOL_IS_ALLOWED = 1;
  const ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED = 2;

//region Variables
  let snapshotBefore: string;
  let snapshot: string;

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
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });


  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Utils
  async function unfoldBorrows(
    strategyAsOperator: UniswapV3ConverterStrategy,
    saveState?: (title: string) => Promise<void>
  ) {
    const state = await strategy.getState();
    const AGGREGATOR = Misc.ZERO_ADDRESS; // use liquidator for swaps
    const propNotUnderlying18 = 0; // for simplicity: we need 100% of underlying
    const USE_SINGLE_ITERATION = true;

    let step = 0;
    while (true) {
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(
        propNotUnderlying18,
        USE_SINGLE_ITERATION
      );
      console.log("!!!!!!!!!!!quote", quote);

      let swapData: BytesLike = "0x";
      const tokenToSwap = quote.amountToSwap.eq(0) ? Misc.ZERO_ADDRESS : quote.tokenToSwap;
      const amountToSwap = quote.amountToSwap.eq(0) ? 0 : quote.amountToSwap;

      if (AGGREGATOR === MaticAddresses.AGG_ONEINCH_V5) {
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
      console.log("unfoldBorrows.withdrawByAggStep.callStatic", quote);
      const completed = await strategyAsOperator.callStatic.withdrawByAggStep(
        tokenToSwap,
        amountToSwap,
        AGGREGATOR,
        swapData,
        [
          propNotUnderlying18,
          USE_SINGLE_ITERATION ? ENTRY_TO_POOL_IS_ALLOWED : ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
          USE_SINGLE_ITERATION ? 1 : 0
        ]
      );

      console.log("unfoldBorrows.withdrawByAggStep.execute --------------------------------", quote);
      await strategyAsOperator.withdrawByAggStep(
        tokenToSwap,
        amountToSwap,
        AGGREGATOR,
        swapData,
        [
          propNotUnderlying18,
          USE_SINGLE_ITERATION ? ENTRY_TO_POOL_IS_ALLOWED : ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED,
          USE_SINGLE_ITERATION ? 1 : 0
        ]
      );

      if (saveState) {
        await saveState(`u${++step}`);
      }
      if (USE_SINGLE_ITERATION) break;
      if (completed) break;
    }
  }

  interface ITestParams {
    filePath: string;
    /** up OR down */
    movePricesUp: boolean;
    /** no-swap OR liquidator */
    useNoSwapRebalance: boolean;
  }
  async function makeTest(p: ITestParams) {
    const cycles = 6;
    const MAX_ALLLOWED_LOCKED_PERCENT = 25;
    const pathOut = p.filePath;
    const states: IStateNum[] = [];

    await strategy.setFuseThreshold(parseUnits('1'));
    const strategyAsSigner = StrategyBaseV2__factory.connect(strategy.address, signer);
    const strategyAsOperator = await strategy.connect(await UniversalTestUtils.getAnOperator(strategy.address, signer));

    await vault.setDoHardWorkOnInvest(false);
    await TokenUtils.getToken(asset, signer2.address, parseUnits('1', 6));
    await vault.connect(signer2).deposit(parseUnits('1', 6), signer2.address);

    const depositAmount1 = parseUnits('10000', decimals);
    await TokenUtils.getToken(asset, signer.address, depositAmount1.mul(cycles));
    let swapAmount = parseUnits('100000', decimals);

    const balanceBefore = +formatUnits(await assetCtr.balanceOf(signer.address), decimals);

    for (let i = 0; i < cycles; i++) {
      const sharePriceBefore = await vault.sharePrice();
      console.log('------------------ CYCLE', i, '------------------');

      console.log('------------------ DEPOSIT', i, '------------------');

      if (i % 3 === 0) {
        await depositToVault(vault, signer, depositAmount1, decimals, assetCtr, insurance);
        await printVaultState(vault, splitter, strategyAsSigner, assetCtr, decimals);
      } else {
        await depositToVault(vault, signer, depositAmount1.div(2), decimals, assetCtr, insurance);
        await printVaultState(vault, splitter, strategyAsSigner, assetCtr, decimals);

        await depositToVault(vault, signer, depositAmount1.div(2), decimals, assetCtr, insurance);
        await printVaultState(vault, splitter, strategyAsSigner, assetCtr, decimals);
      }

      states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, `d${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);

      expect(await strategy.investedAssets()).above(0);

      await TimeUtils.advanceNBlocks(300);

      console.log(`------------------ MOVE PRICE ${p.movePricesUp ? "UP" : "DOWN"} `, i, '------------------');
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
        const rebalanced = p.useNoSwapRebalance
          ? await rebalanceUniv3StrategyNoSwaps(strategy, signer, decimals)
          : await rebalanceUniv3Strategy(strategy, signer, decimals);

        await printVaultState(vault, splitter, strategyAsSigner, assetCtr, decimals);
        states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, `r${i}`, {rebalanced}));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
      }

      console.log('------------------ BORROWS UNFOLDING (reduce over-collateral)', i, '------------------');
      if (p.useNoSwapRebalance) {
        const r = await reader.getLockedUnderlyingAmount(strategy.address);
        if (!r.totalAssets.eq(0)) {
          const percent = r.estimatedUnderlyingAmount.mul(100).div(r.totalAssets).toNumber();
          console.log("Locked percent", percent);
          if (percent > MAX_ALLLOWED_LOCKED_PERCENT) {
            await unfoldBorrows(
              strategyAsOperator,
              async stateTitle => {
                states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, stateTitle));
                await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
              }
            );
          }
        }
      }


      if (i % 2 === 0) {
        console.log('------------------ HARDWORK', i, '------------------');
        const stateHardworkEvents = await doHardWorkForStrategy(splitter, strategyAsSigner, signer, decimals);
        await printVaultState(vault, splitter, strategyAsSigner, assetCtr, decimals);
        states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, `h${i}`)); // todo: stateHardworkEvents
      }


      console.log('------------------ WITHDRAW', i, '------------------');
      if (i % 7 === 0) {
        await redeemFromVault(vault, signer, 100, decimals, assetCtr, insurance);
        await printVaultState(vault, splitter, strategyAsSigner, assetCtr, decimals);
      } else if (i % 5 === 0) {
        await redeemFromVault(vault, signer, 50, decimals, assetCtr, insurance);
        await printVaultState(vault, splitter, strategyAsSigner, assetCtr, decimals);
        await redeemFromVault(vault, signer, 100, decimals, assetCtr, insurance);
        await printVaultState(vault, splitter, strategyAsSigner, assetCtr, decimals);
      }

      const sharePriceAfter = await vault.sharePrice();
      // zero compound
      expect(sharePriceAfter).approximately(sharePriceBefore, 10);

      // decrease swap amount slowly
      swapAmount = swapAmount.mul(12).div(10); // div on 1.1

      states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, `w${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
    }

    const balanceAfter = +formatUnits(await assetCtr.balanceOf(signer.address), decimals);
    console.log('balanceBefore', balanceBefore);
    console.log('balanceAfter', balanceAfter);
    expect(balanceAfter).approximately(balanceBefore - (+formatUnits(depositAmount1, 6) * 0.006 * cycles), 0.2 * cycles);
  }
//endregion Utils

//region Unit tests
  it('Move price up in loop - no swap', async function() {
    await makeTest({
      filePath: `./tmp/move_price_up_no_swap.csv`,
      movePricesUp: true,
      useNoSwapRebalance: true
    });
  });
  it('Move price down in loop - no swap', async function() {
    await makeTest({
      filePath: `./tmp/move_price_down_no_swap.csv`,
      movePricesUp: true,
      useNoSwapRebalance: true
    });
  });


  it.skip('Move price up in loop - liquidator @skip-on-coverage', async function() {
    await makeTest({
      filePath: `./tmp/move_price_up_liquidator.csv`,
      movePricesUp: true,
      useNoSwapRebalance: false
    })
  });
//endregion Unit tests
});
