import {DoHardWorkLoopBase} from "../../../../baseUT/utils/DoHardWorkLoopBase";
import {BalancerStrategyUtils} from "../../../../BalancerStrategyUtils";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {BalancerBoostedStrategy} from "../../../../../typechain";

export class BalancerRewardsHardwork extends DoHardWorkLoopBase {
  protected async loopStartActions(i: number) {
    await super.loopStartActions(i);
    const strategy = this.strategy as unknown as BalancerBoostedStrategy
    await BalancerStrategyUtils.refuelRewards(
      (await strategy.poolId()).substring(0, 42),
      MaticAddresses.BALANCER_LIQUIDITY_GAUGE_FACTORY,
      MaticAddresses.BAL_TOKEN,
      parseUnits('100'),
      this.signer
    )
  }
}