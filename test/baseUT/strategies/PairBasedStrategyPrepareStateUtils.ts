import {IBuilderResults} from "./PairBasedStrategyBuilder";
import {
  AlgebraLib,
  ControllerV2__factory,
  ConverterStrategyBase__factory, IRebalancingV2Strategy,
  KyberLib, StrategyBaseV2__factory,
  UniswapV3Lib
} from "../../../typechain";
import {PackedData} from "../utils/PackedData";
import {BigNumber, BytesLike} from "ethers";
import {PairStrategyLiquidityUtils} from "./PairStrategyLiquidityUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {UniversalUtils} from "./UniversalUtils";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {IERC20Metadata__factory} from "../../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {getConverterAddress, Misc} from "../../../scripts/utils/Misc";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "./AppPlatforms";
import {IController__factory} from "../../../typechain/factories/@tetu_io/tetu-converter/contracts/interfaces";
import {AggregatorUtils} from "../utils/AggregatorUtils";
import {IStateNum, StateUtilsNum} from "../utils/StateUtilsNum";
import {depositToVault, printVaultState} from "../../StrategyTestUtils";
import {NoSwapRebalanceEvents} from "./NoSwapRebalanceEvents";

const ENTRY_TO_POOL_IS_ALLOWED = 1;
const ENTRY_TO_POOL_IS_ALLOWED_IF_COMPLETED = 2;

const PLAN_SWAP_REPAY = 0;
const PLAN_REPAY_SWAP_REPAY = 1;
const PLAN_SWAP_ONLY = 2;

export interface IPrepareOverCollateralParams {
  countRebalances: number;
  movePricesUp: boolean;
}

export interface IListStates {
  states: IStateNum[];
}

/**
 * Utils to set up "current state of pair strategy" in tests
 */
export class PairBasedStrategyPrepareStateUtils {

  static getLib(platform: string, b: IBuilderResults): UniswapV3Lib | AlgebraLib | KyberLib {
    return platform === PLATFORM_ALGEBRA
      ? b.libAlgebra
      : platform === PLATFORM_KYBER
        ? b.libKyber
        : b.libUniv3;
  }

  /** Set up "neeRebalance = true" */
  static async prepareNeedRebalanceOn(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    b: IBuilderResults,
    swapAmountRatio: number = 1.1
  ) {
    const state = await PackedData.getDefaultState(b.strategy);

    // move strategy to "need to rebalance" state
    let countRebalance = 0;
    for (let i = 0; i < 10; ++i) {
      console.log("i", i);
      const swapAmount = await this.getSwapAmount2(
        signer,
        b,
        state.tokenA,
        state.tokenB,
        true,
        swapAmountRatio
      );
      await UniversalUtils.movePoolPriceUp(signer2, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount, 40000);
      if (await b.strategy.needRebalance()) {
        if (countRebalance === 0) {
          await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
          countRebalance++;
        } else {
          break;
        }
      }
    }
  }

  /** Setup fuse thresholds. Values are selected relative to the current prices */
  static async prepareFuse(b: IBuilderResults, triggerOn: boolean) {
    console.log("activate fuse ON");
    // lib.getPrice gives incorrect value of the price of token A (i.e. 1.001734 instead of 1.0)
    // so, let's use prices from the oracle

    const pricesAB = await b.facadeLib2.getOracleAssetsPrices(b.converter.address, MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN);
    const priceA = +formatUnits(pricesAB[0], 18).toString();
    const priceB = +formatUnits(pricesAB[1], 18).toString();
    console.log("priceA, priceB", priceA, priceB);

    const ttA = [priceA - 0.0008, priceA - 0.0006, priceA + 0.0008, priceA + 0.0006].map(x => parseUnits(x.toString(), 18));
    const ttB = [
      priceB - 0.0008,
      priceB - 0.0006,
      priceB + (triggerOn ? -0.0001 : 0.0004), // (!) fuse ON/OFF
      priceB + (triggerOn ? -0.0002 : 0.0002),
    ].map(x => parseUnits(x.toString(), 18));

    await b.strategy.setFuseThresholds(0, [ttA[0], ttA[1], ttA[2], ttA[3]]);
    await b.strategy.setFuseThresholds(1, [ttB[0], ttB[1], ttB[2], ttB[3]]);
  }

  /** Put addition amounts of tokenA and tokenB to balance of the profit holder */
  static async prepareToHardwork(signer: SignerWithAddress, b: IBuilderResults) {
    const state = await PackedData.getDefaultState(b.strategy);
    const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
    const platformVoter = await IController__factory.connect(await converterStrategyBase.controller(), signer).platformVoter();

    await converterStrategyBase.connect(await Misc.impersonate(platformVoter)).setCompoundRatio(90_000);

    await TokenUtils.getToken(
      state.tokenA,
      state.profitHolder,
      parseUnits('100', await IERC20Metadata__factory.connect(state.tokenA, signer).decimals())
    );
    await TokenUtils.getToken(
      state.tokenB,
      state.profitHolder,
      parseUnits('100', await IERC20Metadata__factory.connect(state.tokenB, signer).decimals())
    );
  }

  /**
   * Deploy new implemenation of TetuConverter-contract and upgrade proxy
   */
  static async injectTetuConverter(signer: SignerWithAddress) {
    const core = await DeployerUtilsLocal.getCoreAddresses();
    const tetuConverter = getConverterAddress();

    const converterLogic = await DeployerUtils.deployContract(signer, "TetuConverter");
    const controller = ControllerV2__factory.connect(core.controller, signer);
    const governance = await controller.governance();
    const controllerAsGov = controller.connect(await Misc.impersonate(governance));

    await controllerAsGov.announceProxyUpgrade([tetuConverter], [converterLogic.address]);
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerAsGov.upgradeProxy([tetuConverter]);
  }

  /**
   * Get swap amount to move price up/down in the pool
   * @param signer
   * @param b
   * @param tokenA
   * @param tokenB
   * @param priceTokenBUp
   *  true - move price of token B up == swap A to B
   *  false - move price of token B down == swap B to A
   * @param swapAmountRatio
   * * How to calculate swapAmount to move price in the pool
   *  * A = amount of the token in the current tick
   *  * swapAmount = A * alpha
   * @return
   *  priceTokenBUp === true: amount of token A to swap
   *  priceTokenBUp === false: amount of token B to swap
   */
  static async getSwapAmount2(
    signer: SignerWithAddress,
    b: IBuilderResults,
    tokenA: string,
    tokenB: string,
    priceTokenBUp: boolean,
    swapAmountRatio: number = 1
  ): Promise<BigNumber> {
    const platform = await ConverterStrategyBase__factory.connect(b.strategy.address, signer).PLATFORM();
    const lib = this.getLib(platform, b);

    const amountsInCurrentTick = await PairStrategyLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, platform, lib, b.pool);
    console.log("amountsInCurrentTick", amountsInCurrentTick);

    if (priceTokenBUp) {
      // calculate amount B that we are going to receive
      const amountBOut = amountsInCurrentTick[1].mul(
        parseUnits(swapAmountRatio.toString(), 18)
      ).div(Misc.ONE18);

      console.log("amountBOut", amountBOut);
      const amountAIn = await PairStrategyLiquidityUtils.quoteExactOutputSingle(
        signer,
        b,
        tokenA,
        tokenB,
        amountBOut
      );
      console.log("amountAIn.to.up", amountAIn);
      return amountAIn;
    } else {
      // calculate amount A that we are going to receive
      const amountAOut = amountsInCurrentTick[0].mul(
        parseUnits(swapAmountRatio.toString(), 18)
      ).div(Misc.ONE18);

      console.log("amountAOut", amountAOut);
      const amountBIn = await PairStrategyLiquidityUtils.quoteExactOutputSingle(
        signer,
        b,
        tokenB,
        tokenA,
        amountAOut
      );
      console.log("amountBIn.to.down", amountBIn);
      return amountBIn;
    }
  }

  static async unfoldBorrowsRepaySwapRepay(
    strategyAsOperator: IRebalancingV2Strategy,
    aggregator: string,
    useSingleIteration: boolean,
    saveState?: (title: string) => Promise<void>,
  ) {
    const state = await PackedData.getDefaultState(strategyAsOperator);

    const planEntryData = defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [PLAN_REPAY_SWAP_REPAY, Misc.MAX_UINT]
    );

    let step = 0;
    while (true) {
      console.log("unfoldBorrows.quoteWithdrawByAgg.callStatic --------------------------------");
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
      console.log("unfoldBorrows.quoteWithdrawByAgg.FINISH --------------------------------", quote);

      let swapData: BytesLike = "0x";
      const tokenToSwap = quote.amountToSwap.eq(0) ? Misc.ZERO_ADDRESS : quote.tokenToSwap;
      const amountToSwap = quote.amountToSwap.eq(0) ? 0 : quote.amountToSwap;

      if (tokenToSwap !== Misc.ZERO_ADDRESS) {
        if (aggregator === MaticAddresses.AGG_ONEINCH_V5) {
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
        } else if (aggregator === MaticAddresses.TETU_LIQUIDATOR) {
          swapData = AggregatorUtils.buildTxForSwapUsingLiquidatorAsAggregator({
            tokenIn: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
            tokenOut: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
            amount: quote.amountToSwap,
            slippage: BigNumber.from(5_000)
          });
          console.log("swapData for tetu liquidator", swapData);
        }
      }
      console.log("unfoldBorrows.withdrawByAggStep.callStatic --------------------------------", quote);
      console.log("tokenToSwap", tokenToSwap);
      console.log("AGGREGATOR", aggregator) ;
      console.log("amountToSwap", amountToSwap);
      console.log("swapData", swapData);
      console.log("planEntryData", planEntryData);
      console.log("ENTRY_TO_POOL_IS_ALLOWED", ENTRY_TO_POOL_IS_ALLOWED);

      const completed = await strategyAsOperator.callStatic.withdrawByAggStep(
        tokenToSwap,
        aggregator,
        amountToSwap,
        swapData,
        planEntryData,
        ENTRY_TO_POOL_IS_ALLOWED,
        {gasLimit: 19_000_000}
      );

      console.log("unfoldBorrows.withdrawByAggStep.execute --------------------------------", quote);
      await strategyAsOperator.withdrawByAggStep(
        tokenToSwap,
        aggregator,
        amountToSwap,
        swapData,
        planEntryData,
        ENTRY_TO_POOL_IS_ALLOWED,
        {gasLimit: 19_000_000}
      );
      console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");

      if (saveState) {
        await saveState(`u${++step}`);
      }
      if (useSingleIteration) break;
      if (completed) break;
    }
  }

  /**
   * Make "deposit-rebalance" cycles until expected count of rebalances won't make.
   */
  static async prepareOverCollateral(
      b: IBuilderResults,
      p: IPrepareOverCollateralParams,
      pathOut: string,
      signer: SignerWithAddress,
      signer2: SignerWithAddress,
      swapAmountRatio: number
  ) : Promise<IListStates> {
  const states: IStateNum[] = [];

  const defaultState = await PackedData.getDefaultState(b.strategy);
  const strategyAsSigner = StrategyBaseV2__factory.connect(b.strategy.address, signer);

  console.log('deposit...');
  await b.vault.setDoHardWorkOnInvest(false);
  await TokenUtils.getToken(b.asset, signer2.address, parseUnits('1000', 6));
  await b.vault.connect(signer2).deposit(parseUnits('1000', 6), signer2.address, { gasLimit: 19_000_000 });

  const depositAmount1 = parseUnits('10000', b.assetDecimals);
  await TokenUtils.getToken(b.asset, signer.address, depositAmount1);
  await depositToVault(b.vault, signer, depositAmount1, b.assetDecimals, b.assetCtr, b.insurance);
  states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `init`));
  await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

  let loopStep = 0;
  let countRebalances = 0;

  // we recalculate swapAmount once per new tick
  let upperTick: number | undefined;
  let swapAmount: BigNumber = BigNumber.from(0);

  while (countRebalances < p.countRebalances) {
    const state = await PackedData.getDefaultState(b.strategy);
    if (upperTick !== state.upperTick) {
      swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
          signer,
          b,
          state.tokenA,
          state.tokenB,
          p.movePricesUp,
          swapAmountRatio
      );
      upperTick = state.upperTick;
    }
    console.log("prepareOverCollateral.swapAmount", swapAmount);
    console.log("prepareOverCollateral.upperTick", upperTick);

    console.log('------------------ CYCLE', loopStep, '------------------');

    await TimeUtils.advanceNBlocks(300);

    if (p.movePricesUp) {
      await UniversalUtils.movePoolPriceUp(signer2, defaultState.pool, defaultState.tokenA, defaultState.tokenB, b.swapper, swapAmount);
    } else {
      await UniversalUtils.movePoolPriceDown(signer2, defaultState.pool, defaultState.tokenA, defaultState.tokenB, b.swapper, swapAmount);
    }
    states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `p${loopStep}`));
    await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

    // we suppose the rebalance happens immediately when it needs
    if (await b.strategy.needRebalance()) {
      console.log('------------------ REBALANCE' , loopStep, '------------------');

      const rebalanced = await NoSwapRebalanceEvents.makeRebalanceNoSwap(b.strategy.connect(signer));
      await printVaultState(b.vault, b.splitter, strategyAsSigner, b.assetCtr, b.assetDecimals);

      states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `r${countRebalances}`, {rebalanced}));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

      ++countRebalances;
    }
    ++loopStep;
  }

  return {states};
}

}