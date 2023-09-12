import {IBuilderResults, IStrategyBasicInfo} from "./PairBasedStrategyBuilder";
import {
  AlgebraLib,
  ControllerV2__factory,
  ConverterStrategyBase__factory,
  IRebalancingV2Strategy, KyberLib,
  StrategyBaseV2__factory,
  UniswapV3Lib
} from "../../../typechain";
import {IDefaultState, PackedData} from "../utils/PackedData";
import {BigNumber, BytesLike} from "ethers";
import {PairStrategyLiquidityUtils} from "./PairStrategyLiquidityUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {IPriceChanges, UniversalUtils} from "./UniversalUtils";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {IERC20Metadata__factory} from "../../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {getConverterAddress, Misc} from "../../../scripts/utils/Misc";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IController__factory} from "../../../typechain/factories/@tetu_io/tetu-converter/contracts/interfaces";
import {AggregatorUtils} from "../utils/AggregatorUtils";
import {IStateNum, StateUtilsNum} from "../utils/StateUtilsNum";
import {depositToVault, printVaultState} from "../../StrategyTestUtils";
import {CaptureEvents, IEventsSet} from "./CaptureEvents";
import {ENTRY_TO_POOL_IS_ALLOWED, PLAN_REPAY_SWAP_REPAY} from "../AppConstants";

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

  /** Set up "neeRebalance = true" */
  static async prepareNeedRebalanceOn(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    b: IStrategyBasicInfo,
    swapAmountRatio: number = 1.1,
    movePriceUp: boolean = true
  ) {

    // move strategy to "need to rebalance" state
    let countRebalance = 0;
    for (let i = 0; i < 15; ++i) {
      const state = await PackedData.getDefaultState(b.strategy);
      console.log("lowerTick, upperTick", state.lowerTick, state.upperTick)

      console.log("i", i);
      const swapAmount = await this.getSwapAmount2(
        signer,
        b,
        state.tokenA,
        state.tokenB,
        movePriceUp,
        swapAmountRatio
      );
      if (movePriceUp) {
        await UniversalUtils.movePoolPriceUp(signer2, state, b.swapper, swapAmount, 40000, b.swapHelper);
      } else {
        await UniversalUtils.movePoolPriceDown(signer2, state, b.swapper, swapAmount, 40000, false, b.swapHelper);
      }
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

  /** Set up "neeRebalance = true" */
  static async prepareNeedRebalanceOnBigSwap(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    b: IStrategyBasicInfo
  ) {
    const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
    const assetDecimals = await IERC20Metadata__factory.connect(await converterStrategyBase.asset(), signer).decimals()
    const swapAssetValueForPriceMove = parseUnits('500000', assetDecimals);
    const state = await PackedData.getDefaultState(b.strategy);

    await UniversalUtils.movePoolPriceUp(signer2, state, b.swapper, swapAssetValueForPriceMove, 40_000, b.swapHelper);
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
  static async prepareToHardwork(signer: SignerWithAddress, strategy: IRebalancingV2Strategy) {
    const state = await PackedData.getDefaultState(strategy);
    const converterStrategyBase = ConverterStrategyBase__factory.connect(strategy.address, signer);
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
   * Deploy new implementation of TetuConverter-contract and upgrade proxy
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
   * Deploy new implementation of the given strategy and upgrade proxy
   */
  static async injectStrategy(
    signer: SignerWithAddress,
    strategyProxy: string,
    contractName: string
  ) {
    const strategyLogic = await DeployerUtils.deployContract(signer, contractName);
    const controller = ControllerV2__factory.connect(
      await ConverterStrategyBase__factory.connect(strategyProxy, signer).controller(),
      signer
    );
    const governance = await controller.governance();
    const controllerAsGov = controller.connect(await Misc.impersonate(governance));

    await controllerAsGov.removeProxyAnnounce(strategyProxy);
    await controllerAsGov.announceProxyUpgrade([strategyProxy], [strategyLogic.address]);
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerAsGov.upgradeProxy([strategyProxy]);
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
    b: IStrategyBasicInfo,
    tokenA: string,
    tokenB: string,
    priceTokenBUp: boolean,
    swapAmountRatio: number = 1
  ): Promise<BigNumber> {
    const platform = await ConverterStrategyBase__factory.connect(b.strategy.address, signer).PLATFORM();
    const lib = b.lib;

    const amountsInCurrentTick = await PairStrategyLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, platform, lib, b.pool);
    console.log("amountsInCurrentTick", amountsInCurrentTick);

    if (priceTokenBUp) {
      // calculate amount B that we are going to receive
      const amountBOut = amountsInCurrentTick[1].mul(
        parseUnits(swapAmountRatio.toString(), 18)
      ).div(Misc.ONE18);

      // zero amount is not allowed, we will receive i.e. "AS" error on Algebra
      const requiredAmountBOut = amountBOut.eq(0)
        ? parseUnits("1000", (await IERC20Metadata__factory.connect(tokenB, signer).decimals()))
        : amountBOut;

      console.log("amountBOut", amountBOut);
      const amountAIn = await PairStrategyLiquidityUtils.quoteExactOutputSingle(
        signer,
        b,
        tokenA,
        tokenB,
        requiredAmountBOut
      );
      console.log("amountAIn.to.up", amountAIn);
      return amountAIn.eq(0)
        ? parseUnits("1000", (await IERC20Metadata__factory.connect(tokenA, signer).decimals()))
        : amountAIn;
    } else {
      // calculate amount A that we are going to receive
      const amountAOut = amountsInCurrentTick[0].mul(
        parseUnits(swapAmountRatio.toString(), 18)
      ).div(Misc.ONE18);

      // zero amount is not allowed, we will receive i.e. "AS" error on Algebra
      const requiredAmountAOut = amountAOut.eq(0)
        ? parseUnits("1000", (await IERC20Metadata__factory.connect(tokenA, signer).decimals()))
        : amountAOut;

      console.log("amountAOut", amountAOut);
      const amountBIn = await PairStrategyLiquidityUtils.quoteExactOutputSingle(
        signer,
        b,
        tokenB,
        tokenA,
        requiredAmountAOut
      );
      console.log("amountBIn.to.down", amountBIn);
      return amountBIn.eq(0)
        ? parseUnits("1000", (await IERC20Metadata__factory.connect(tokenB, signer).decimals()))
        : amountBIn;

    }
  }

  static async unfoldBorrowsRepaySwapRepay(
    strategyAsOperator: IRebalancingV2Strategy,
    aggregator: string,
    isWithdrawCompleted: () => boolean,
    saveState?: (title: string, eventsState: IEventsSet) => Promise<void>,
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
      const amountToSwap = quote.amountToSwap.eq(0) ? BigNumber.from(0) : quote.amountToSwap;

      if (tokenToSwap !== Misc.ZERO_ADDRESS) {
        if (aggregator === MaticAddresses.AGG_ONEINCH_V5) {
          swapData = await AggregatorUtils.buildSwapTransactionData(
            quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
            quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
            quote.amountToSwap,
            strategyAsOperator.address,
          );
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
      console.log("unfoldBorrows.withdrawByAggStep.execute --------------------------------");
      console.log("tokenToSwap", tokenToSwap);
      console.log("AGGREGATOR", aggregator) ;
      console.log("amountToSwap", amountToSwap);
      console.log("swapData", swapData);
      console.log("planEntryData", planEntryData);

      const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
        strategyAsOperator,
        tokenToSwap,
        aggregator,
        amountToSwap,
        swapData,
        planEntryData,
        ENTRY_TO_POOL_IS_ALLOWED
      );
      console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");

      if (saveState) {
        await saveState(`u${++step}`, eventsSet);
      }
      if (isWithdrawCompleted()) break; // completed
    }
  }

  /**
   * Make "deposit-rebalance" cycles until expected count of rebalances won't make.
   * As result, we will have high locked-amount in converter and relatively high percent of locked amounts.
   */
  static async prepareTwistedDebts(
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

    await this.movePriceBySteps(signer, b, p.movePricesUp, defaultState, swapAmount);
    states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `p${loopStep}`));
    await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

    // we suppose the rebalance happens immediately when it needs
    if (await b.strategy.needRebalance()) {
      console.log('------------------ REBALANCE' , loopStep, '------------------');

      const rebalanced = await CaptureEvents.makeRebalanceNoSwap(b.strategy.connect(signer));
      await printVaultState(b.vault, b.splitter, strategyAsSigner, b.assetCtr, b.assetDecimals);

      states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `r${countRebalances}`, {eventsSet: rebalanced}));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

      ++countRebalances;
    }
    ++loopStep;
  }

  return {states};
}

  static async movePriceBySteps(
    signer: SignerWithAddress,
    b: IBuilderResults,
    movePricesUpDown: boolean,
    state: IDefaultState,
    totalSwapAmount: BigNumber,
    totalSwapAmountForDown?: BigNumber,
    countIterations?: number
  ) {
    console.log("move prices by steps...");
    const countSteps = countIterations ?? 1;
    const totalAmountToSwap = movePricesUpDown
      ? totalSwapAmount
      : totalSwapAmountForDown || totalSwapAmount;

    for (let i = 0; i < countSteps; ++i) {
      const swapAmount = totalAmountToSwap.div(countSteps ?? 5);
      let pricesWereChanged: IPriceChanges;
      if (movePricesUpDown) {
        pricesWereChanged = await UniversalUtils.movePoolPriceUp(signer, state, b.swapper, swapAmount, 40000, b.swapHelper);
      } else {
        pricesWereChanged = await UniversalUtils.movePoolPriceDown(signer, state, b.swapper, swapAmount, 40000, false, b.swapHelper);
      }

      console.log("pricesWereChanged", pricesWereChanged);
      if (pricesWereChanged.priceBChange.eq(0) && pricesWereChanged.priceAChange.eq(0)) {
        throw Error("movePriceBySteps cannot change prices");
      }
    }
  }

  static async prepareInsurance(b: IBuilderResults, amount: string = "1000") {
    const decimals = await IERC20Metadata__factory.connect(b.asset, b.vault.signer).decimals();
    await TokenUtils.getToken(b.asset, await b.vault.insurance(), parseUnits(amount, decimals));
  }
}