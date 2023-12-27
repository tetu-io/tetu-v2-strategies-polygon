import {IBuilderResults, IStrategyBasicInfo} from "./PairBasedStrategyBuilder";
import {
  ConverterStrategyBase__factory,
  IRebalancingV2Strategy, IRebalancingV2Strategy__factory, PairBasedStrategyReader, StrategyBaseV2__factory
} from "../../../../typechain";
import {IDefaultState, PackedData} from "../../utils/PackedData";
import {BigNumber, BytesLike} from "ethers";
import {PairStrategyLiquidityUtils} from "./PairStrategyLiquidityUtils";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {IPriceChanges, UniversalUtils} from "../UniversalUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {IERC20Metadata__factory} from "../../../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {Misc} from "../../../../scripts/utils/Misc";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IController__factory} from "../../../../typechain/factories/@tetu_io/tetu-converter/contracts/interfaces";
import {AggregatorType, AggregatorUtils} from "../../utils/AggregatorUtils";
import {IStateNum, StateUtilsNum} from "../../utils/StateUtilsNum";
import {depositToVault, printVaultState} from "../../universalTestUtils/StrategyTestUtils";
import {CaptureEvents, IEventsSet} from "../CaptureEvents";
import {ENTRY_TO_POOL_IS_ALLOWED, PLAN_REPAY_SWAP_REPAY_1} from "../../AppConstants";
import {UniversalTestUtils} from "../../utils/UniversalTestUtils";
import {trimDecimals} from "../../utils/MathUtils";

export interface IPrepareOverCollateralParams {
  countRebalances: number;
  movePricesUp: boolean;
  swapAmountRatio: number;
  amountToDepositBySigner2?: string; // default 0
  amountToDepositBySigner?: string; // default 0
  changePricesInOppositeDirectionAtFirst?: boolean; // false by default
}

export interface IListStates {
  states: IStateNum[];
}

/** Utils to set up "current state of pair strategy" in tests */
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
      const swapAmount = await this.getSwapAmount2(signer, b, state.tokenA, state.tokenB, movePriceUp, swapAmountRatio);
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
    const state = await PackedData.getDefaultState(b.strategy);

    const pricesAB = await b.facadeLib2.getOracleAssetsPrice(b.converter.address, state.tokenA, state.tokenB);
    const priceAB = +formatUnits(pricesAB, 18).toString();
    console.log("priceAB", priceAB);

    const ttA = [
      priceAB - 0.0004,
      priceAB - 0.0003,
      priceAB + (triggerOn ? -0.0001 : 0.0004),
      priceAB + (triggerOn ? -0.0002 : 0.0003),
    ].map(x => parseUnits(x.toString(), 18));

    await b.strategy.setFuseThresholds([ttA[0], ttA[1], ttA[2], ttA[3]]);
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
    chainId: number,
    strategyAsOperator: IRebalancingV2Strategy,
    aggregator: string,
    aggregatorType: AggregatorType,
    isWithdrawCompleted: (lastState?: IStateNum) => boolean,
    saveState?: (title: string, eventsState: IEventsSet) => Promise<IStateNum>,
    requiredAmountToReduceDebtCalculator?: () => Promise<BigNumber>,
  ) {
    const state = await PackedData.getDefaultState(strategyAsOperator);

    let step = 0;
    while (true) {
      const requiredAmountToReduceDebt: BigNumber = requiredAmountToReduceDebtCalculator
        ? await requiredAmountToReduceDebtCalculator()
        : BigNumber.from(0);

      const planEntryData = defaultAbiCoder.encode(
        ["uint256", "uint256", "uint256"],
        [
          PLAN_REPAY_SWAP_REPAY_1,
          Misc.MAX_UINT,
          requiredAmountToReduceDebt
        ]
      );

      console.log("unfoldBorrows.quoteWithdrawByAgg.callStatic --------------------------------");
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
      console.log("unfoldBorrows.quoteWithdrawByAgg.FINISH --------------------------------", quote);

      const tokenToSwap = quote.amountToSwap.eq(0) ? Misc.ZERO_ADDRESS : quote.tokenToSwap;
      const amountToSwap = quote.amountToSwap.eq(0) ? BigNumber.from(0) : quote.amountToSwap;

      let swapData: BytesLike = "0x";
      if (tokenToSwap !== Misc.ZERO_ADDRESS) {
        swapData = await AggregatorUtils.buildSwapData(
          await Misc.impersonate(await strategyAsOperator.signer.getAddress()), // == signer
          chainId,
          aggregatorType,
          quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
          quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
          quote.amountToSwap,
          strategyAsOperator.address,
        );
      }
      console.log("unfoldBorrows.withdrawByAggStep.execute --------------------------------");
      // console.log("tokenToSwap", tokenToSwap);
      // console.log("AGGREGATOR", aggregator) ;
      console.log("amountToSwap", amountToSwap);
      // console.log("swapData", swapData);
      // console.log("planEntryData", planEntryData);

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

      let lastState: IStateNum | undefined;
      if (saveState) {
        lastState = await saveState(`u${++step}`, eventsSet);
      }
      if (isWithdrawCompleted(lastState)) break; // completed
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
      signer2: SignerWithAddress
  ) : Promise<IListStates> {
  console.log("prepareTwistedDebts.start");
  const states: IStateNum[] = [];

  const defaultState = await PackedData.getDefaultState(b.strategy);
  const strategyAsSigner = StrategyBaseV2__factory.connect(b.strategy.address, signer);

  console.log('deposit...');
  await b.vault.setDoHardWorkOnInvest(false);
  if (p.amountToDepositBySigner2) {
    await TokenUtils.getToken(b.asset, signer2.address, parseUnits(p.amountToDepositBySigner2, 6));
    await b.vault.connect(signer2).deposit(parseUnits(p.amountToDepositBySigner2, 6), signer2.address, {gasLimit: 19_000_000});
  }

  if (p.amountToDepositBySigner) {
    const depositAmount1 = parseUnits(p.amountToDepositBySigner, b.assetDecimals);
    await TokenUtils.getToken(b.asset, signer.address, depositAmount1);
    await depositToVault(b.vault, signer, depositAmount1, b.assetDecimals, b.assetCtr, b.insurance);
  }
  states.push(await StateUtilsNum.getStatePair(signer2, signer, b.strategy, b.vault, `init`));
  await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

  let loopStep = 0;
  let countRebalances = 0;

  // we recalculate swapAmount once per new tick
  let upperTick: number | undefined;
  let swapAmount: BigNumber = BigNumber.from(0);

  if (p.changePricesInOppositeDirectionAtFirst) {
    console.log("Prepare: change prices in opposite direction at first");
    const state = await PackedData.getDefaultState(b.strategy);
    const swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
      signer,
      b,
      state.tokenA,
      state.tokenB,
      p.movePricesUp, // weird, but we need to calculate swap amount for movePriceUp, not for !movePriceUp here
      p.swapAmountRatio
    );
    await this.movePriceBySteps(signer, b, !p.movePricesUp, defaultState, swapAmount);
  }

  while (countRebalances < p.countRebalances) {
    const state = await PackedData.getDefaultState(b.strategy);
    if (upperTick !== state.upperTick) {
      swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
          signer,
          b,
          state.tokenA,
          state.tokenB,
          p.movePricesUp,
          p.swapAmountRatio
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
    b: IStrategyBasicInfo,
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
      : (totalSwapAmountForDown || totalSwapAmount);

    for (let i = 0; i < countSteps; ++i) {
      const swapAmount = totalAmountToSwap.div(countSteps ?? 5);
      let pricesWereChanged: IPriceChanges;
      if (movePricesUpDown) {
        pricesWereChanged = await UniversalUtils.movePoolPriceUp(signer, state, b.swapper, swapAmount, 80000, b.swapHelper);
      } else {
        pricesWereChanged = await UniversalUtils.movePoolPriceDown(signer, state, b.swapper, swapAmount, 80000, false, b.swapHelper);
      }

      console.log("pricesWereChanged", pricesWereChanged);
      if (pricesWereChanged.priceBChange.eq(0) && pricesWereChanged.priceAChange.eq(0)) {
        throw Error("movePriceBySteps cannot change prices");
      }
    }
  }

  /** Add given amount to insurance */
  static async prepareInsurance(b: IBuilderResults, amount: string = "1000") {
    const decimals = await IERC20Metadata__factory.connect(b.asset, b.vault.signer).decimals();
    await TokenUtils.getToken(b.asset, await b.vault.insurance(), parseUnits(amount, decimals));
  }

  static async prepareLiquidationThresholds(signer: SignerWithAddress, strategy: string, value: string = "0.001") {
    const operator = await UniversalTestUtils.getAnOperator(strategy, signer);
    const state = await PackedData.getDefaultState(IRebalancingV2Strategy__factory.connect(strategy, signer));
    const decimalsA = await IERC20Metadata__factory.connect(state.tokenA, signer).decimals();
    const decimalsB = await IERC20Metadata__factory.connect(state.tokenB, signer).decimals();

    const converterStrategyBase = await ConverterStrategyBase__factory.connect(strategy, signer);
    await converterStrategyBase.connect(operator).setLiquidationThreshold(state.tokenA, parseUnits(value, decimalsA));
    await converterStrategyBase.connect(operator).setLiquidationThreshold(state.tokenB, parseUnits(value, decimalsB));
  }

  static async getAmountToReduceDebtForStrategy(
    strategy: string,
    reader: PairBasedStrategyReader,
    targetLockedPercent: number,
  ): Promise<BigNumber> {
    return reader.getAmountToReduceDebtForStrategy(strategy,  Math.max(1, Math.round(targetLockedPercent)));
  }

  static async getRequiredAmountToReduceDebt(
    signer: SignerWithAddress,
    state0: IStateNum,
    reader:PairBasedStrategyReader,
    targetLockedPercent: number,
    underlying: string,
  ): Promise<BigNumber> {
    const directBorrow = state0.converterDirect.collaterals[0] > 0;
    const assetIndex = directBorrow ? 0 : 1;
    const borrowAssetIndex = directBorrow ? 1 : 0;
    const assetDecimals = await IERC20Metadata__factory.connect(underlying, signer).decimals();
    const decimalBorrowAsset = await IERC20Metadata__factory.connect(state0.converterDirect.borrowAssets[borrowAssetIndex], signer).decimals();

    if (directBorrow) {
        const requiredAmountToReduceDebt = await reader.getAmountToReduceDebt(
            parseUnits(state0.strategy.totalAssets.toString(), assetDecimals),
            true,
            parseUnits(state0.converterDirect.collaterals[0].toString(), assetDecimals),
            parseUnits(state0.converterDirect.amountsToRepay[0].toString(), assetDecimals),
            [
                parseUnits(state0.converterDirect.borrowAssetsPrices[0].toString(), 18),
                parseUnits(state0.converterDirect.borrowAssetsPrices[1].toString(), 18),
            ],
            [parseUnits("1", assetDecimals), parseUnits("1", decimalBorrowAsset)],
            Math.max(1, Math.round(targetLockedPercent))
        );
        console.log("requiredAmountToReduceDebt (direct debt)", requiredAmountToReduceDebt);
        return requiredAmountToReduceDebt;
    } else {
        const requiredAmountToReduceDebt = await reader.getAmountToReduceDebt(
            parseUnits(state0.strategy.totalAssets.toString(), decimalBorrowAsset),
            false,
            parseUnits(state0.converterReverse.collaterals[0].toString(), assetDecimals),
            parseUnits(state0.converterReverse.amountsToRepay[0].toString(), assetDecimals),
            [
                parseUnits(state0.converterReverse.borrowAssetsPrices[0].toString(), 18),
                parseUnits(state0.converterReverse.borrowAssetsPrices[1].toString(), 18),
            ],
            [parseUnits("1", decimalBorrowAsset), parseUnits("1", assetDecimals)],
            Math.max(1, Math.round(targetLockedPercent))
        );
        console.log("requiredAmountToReduceDebt (reverse debt)", requiredAmountToReduceDebt);
        return requiredAmountToReduceDebt;
    }
  }
}