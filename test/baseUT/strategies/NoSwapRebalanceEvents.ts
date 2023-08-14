import {BigNumber, Event, ContractReceipt} from "ethers";
import {
  AlgebraConverterStrategy__factory,
  AlgebraConverterStrategyLogicLib__factory,
  ConverterStrategyBase__factory,
  ConverterStrategyBaseLib2__factory, IERC20Metadata__factory,
  IRebalancingV2Strategy,
  KyberConverterStrategy__factory,
  KyberConverterStrategyLogicLib__factory,
  PairBasedStrategyLib__factory,
  UniswapV3ConverterStrategyLogicLib__factory
} from "../../../typechain";
import {FuseStatusChangedEventObject} from "../../../typechain/contracts/strategies/pair/PairBasedStrategyLib";
import {
  RebalancedEventObject
} from "../../../typechain/contracts/strategies/uniswap/UniswapV3ConverterStrategyLogicLib";
import {PLATFORM_ALGEBRA, PLATFORM_UNIV3} from "./AppPlatforms";
import {UncoveredLossEventObject} from "../../../typechain/contracts/strategies/ConverterStrategyBaseLib2";

interface IRebalancedEventValues {
  loss: BigNumber;
  covered: BigNumber;
  uncoveredLoss: BigNumber;
}

export interface IRebalanceEvents extends IRebalancedEventValues{
  fuseStatus?: number;
}

/**
 * Parse events generated by rebalanceNoSwap()
 *
 * @param receipt
 * @param decimals
 * @param platform One of PLATFORM_XXX, i.e. PLATFORM_UNIV3
 */
export class NoSwapRebalanceEvents {
  /**
   * Make rebalanceNoSwap and extract IRebalanceEvents
   * @param strategy
   */
  static async makeRebalanceNoSwap(strategy: IRebalancingV2Strategy): Promise<IRebalanceEvents> {
    const platform = await ConverterStrategyBase__factory.connect(strategy.address, strategy.signer).PLATFORM();
    const decimals = await IERC20Metadata__factory.connect(
      await ConverterStrategyBase__factory.connect(strategy.address, strategy.signer).asset(),
      strategy.signer
    ).decimals();
    const tx = await strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
    const cr = await tx.wait();

    return this.handleReceiptRebalance(cr, decimals, platform);
  }
  static async handleReceiptRebalance(
    receipt: ContractReceipt,
    decimals: number,
    platform: string
  ): Promise<IRebalanceEvents> {
    console.log('*** REBALANCE LOGS ***');
    const pairLibI = PairBasedStrategyLib__factory.createInterface();
    const converterStrategyBaseLib2I = ConverterStrategyBaseLib2__factory.createInterface();
    const logicLibI = platform === PLATFORM_UNIV3
      ? UniswapV3ConverterStrategyLogicLib__factory.createInterface()
      : platform === PLATFORM_ALGEBRA
        ? AlgebraConverterStrategyLogicLib__factory.createInterface()
        : KyberConverterStrategyLogicLib__factory.createInterface();

    let uncoveredLoss: BigNumber | undefined;
    let fuseStatus: number | undefined;
    let loss: BigNumber | undefined;
    let covered: BigNumber | undefined;

    for (const event of (receipt.events ?? [])) {
      const e: Event = event;

      if (event.topics[0].toLowerCase() === pairLibI.getEventTopic('FuseStatusChanged').toLowerCase()) {
        console.log('>>> !!!!!!!!!!!!!!!!!!!!!!!!! FuseTriggered !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        const log = (pairLibI.decodeEventLog(
          pairLibI.getEvent('FuseStatusChanged'),
          event.data,
          event.topics,
        ) as unknown) as FuseStatusChangedEventObject;
        fuseStatus = log.fuseStatus.toNumber();
      }

      if (event.topics[0].toLowerCase() === logicLibI.getEventTopic('Rebalanced').toLowerCase()) {
        console.log('/// Strategy rebalanced');
        const log = (logicLibI.decodeEventLog(
          logicLibI.getEvent('Rebalanced'),
          event.data,
          event.topics,
        ) as unknown) as RebalancedEventObject;
        loss = log.loss;
        covered = log.coveredByRewards;
      }

      if (event.topics[0].toLowerCase() === converterStrategyBaseLib2I.getEventTopic('UncoveredLoss').toLowerCase()) {
        console.log('>>> UncoveredLoss');
        const log = (converterStrategyBaseLib2I.decodeEventLog(
          converterStrategyBaseLib2I.getEvent('UncoveredLoss'),
          event.data,
          event.topics,
        ) as unknown) as UncoveredLossEventObject;
        uncoveredLoss = log.lossUncovered;
      }
    }
    console.log('*************');
    return {
      fuseStatus,
      loss: loss || BigNumber.from(0),
      covered: covered || BigNumber.from(0),
      uncoveredLoss: uncoveredLoss || BigNumber.from(0),
    }
  }
}