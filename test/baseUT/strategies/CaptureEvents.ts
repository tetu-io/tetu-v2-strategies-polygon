import {BigNumber, Event, ContractReceipt, BigNumberish, BytesLike, Signer} from "ethers";
import {
  AlgebraConverterStrategyLogicLib__factory, ConverterStrategyBase,
  ConverterStrategyBase__factory,
  ConverterStrategyBaseLib2__factory, ConverterStrategyBaseLib__factory, IERC20Metadata__factory,
  IRebalancingV2Strategy, IStrategyStrict__factory, ITetuVaultV2,
  KyberConverterStrategyLogicLib__factory,
  PairBasedStrategyLib__factory, StrategySplitterV2__factory, TetuVaultV2, TetuVaultV2__factory,
  UniswapV3ConverterStrategyLogicLib__factory
} from "../../../typechain";
import {
  FuseStatusChangedEventObject,
  SwapByAggEventObject
} from "../../../typechain/contracts/strategies/pair/PairBasedStrategyLib";
import {
  RebalancedDebtEventObject,
  RebalancedEventObject
} from "../../../typechain/contracts/strategies/uniswap/UniswapV3ConverterStrategyLogicLib";
import {PLATFORM_ALGEBRA, PLATFORM_UNIV3} from "./AppPlatforms";
import {
  BorrowResultsEventObject, ChangeDebtToInsuranceOnProfitEventObject,
  FixPriceChangesEventObject,
  OnCoverLossEventObject,
  OnIncreaseDebtToInsuranceEventObject,
  SendToInsuranceEventObject,
  UncoveredLossEventObject,
  OnEarningOnWithdrawEventObject,
} from "../../../typechain/contracts/strategies/ConverterStrategyBaseLib2";
import {formatUnits} from "ethers/lib/utils";
import {
  HardWorkEventObject,
  LossEventObject
} from '../../../typechain/@tetu_io/tetu-contracts-v2/contracts/vault/StrategySplitterV2';
import {
  FeeTransferEventObject,
  LossCoveredEventObject
} from "../../../typechain/@tetu_io/tetu-contracts-v2/contracts/vault/TetuVaultV2";
import {
  OnCoverDebtToInsuranceEventObject,
  OnPayDebtToInsuranceEvent, OnPayDebtToInsuranceEventObject,
  RecycleEventObject
} from "../../../typechain/contracts/strategies/ConverterStrategyBaseLib";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  OnHardWorkEarnedLostEventObject
} from '../../../typechain/contracts/strategies/ConverterStrategyBase';
import {strategy} from "../../../typechain/@tetu_io/tetu-contracts-v2/contracts";

/** TetuVaultV2 */
interface ILossCoveredEvent {
  amount: number;
}

interface IFeeTransferEvent {
  amount: number;
}

/**
 * StrategyLib
 */
interface IInvestEvent {
  splitter: string;
  amount: number;
}

/**
 * StrategySplitterV2
 */
interface IHardWorkEvent {
  sender: string;
  strategy: string;
  tvl: number;
  earned: number;
  lost: number;
  apr: number;
  avgApr: number;
}

/**
 * StrategySplitterV2
 */
interface ILossEvent {
  strategy: string;
  amount: number;
}

/**
 * StrategySplitterV2
 */
interface IInvestedEvent {
  strategy: string;
  amount: number;
}

/**
 * PairBasedStrategyLib
 */
interface IFuseStatusChanged {
  fuseStatus: number;
}

/**
 * ConverterStrategyBaseLib2.coverLossAfterPriceChanging
 */
interface IUncoveredLossEvent {
  lossCovered: number;
  lossUncovered: number;
  investedAssetsBefore: number;
  investedAssetsAfter: number;
}

interface IFixPriceChanges {
  investedAssetsBefore: number;
  investedAssetsOut: number;
  debtToInsuranceBefore: number;
  debtToInsuranceAfter: number;
  increaseToDebt: number;
}

interface IOnIncreaseDebtToInsurance {
  tokens: string[];
  deltaGains: number[];
  deltaLosses: number[];
  prices: number[];
  increaseToDebt: number;
}

interface IOnPayDebtToInsurance {
  debtToInsuranceBefore: number;
  debtToInsuranceAfter: number;
}

interface IOnCoverDebtToInsurance {
  rewardToken: string;
  rewardAmount: number;
  debtToCover: number;
  debtLeftovers: number;
}

interface IBorrowResults {
  gains: number;
  losses: number;
}

interface IRebalancedEvent {
  loss: number;
  profitToCover: number;
  coveredByRewards: number;
}

interface IRebalancedDebtEvent {
  loss: number;
  profitToCover: number;
  coveredByRewards: number;
}

interface ISendToInsurance {
  sentAmount: number;
  unsentAmount: number;
}

interface IOpenPositionEvent {
  converter: string;
  collateralAsset: string;
  collateralAmount: BigNumber;
  borrowAsset: string;
  borrowedAmount: BigNumber;
  recepient: string;
}

interface IClosePositionEvent {
  collateralAsset: string;
  borrowAsset: string;
  amountRepay: BigNumber;
  recepient: string;
  returnedAssetAmountOut: BigNumber;
  returnedBorrowAmountOut: BigNumber;
}

interface ILiquidationEvent {
  tokenIn: string;
  tokenOut: string;
  amountIn: BigNumber;
  spentAmountIn: BigNumber;
  receivedAmountOut: BigNumber;
}

interface IReturnAssetToConverter {
  asset: string;
  amount: BigNumber;
}

interface IRecycle {
  rewardTokens: string[];
  amountsToForward: BigNumber[];
  toPerf: number;
  toInsurance: number;
}

interface ISwapByAgg {
  amountToSwap: number;
  amountIn: number;
  amountOut: number;
  amountOutExpected: number;
  aggregator: string;
}

interface IOnCoverLoss {
  lossToCover: number;
  amountCovered: number;
  debtToInsuranceInc: number;
  lossUncovered: number;
}

interface IChangeDebtToInsuranceOnProfit {
  debtToInsuranceBefore: number;
  increaseToDebt: number;
}

interface IOnEarningOnWithdraw {
  earned: number;
  earnedByPrice: number;
}

interface IOnHardWorkEarnedLost {
  /** InvestedAssets after call of _fixPriceChanges */
  investedAssetsNewPrices: number;
  /** Earned by prices from _fixPriceChanges */
  earnedByPrices: number;
  /** Earned in _handleRewards */
  earnedHandleRewards: number;
  /** Lost in _handleRewards */
  lostHandleRewards: number;
  /** Earned in _depositToPoolUniversal */
  earnedDeposit: number;
  /** Lost in _depositToPoolUniversal */
  lostDeposit: number;
  paidDebtToInsurance: number;
}

export interface IEventsSet {
  lossEvent?: ILossEvent[];
  lossCoveredEvent?: ILossCoveredEvent[];
  feeTransferEvent?: IFeeTransferEvent[];
  uncoveredLossEvent?: IUncoveredLossEvent[];
  sendToInsurance?: ISendToInsurance[];
  coverLoss?: IOnCoverLoss[];

  rebalanced?: IRebalancedEvent;
  rebalancedDebt?: IRebalancedDebtEvent;
  fuseStatusChanged?: IFuseStatusChanged;
  recycle?: IRecycle;
  swapByAgg?: ISwapByAgg;

  fixPriceChanges?: IFixPriceChanges[];
  changeDebtToInsuranceOnProfit?: IChangeDebtToInsuranceOnProfit[];
  borrowResults?: IBorrowResults[];
  increaseDebtToInsurance?: IOnIncreaseDebtToInsurance[];

  payDebtToInsurance?: IOnPayDebtToInsurance[];
  coverDebtToInsurance?: IOnCoverDebtToInsurance[];

  onHardWorkEarnedLost?: IOnHardWorkEarnedLost;
  hardwork?: IHardWorkEvent;

  earningOnWithdraw?: IOnEarningOnWithdraw[];
}

export interface ISummaryFromEventsSet {
  lossSplitter: number;
  lossCoveredVault: number;
  feeTransferVault: number;
  onCoverLoss: {
    lossToCover: number;
    amountCovered: number;
    debtToInsuranceInc: number;
    lossUncoveredNotEnoughInsurance: number;
  }
  lossUncoveredCutByMax: number;

  sentToInsurance: number;
  unsentToInsurance: number;

  changeDebtToInsuranceOnProfit: {
    debtToInsuranceBefore: number;
    increaseToDebt: number;
  }

  payDebtToInsurance: {
    debtToInsuranceBefore: number;
    debtToInsuranceAfter: number;
    debtPaid: number,
  };

  toPerfRecycle: number;
  toInsuranceRecycle: number;
  toForwarderRecycle: number[];
  lossRebalance: number;

  fixPriceChanges: {
    investedAssetsBefore: number;
    investedAssetsAfter: number;
    debtToInsuranceBefore: number;
    debtToInsuranceAfter: number;
    increaseToDebt: number;
  }
  swapByAgg?: ISwapByAgg;

  borrowResults: {
    gains: number;
    losses: number;
  }

  onHardWorkEarnedLost: IOnHardWorkEarnedLost;
  hardwork: IHardWorkEvent;

  onEarningOnWithdraw: {
    earned: number;
    earnedByPrice: number;
    delta: number;
  };
}

/**
 * Parse events generated by rebalanceNoSwap()
 *
 * @param receipt
 * @param decimals
 * @param platform One of PLATFORM_XXX, i.e. PLATFORM_UNIV3
 */
export class CaptureEvents {
  /**
   * Make rebalanceNoSwap and extract IRebalanceEvents
   * @param strategy
   */
  static async makeRebalanceNoSwap(strategy: IRebalancingV2Strategy): Promise<IEventsSet> {
    const platform = await ConverterStrategyBase__factory.connect(strategy.address, strategy.signer).PLATFORM();
    const decimals = await IERC20Metadata__factory.connect(
      await ConverterStrategyBase__factory.connect(strategy.address, strategy.signer).asset(),
      strategy.signer
    ).decimals();
    const tx = await strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('REBALANCE gas', cr.gasUsed.toNumber());

    return this.handleReceipt(strategy.signer, cr, decimals, platform);
  }

  static async makeHardwork(strategy: ConverterStrategyBase): Promise<IEventsSet> {
    const platform = await strategy.PLATFORM();
    const decimals = await IERC20Metadata__factory.connect(await strategy.asset(), strategy.signer).decimals();
    const tx = await strategy.doHardWork({gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('HARDWORK gas', cr.gasUsed.toNumber());

    return this.handleReceipt(strategy.signer, cr, decimals, platform);
  }

  static async makeHardworkInSplitter(strategy: ConverterStrategyBase, operator: SignerWithAddress): Promise<IEventsSet> {
    const platform = await strategy.PLATFORM();
    const splitter = await StrategySplitterV2__factory.connect(await strategy.splitter(), operator);
    const decimals = await IERC20Metadata__factory.connect(await strategy.asset(), strategy.signer).decimals();
    const tx = await splitter.doHardWork({gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('HARDWORK gas', cr.gasUsed.toNumber());

    return this.handleReceipt(strategy.signer, cr, decimals, platform);
  }

  static async makeDeposit(vault: TetuVaultV2, amount: BigNumber, platform?: string): Promise<IEventsSet> {
    const asset = await StrategySplitterV2__factory.connect(await vault.splitter(), vault.signer).asset();
    const user = await vault.signer.getAddress();
    const decimals = await IERC20Metadata__factory.connect(asset, vault.signer).decimals();
    const tx = await vault.deposit(amount, user, {gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('DEPOSIT gas', cr.gasUsed.toNumber());

    return this.handleReceipt(vault.signer, cr, decimals, platform);
  }

  static async makeWithdraw(vault: TetuVaultV2, amount: BigNumber, platform?: string): Promise<IEventsSet> {
    const asset = await StrategySplitterV2__factory.connect(await vault.splitter(), vault.signer).asset();
    const user = await vault.signer.getAddress();
    const decimals = await IERC20Metadata__factory.connect(asset, vault.signer).decimals();
    const tx = await vault.withdraw(amount, user, user,{gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('WITHDRAW gas', cr.gasUsed.toNumber());

    return this.handleReceipt(vault.signer, cr, decimals, platform);
  }

  static async makeWithdrawAll(vault: TetuVaultV2, platform?: string): Promise<IEventsSet> {
    const asset = await StrategySplitterV2__factory.connect(await vault.splitter(), vault.signer).asset();
    const user = await vault.signer.getAddress();
    const decimals = await IERC20Metadata__factory.connect(asset, vault.signer).decimals();
    const tx = await vault.withdrawAll({gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('WITHDRAW-ALL gas', cr.gasUsed.toNumber());

    return this.handleReceipt(vault.signer, cr, decimals, platform);
  }

  static async makeWithdrawByAggStep(
    strategy: IRebalancingV2Strategy,
    tokenToSwap: string,
    aggregator: string,
    amountToSwap: BigNumberish,
    swapData: BytesLike,
    planEntryData: BytesLike,
    entryToPool: BigNumberish
  ): Promise<IEventsSet> {
    const converterStrategyBase = await ConverterStrategyBase__factory.connect(strategy.address, strategy.signer);
    const asset = await converterStrategyBase.asset();
    const decimals = await IERC20Metadata__factory.connect(asset, strategy.signer).decimals();
    const tx = await strategy.withdrawByAggStep(tokenToSwap, aggregator, amountToSwap, swapData, planEntryData, entryToPool, {gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('WITHDRAW-BY-AGG-STEP gas', cr.gasUsed.toNumber());

    return this.handleReceipt(converterStrategyBase.signer, cr, decimals, await converterStrategyBase.PLATFORM());
  }
  /**
   * Try to parse all events related to rebalance/hardwork/deposit/withdrawXXX operations
   */
  static async handleReceipt(
    signer: Signer,
    receipt: ContractReceipt,
    decimals: number,
    platform: string = PLATFORM_UNIV3
  ): Promise<IEventsSet> {
    console.log('*** CAPTURE EVENTS LOGS ***');
    const splitterLibI = StrategySplitterV2__factory.createInterface();
    const tetuVaultV2LibI = TetuVaultV2__factory.createInterface();
    const pairLibI = PairBasedStrategyLib__factory.createInterface();
    const converterStrategyBaseLib2I = ConverterStrategyBaseLib2__factory.createInterface();
    const converterStrategyBaseLibI = ConverterStrategyBaseLib__factory.createInterface();
    const converterStrategyBase = ConverterStrategyBase__factory.createInterface();
    const logicLibI = platform === PLATFORM_UNIV3
      ? UniswapV3ConverterStrategyLogicLib__factory.createInterface()
      : platform === PLATFORM_ALGEBRA
        ? AlgebraConverterStrategyLogicLib__factory.createInterface()
        : KyberConverterStrategyLogicLib__factory.createInterface();

    const ret: IEventsSet = {};


    if (receipt?.events || receipt.logs) {
      for (const event of (receipt.events ?? receipt.logs ?? [])) {
        if (event.topics[0].toLowerCase() === pairLibI.getEventTopic('FuseStatusChanged').toLowerCase()) {
          console.log('>>> !!!!!!!!!!!!!!!!!!!!!!!!! FuseTriggered !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
          const log = (pairLibI.decodeEventLog(
            pairLibI.getEvent('FuseStatusChanged'),
            event.data,
            event.topics,
          ) as unknown) as FuseStatusChangedEventObject;
          ret.fuseStatusChanged = {
            fuseStatus: log.fuseStatus.toNumber()
          }
        }

        if (event.topics[0].toLowerCase() === pairLibI.getEventTopic('SwapByAgg').toLowerCase()) {
          const log = (pairLibI.decodeEventLog(
            pairLibI.getEvent('SwapByAgg'),
            event.data,
            event.topics,
          ) as unknown) as SwapByAggEventObject;
          ret.swapByAgg = {
            amountIn: +formatUnits(log.amountIn, decimals), // todo take correct decimals from the event
            amountToSwap: +formatUnits(log.amountToSwap, decimals), // todo take correct decimals from the event
            amountOut: +formatUnits(log.amountOut, decimals), // todo take correct decimals from the event
            amountOutExpected: +formatUnits(log.expectedAmountOut, decimals), // todo take correct decimals from the event
            aggregator: log.aggregator
          }
        }

        if (event.topics[0].toLowerCase() === logicLibI.getEventTopic('Rebalanced').toLowerCase()) {
          console.log('/// Strategy rebalanced');
          const log = (logicLibI.decodeEventLog(
            logicLibI.getEvent('Rebalanced'),
            event.data,
            event.topics,
          ) as unknown) as RebalancedEventObject;

          if (ret.rebalanced?.loss) throw Error("second event 8");
          ret.rebalanced = {
            loss: +formatUnits(log.loss, decimals),
            coveredByRewards: +formatUnits(log.coveredByRewards, decimals),
            profitToCover: +formatUnits(log.profitToCover, decimals),
          }
        }

        if (event.topics[0].toLowerCase() === logicLibI.getEventTopic('RebalancedDebt').toLowerCase()) {
          console.log('/// Strategy rebalanced debt');
          const log = (logicLibI.decodeEventLog(
            logicLibI.getEvent('RebalancedDebt'),
            event.data,
            event.topics,
          ) as unknown) as RebalancedDebtEventObject;

          if (ret.rebalancedDebt?.loss) throw Error("second event 7");
          ret.rebalancedDebt = {
            loss: +formatUnits(log.loss, decimals),
            coveredByRewards: +formatUnits(log.coveredByRewards, decimals),
            profitToCover: +formatUnits(log.profitToCover, decimals),
          }
        }

        if (event.topics[0].toLowerCase() === converterStrategyBase.getEventTopic('OnHardWorkEarnedLost').toLowerCase()) {
          const log = (converterStrategyBase.decodeEventLog(
            converterStrategyBase.getEvent('OnHardWorkEarnedLost'),
            event.data,
            event.topics,
          ) as unknown) as OnHardWorkEarnedLostEventObject;

          if (ret.onHardWorkEarnedLost?.investedAssetsNewPrices) throw Error("second event 6");
          ret.onHardWorkEarnedLost = {
            investedAssetsNewPrices: +formatUnits(log.investedAssetsNewPrices, decimals),
            earnedByPrices:  +formatUnits(log.earnedByPrices, decimals),
            earnedHandleRewards: +formatUnits(log.earnedHandleRewards, decimals),
            lostHandleRewards: +formatUnits(log.lostHandleRewards, decimals),
            earnedDeposit: +formatUnits(log.earnedDeposit, decimals),
            lostDeposit: +formatUnits(log.lostDeposit, decimals),
            paidDebtToInsurance: +formatUnits(log.paidDebtToInsurance, decimals),
          }
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('OnEarningOnWithdraw').toLowerCase()) {
          const log = (converterStrategyBaseLib2I.decodeEventLog(
            converterStrategyBaseLib2I.getEvent('OnEarningOnWithdraw'),
            event.data,
            event.topics,
          ) as unknown) as OnEarningOnWithdrawEventObject;

          if (!ret.earningOnWithdraw) {
            ret.earningOnWithdraw = [];
          }
          ret.earningOnWithdraw.push({
            earned: +formatUnits(log.earned, decimals),
            earnedByPrice: +formatUnits(log.earnedByPrice, decimals),
          });
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('OnCoverLoss').toLowerCase()) {
          const log = (logicLibI.decodeEventLog(
            converterStrategyBaseLib2I.getEvent('OnCoverLoss'),
            event.data,
            event.topics,
          ) as unknown) as OnCoverLossEventObject;
          if (!ret.coverLoss) {
            ret.coverLoss = [];
          }
          ret.coverLoss.push({
            lossToCover: +formatUnits(log.lossToCover, decimals),
            lossUncovered: +formatUnits(log.lossUncovered, decimals),
            amountCovered: +formatUnits(log.amountCovered, decimals),
            debtToInsuranceInc: +formatUnits(log.debtToInsuranceInc, decimals),
          });
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('UncoveredLoss').toLowerCase()) {
          console.log('>>> UncoveredLoss');
          const log = (converterStrategyBaseLib2I.decodeEventLog(
            converterStrategyBaseLib2I.getEvent('UncoveredLoss'),
            event.data,
            event.topics,
          ) as unknown) as UncoveredLossEventObject;
          if (!ret.uncoveredLossEvent) {
            ret.uncoveredLossEvent = [];
          }
          ret.uncoveredLossEvent.push({
            investedAssetsAfter: +formatUnits(log.investedAssetsAfter, decimals),
            investedAssetsBefore: +formatUnits(log.investedAssetsBefore, decimals),
            lossCovered: +formatUnits(log.lossCovered, decimals),
            lossUncovered: +formatUnits(log.lossUncovered, decimals),
          });
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('ChangeDebtToInsuranceOnProfit').toLowerCase()) {
          const log = (converterStrategyBaseLib2I.decodeEventLog(
            converterStrategyBaseLib2I.getEvent('ChangeDebtToInsuranceOnProfit'),
            event.data,
            event.topics,
          ) as unknown) as ChangeDebtToInsuranceOnProfitEventObject;
          if (!ret.changeDebtToInsuranceOnProfit) {
            ret.changeDebtToInsuranceOnProfit = [];
          }
          ret.changeDebtToInsuranceOnProfit.push({
            debtToInsuranceBefore: +formatUnits(log.debtToInsuranceBefore, decimals),
            increaseToDebt: +formatUnits(log.increaseToDebt, decimals),
          });
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('SendToInsurance').toLowerCase()) {
          const log = (converterStrategyBaseLib2I.decodeEventLog(
            converterStrategyBaseLib2I.getEvent('SendToInsurance'),
            event.data,
            event.topics,
          ) as unknown) as SendToInsuranceEventObject;
          if (!ret.sendToInsurance) {
            ret.sendToInsurance = [];
          }
          ret.sendToInsurance.push({
            sentAmount: +formatUnits(log.sentAmount, decimals),
            unsentAmount: +formatUnits(log.unsentAmount, decimals),
          });
        }

        if (event.topics[0].toLowerCase() === splitterLibI.getEventTopic('Loss').toLowerCase()) {
          const log = (splitterLibI.decodeEventLog(
            splitterLibI.getEvent('Loss'),
            event.data,
            event.topics,
          ) as unknown) as LossEventObject;
          if (!ret.lossEvent) {
            ret.lossEvent = [];
          }
          ret.lossEvent.push({
            amount: +formatUnits(log.amount, decimals),
            strategy: log.strategy,
          });
        }

        if (event.topics[0].toLowerCase() === splitterLibI.getEventTopic('HardWork').toLowerCase()) {
          const log = (splitterLibI.decodeEventLog(
            splitterLibI.getEvent('HardWork'),
            event.data,
            event.topics,
          ) as unknown) as HardWorkEventObject;
          if (ret.hardwork?.strategy) throw Error("second event 4");
          ret.hardwork = {
            strategy: log.strategy,
            earned: +formatUnits(log.earned, decimals),
            lost: +formatUnits(log.lost, decimals),
            apr: +formatUnits(log.apr, 5),
            avgApr: +formatUnits(log.avgApr, 5),
            sender: log.sender,
            tvl: +formatUnits(log.tvl, decimals),
          };
        }

        if (event.topics[0].toLowerCase() === tetuVaultV2LibI.getEventTopic('LossCovered').toLowerCase()) {
          const log = (tetuVaultV2LibI.decodeEventLog(
            tetuVaultV2LibI.getEvent('LossCovered'),
            event.data,
            event.topics,
          ) as unknown) as LossCoveredEventObject;
          if (!ret.lossCoveredEvent) {
            ret.lossCoveredEvent = [];
          }
          ret.lossCoveredEvent.push({
            amount: +formatUnits(log.amount, decimals),
          });
        }

        if (event.topics[0].toLowerCase() === tetuVaultV2LibI.getEventTopic('FeeTransfer').toLowerCase()) {
          const log = (tetuVaultV2LibI.decodeEventLog(
            tetuVaultV2LibI.getEvent('FeeTransfer'),
            event.data,
            event.topics,
          ) as unknown) as FeeTransferEventObject;
          if (!ret.feeTransferEvent) {
            ret.feeTransferEvent = [];
          }
          ret.feeTransferEvent.push({
            amount: +formatUnits(log.amount, decimals),
          });
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('FixPriceChanges').toLowerCase()) {
          const log = (converterStrategyBaseLib2I.decodeEventLog(
            converterStrategyBaseLib2I.getEvent('FixPriceChanges'),
            event.data,
            event.topics,
          ) as unknown) as FixPriceChangesEventObject;
          if (!ret.fixPriceChanges) {
            ret.fixPriceChanges = [];
          }
          ret.fixPriceChanges.push({
            investedAssetsOut: +formatUnits(log.investedAssetsOut, decimals),
            investedAssetsBefore: +formatUnits(log.investedAssetsBefore, decimals),
            debtToInsuranceBefore: +formatUnits(log.debtToInsuranceBefore, decimals),
            debtToInsuranceAfter: +formatUnits(log.debtToInsuranceAfter, decimals),
            increaseToDebt: +formatUnits(log.increaseToDebt, decimals),
          });
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('OnIncreaseDebtToInsurance').toLowerCase()) {
          const log = (converterStrategyBaseLib2I.decodeEventLog(
            converterStrategyBaseLib2I.getEvent('OnIncreaseDebtToInsurance'),
            event.data,
            event.topics,
          ) as unknown) as OnIncreaseDebtToInsuranceEventObject;
          const tokenDecimals = await Promise.all(log.tokens.map(
            async x => IERC20Metadata__factory.connect(x, signer).decimals()
          ))
          if (!ret.increaseDebtToInsurance) {
            ret.increaseDebtToInsurance = [];
          }
          ret.increaseDebtToInsurance.push({
            tokens: log.tokens,
            deltaGains: log.deltaGains.map((x, index) => +formatUnits(x, tokenDecimals[index])),
            deltaLosses: log.deltaLosses.map((x, index) => +formatUnits(x, tokenDecimals[index])),
            prices: log.prices.map(x => +formatUnits(x, 18)),
            increaseToDebt: +formatUnits(log.increaseToDebt, decimals)
          });
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('BorrowResults').toLowerCase()) {
          const log = (converterStrategyBaseLib2I.decodeEventLog(
            converterStrategyBaseLib2I.getEvent('BorrowResults'),
            event.data,
            event.topics,
          ) as unknown) as BorrowResultsEventObject;
          if (!ret.borrowResults) {
            ret.borrowResults = [];
          }
          ret.borrowResults.push({
            gains: +formatUnits(log.gains, decimals),
            losses: +formatUnits(log.losses, decimals),
          });
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLibI.getEventTopic('Recycle').toLowerCase()) {
          const log = (converterStrategyBaseLibI.decodeEventLog(
            converterStrategyBaseLibI.getEvent('Recycle'),
            event.data,
            event.topics,
          ) as unknown) as RecycleEventObject;
          if (ret.recycle?.rewardTokens.length) throw Error("second event 9");
          ret.recycle = {
            rewardTokens: log.rewardTokens,
            amountsToForward: log.amountsToForward,
            toInsurance: +formatUnits(log.toInsurance, decimals),
            toPerf: +formatUnits(log.toPerf, decimals),
          };
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLibI.getEventTopic('OnPayDebtToInsurance').toLowerCase()) {
          const log = (converterStrategyBaseLibI.decodeEventLog(
            converterStrategyBaseLibI.getEvent('OnPayDebtToInsurance'),
            event.data,
            event.topics,
          ) as unknown) as OnPayDebtToInsuranceEventObject;
          if (!ret.payDebtToInsurance) {
            ret.payDebtToInsurance = [];
          }
          ret.payDebtToInsurance.push({
            debtToInsuranceBefore: +formatUnits(log.debtToInsuranceBefore, decimals),
            debtToInsuranceAfter: +formatUnits(log.debtToInsuraneAfter, decimals),
          });
        }

        if (event.topics[0].toLowerCase() === converterStrategyBaseLibI.getEventTopic('OnCoverDebtToInsurance').toLowerCase()) {
          const log = (converterStrategyBaseLibI.decodeEventLog(
            converterStrategyBaseLibI.getEvent('OnCoverDebtToInsurance'),
            event.data,
            event.topics,
          ) as unknown) as OnCoverDebtToInsuranceEventObject;
          if (!ret.coverDebtToInsurance) {
            ret.coverDebtToInsurance = [];
          }
          ret.coverDebtToInsurance.push({
            rewardToken: log.rewardToken,
            rewardAmount: +formatUnits(log.rewardAmount, await IERC20Metadata__factory.connect(log.rewardToken, signer).decimals()),
            debtToCover: +formatUnits(log.debtToCover, decimals),
            debtLeftovers: +formatUnits(log.debtLeftovers, decimals)
          });
        }
      }
    }
    console.log('*************');
    return ret;
  }

  static async getSummaryFromEventsSet(signer: SignerWithAddress, eventsSet?: IEventsSet) : Promise<ISummaryFromEventsSet> {
    return {
      lossSplitter: eventsSet?.lossEvent
        ? eventsSet.lossEvent.reduce((prev, cur) => prev + cur.amount, 0)
        : 0,
      lossCoveredVault: eventsSet?.lossCoveredEvent
        ? eventsSet.lossCoveredEvent.reduce((prev, cur) => prev + cur.amount, 0)
        : 0,
      feeTransferVault: eventsSet?.feeTransferEvent
        ? eventsSet.feeTransferEvent.reduce((prev, cur) => prev + cur.amount, 0)
        : 0,
      lossUncoveredCutByMax: eventsSet?.uncoveredLossEvent
        ? eventsSet.uncoveredLossEvent.reduce((prev, cur) => prev + cur.lossUncovered, 0)
        : 0,

      sentToInsurance: eventsSet?.sendToInsurance
        ? eventsSet.sendToInsurance.reduce((prev, cur) => prev + cur.sentAmount, 0)
        : 0,
      unsentToInsurance: eventsSet?.sendToInsurance
        ? eventsSet.sendToInsurance.reduce((prev, cur) => prev + cur.unsentAmount, 0)
        : 0,

      onCoverLoss: {
        debtToInsuranceInc: eventsSet?.coverLoss
          ? eventsSet.coverLoss.reduce((prev, cur) => prev + cur.debtToInsuranceInc, 0)
          : 0,
        lossToCover: eventsSet?.coverLoss
            ? eventsSet.coverLoss.reduce((prev, cur) => prev + cur.lossToCover, 0)
            : 0,
        lossUncoveredNotEnoughInsurance: eventsSet?.coverLoss
            ? eventsSet.coverLoss.reduce((prev, cur) => prev + cur.lossUncovered, 0)
            : 0,
        amountCovered: eventsSet?.coverLoss
            ? eventsSet.coverLoss.reduce((prev, cur) => prev + cur.amountCovered, 0)
            : 0,
      },

      payDebtToInsurance: {
        debtToInsuranceBefore: eventsSet?.payDebtToInsurance?.length
          ? eventsSet?.payDebtToInsurance[0].debtToInsuranceBefore
          : 0,
        debtToInsuranceAfter: eventsSet?.payDebtToInsurance?.length
          ? eventsSet?.payDebtToInsurance[0].debtToInsuranceAfter
          :0,
        debtPaid: eventsSet?.payDebtToInsurance?.length
          ? eventsSet.payDebtToInsurance.reduce((prev, cur) => prev + cur.debtToInsuranceBefore - cur.debtToInsuranceAfter, 0)
          : 0
      },

      toPerfRecycle: eventsSet?.recycle?.toPerf ?? 0,
      toInsuranceRecycle: eventsSet?.recycle?.toInsurance ?? 0,
      lossRebalance: eventsSet?.rebalanced?.loss ?? 0,

      fixPriceChanges: {
        investedAssetsBefore: eventsSet?.fixPriceChanges?.length
          ? eventsSet?.fixPriceChanges[0].investedAssetsBefore
          : 0,
        investedAssetsAfter: eventsSet?.fixPriceChanges?.length
          ? eventsSet?.fixPriceChanges[0].investedAssetsOut
          : 0,
        debtToInsuranceBefore: eventsSet?.fixPriceChanges?.length
          ? eventsSet?.fixPriceChanges[0].debtToInsuranceBefore
          : 0,
        debtToInsuranceAfter: eventsSet?.fixPriceChanges?.length
          ? eventsSet?.fixPriceChanges[0].debtToInsuranceAfter
          : 0,
        increaseToDebt: eventsSet?.fixPriceChanges?.length
          ? eventsSet.fixPriceChanges.reduce((prev, cur) => prev + cur.increaseToDebt, 0)
          : 0,
      },

      toForwarderRecycle: eventsSet?.recycle?.rewardTokens && eventsSet?.recycle?.rewardTokens.length
        ? await Promise.all(eventsSet?.recycle?.rewardTokens.map(
          async (token, index) => +formatUnits(
            eventsSet?.recycle?.amountsToForward && eventsSet?.recycle?.amountsToForward.length > index
              ? eventsSet?.recycle?.amountsToForward[index]
              : BigNumber.from(0),
            await IERC20Metadata__factory.connect(token, signer).decimals()
          )
        ))
        : [],

      swapByAgg: eventsSet?.swapByAgg,

      borrowResults: {
        gains: eventsSet?.borrowResults?.length
          ? eventsSet.borrowResults.reduce((prev, cur) => prev + cur.gains, 0)
          : 0,

        losses: eventsSet?.borrowResults?.length
          ? eventsSet.borrowResults.reduce((prev, cur) => prev + cur.losses, 0)
          : 0,
      },

      changeDebtToInsuranceOnProfit: {
        debtToInsuranceBefore: eventsSet?.changeDebtToInsuranceOnProfit?.length
          ? eventsSet?.changeDebtToInsuranceOnProfit[0].debtToInsuranceBefore
          : 0,
        increaseToDebt: eventsSet?.changeDebtToInsuranceOnProfit?.length
          ? eventsSet.changeDebtToInsuranceOnProfit.reduce((prev, cur) => prev + cur.increaseToDebt, 0)
          : 0,
      },

      onHardWorkEarnedLost: eventsSet?.onHardWorkEarnedLost ?? {
        earnedByPrices: 0,
        earnedDeposit: 0,
        lostDeposit: 0,
        earnedHandleRewards: 0,
        lostHandleRewards: 0,
        investedAssetsNewPrices: 0,
        paidDebtToInsurance: 0
      },
      hardwork: eventsSet?.hardwork ?? {
        tvl: 0,
        avgApr: 0,
        lost: 0,
        earned: 0,
        sender: "",
        apr: 0,
        strategy: ""
      },

      onEarningOnWithdraw: eventsSet?.earningOnWithdraw
        ? {
          earned: eventsSet.earningOnWithdraw.reduce((prev, cur) => prev + cur.earned, 0),
          earnedByPrice: eventsSet.earningOnWithdraw.reduce((prev, cur) => prev + cur.earnedByPrice, 0),
          delta: eventsSet.earningOnWithdraw.reduce((prev, cur) => prev + cur.earned - cur.earnedByPrice, 0),
        }
        : {
          earned: 0,
          earnedByPrice: 0,
          delta: 0
        }
    }
  }
}