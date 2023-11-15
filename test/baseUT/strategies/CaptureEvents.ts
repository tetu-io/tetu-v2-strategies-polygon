import {BigNumber, Event, ContractReceipt, BigNumberish, BytesLike} from "ethers";
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
  FixPriceChangesEventObject,
  NotEnoughInsuranceEventObject, OnCoverLossEventObject, SendToInsuranceEventObject,
  UncoveredLossEventObject,
} from "../../../typechain/contracts/strategies/ConverterStrategyBaseLib2";
import {formatUnits} from "ethers/lib/utils";
import {LossEventObject} from "../../../typechain/@tetu_io/tetu-contracts-v2/contracts/vault/StrategySplitterV2";
import {LossCoveredEventObject} from "../../../typechain/@tetu_io/tetu-contracts-v2/contracts/vault/TetuVaultV2";
import {RecycleEventObject} from "../../../typechain/contracts/strategies/ConverterStrategyBaseLib";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

/**
 * TetuVaultV2
 */
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

/**
 * ConverterStrategyBaseLib2.coverLossAfterPriceChanging
 */
interface IFixPriceChanges {
  investedAssetsBefore: number;
  investedAssetsOut: number;
}

/**
 * ConverterStrategyBaseLib2._coverLossAndCheckResults
 */
interface INotEnoughInsurance {
  lossUncovered: number;
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

interface ICoverLoss {
  loss: number;
  amountCovered: number;
  debtToInsuranceInc: number;
}

export interface IEventsSet {
  lossEvent?: ILossEvent[];
  lossCoveredEvent?: ILossCoveredEvent[];
  uncoveredLossEvent?: IUncoveredLossEvent[];
  notEnoughInsurance?: INotEnoughInsurance[];
  sendToInsurance?: ISendToInsurance[];
  coverLoss?: ICoverLoss[];

  rebalanced?: IRebalancedEvent;
  rebalancedDebt?: IRebalancedDebtEvent;
  fixPriceChanges?: IFixPriceChanges;
  fuseStatusChanged?: IFuseStatusChanged;
  recycle?: IRecycle;
  swapByAgg?: ISwapByAgg;
}

export interface ISummaryFromEventsSet {
  lossSplitter: number;
  lossCoveredVault: number;
  lossUncoveredCutByMax: number;

  sentToInsurance: number;
  unsentToInsurance: number;

  debtToInsuranceInc: number;
  lossUncoveredNotEnoughInsurance: number;

  toPerfRecycle: number;
  toInsuranceRecycle: number;
  toForwarderRecycle: number[];
  lossRebalance: number;
  investedAssetsBeforeFixPriceChanges: number;
  investedAssetsAfterFixPriceChanges: number;
  swapByAgg?: ISwapByAgg;
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

    return this.handleReceipt(cr, decimals, platform);
  }

  static async makeHardwork(strategy: ConverterStrategyBase): Promise<IEventsSet> {
    const platform = await strategy.PLATFORM();
    const decimals = await IERC20Metadata__factory.connect(await strategy.asset(), strategy.signer).decimals();
    const tx = await strategy.doHardWork({gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('HARDWORK gas', cr.gasUsed.toNumber());

    return this.handleReceipt(cr, decimals, platform);
  }

  static async makeDeposit(vault: TetuVaultV2, amount: BigNumber, platform?: string): Promise<IEventsSet> {
    const asset = await StrategySplitterV2__factory.connect(await vault.splitter(), vault.signer).asset();
    const user = await vault.signer.getAddress();
    const decimals = await IERC20Metadata__factory.connect(asset, vault.signer).decimals();
    const tx = await vault.deposit(amount, user, {gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('DEPOSIT gas', cr.gasUsed.toNumber());

    return this.handleReceipt(cr, decimals, platform);
  }

  static async makeWithdraw(vault: TetuVaultV2, amount: BigNumber, platform?: string): Promise<IEventsSet> {
    const asset = await StrategySplitterV2__factory.connect(await vault.splitter(), vault.signer).asset();
    const user = await vault.signer.getAddress();
    const decimals = await IERC20Metadata__factory.connect(asset, vault.signer).decimals();
    const tx = await vault.withdraw(amount, user, user,{gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('WITHDRAW gas', cr.gasUsed.toNumber());

    return this.handleReceipt(cr, decimals, platform);
  }

  static async makeWithdrawAll(vault: TetuVaultV2, platform?: string): Promise<IEventsSet> {
    const asset = await StrategySplitterV2__factory.connect(await vault.splitter(), vault.signer).asset();
    const user = await vault.signer.getAddress();
    const decimals = await IERC20Metadata__factory.connect(asset, vault.signer).decimals();
    const tx = await vault.withdrawAll({gasLimit: 19_000_000});
    const cr = await tx.wait();
    console.log('WITHDRAW-ALL gas', cr.gasUsed.toNumber());

    return this.handleReceipt(cr, decimals, platform);
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

    return this.handleReceipt(cr, decimals, await converterStrategyBase.PLATFORM());
  }
  /**
   * Try to parse all events related to rebalance/hardwork/deposit/withdrawXXX operations
   */
  static async handleReceipt(
    receipt: ContractReceipt,
    decimals: number,
    platform: string = PLATFORM_UNIV3
  ): Promise<IEventsSet> {
    console.log('*** REBALANCE LOGS ***');
    const splitterLibI = StrategySplitterV2__factory.createInterface();
    const tetuVaultV2LibI = TetuVaultV2__factory.createInterface();
    const pairLibI = PairBasedStrategyLib__factory.createInterface();
    const converterStrategyBaseLib2I = ConverterStrategyBaseLib2__factory.createInterface();
    const converterStrategyBaseLibI = ConverterStrategyBaseLib__factory.createInterface();
    const logicLibI = platform === PLATFORM_UNIV3
      ? UniswapV3ConverterStrategyLogicLib__factory.createInterface()
      : platform === PLATFORM_ALGEBRA
        ? AlgebraConverterStrategyLogicLib__factory.createInterface()
        : KyberConverterStrategyLogicLib__factory.createInterface();

    const ret: IEventsSet = {};

    for (const event of (receipt.events ?? [])) {
      const e: Event = event;

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

        ret.rebalancedDebt = {
          loss: +formatUnits(log.loss, decimals),
          coveredByRewards: +formatUnits(log.coveredByRewards, decimals),
          profitToCover: +formatUnits(log.profitToCover, decimals),
        }
      }

      if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('CoverLoss').toLowerCase()) {
        const log = (logicLibI.decodeEventLog(
          converterStrategyBaseLib2I.getEvent('OnCoverLoss'),
          event.data,
          event.topics,
        ) as unknown) as OnCoverLossEventObject;
        if (! ret.coverLoss) {
          ret.coverLoss = [];
        }
        ret.coverLoss.push({
          loss: +formatUnits(log.lossToCover, decimals),
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
        if (! ret.uncoveredLossEvent) {
          ret.uncoveredLossEvent = [];
        }
        ret.uncoveredLossEvent.push({
          investedAssetsAfter: +formatUnits(log.investedAssetsAfter, decimals),
          investedAssetsBefore: +formatUnits(log.investedAssetsBefore, decimals),
          lossCovered: +formatUnits(log.lossCovered, decimals),
          lossUncovered: +formatUnits(log.lossUncovered, decimals),
        });
      }

      if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('NotEnoughInsurance').toLowerCase()) {
        const log = (converterStrategyBaseLib2I.decodeEventLog(
          converterStrategyBaseLib2I.getEvent('NotEnoughInsurance'),
          event.data,
          event.topics,
        ) as unknown) as NotEnoughInsuranceEventObject;
        if (!ret.notEnoughInsurance) {
          ret.notEnoughInsurance = [];
        }
        ret.notEnoughInsurance.push({
          lossUncovered: +formatUnits(log.lossUncovered, decimals),
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
        if (! ret.lossEvent) {
          ret.lossEvent = [];
        }
        ret.lossEvent.push({
          amount: +formatUnits(log.amount, decimals),
          strategy: log.strategy,
        });
      }

      if (event.topics[0].toLowerCase() === tetuVaultV2LibI.getEventTopic('LossCovered').toLowerCase()) {
        const log = (tetuVaultV2LibI.decodeEventLog(
          tetuVaultV2LibI.getEvent('LossCovered'),
          event.data,
          event.topics,
        ) as unknown) as LossCoveredEventObject;
        if (! ret.lossCoveredEvent) {
          ret.lossCoveredEvent = [];
        }
        ret.lossCoveredEvent.push({
          amount: +formatUnits(log.amount, decimals),
        });
      }

      if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('FixPriceChanges').toLowerCase()) {
        const log = (converterStrategyBaseLib2I.decodeEventLog(
          converterStrategyBaseLib2I.getEvent('FixPriceChanges'),
          event.data,
          event.topics,
        ) as unknown) as FixPriceChangesEventObject;
        ret.fixPriceChanges = {
          investedAssetsOut: +formatUnits(log.investedAssetsOut, decimals),
          investedAssetsBefore: +formatUnits(log.investedAssetsBefore, decimals),
        }
      }

      if (event.topics[0].toLowerCase() === converterStrategyBaseLibI.getEventTopic('Recycle').toLowerCase()) {
        const log = (converterStrategyBaseLibI.decodeEventLog(
          converterStrategyBaseLibI.getEvent('Recycle'),
          event.data,
          event.topics,
        ) as unknown) as RecycleEventObject;
        ret.recycle = {
          rewardTokens: log.rewardTokens,
          amountsToForward: log.amountsToForward,
          toInsurance: +formatUnits(log.toInsurance, decimals),
          toPerf: +formatUnits(log.toPerf, decimals),
        };
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
      lossUncoveredCutByMax: eventsSet?.uncoveredLossEvent
        ? eventsSet.uncoveredLossEvent.reduce((prev, cur) => prev + cur.lossUncovered, 0)
        : 0,

      sentToInsurance: eventsSet?.sendToInsurance
        ? eventsSet.sendToInsurance.reduce((prev, cur) => prev + cur.sentAmount, 0)
        : 0,
      unsentToInsurance: eventsSet?.sendToInsurance
        ? eventsSet.sendToInsurance.reduce((prev, cur) => prev + cur.unsentAmount, 0)
        : 0,

      debtToInsuranceInc: eventsSet?.coverLoss
        ? eventsSet.coverLoss.reduce((prev, cur) => prev + cur.debtToInsuranceInc, 0)
        : 0,
      lossUncoveredNotEnoughInsurance: eventsSet?.notEnoughInsurance
        ? eventsSet.notEnoughInsurance.reduce((prev, cur) => prev + cur.lossUncovered, 0)
        : 0,

      toPerfRecycle: eventsSet?.recycle?.toPerf ?? 0,
      toInsuranceRecycle: eventsSet?.recycle?.toInsurance ?? 0,

      lossRebalance: eventsSet?.rebalanced?.loss ?? 0,

      investedAssetsBeforeFixPriceChanges: eventsSet?.fixPriceChanges?.investedAssetsBefore ?? 0,
      investedAssetsAfterFixPriceChanges: eventsSet?.fixPriceChanges?.investedAssetsOut ?? 0,

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

      swapByAgg: eventsSet?.swapByAgg
    }
  }
}