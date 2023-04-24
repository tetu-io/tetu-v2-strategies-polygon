import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IChildChainLiquidityGaugeFactory__factory,
  IChildChainStreamer__factory
} from "../typechain";
import {TokenUtils} from "../scripts/utils/TokenUtils";
import {BigNumber} from "ethers";
import {TimeUtils} from "../scripts/utils/TimeUtils";
import {Misc} from "../scripts/utils/Misc";

export class BalancerStrategyUtils {
  public static async refuelRewards(
    pool: string,
    gaugeFactory: string,
    rewardToken: string,
    rewardAmount: BigNumber,
    signer: SignerWithAddress
  ) {
    const factory = IChildChainLiquidityGaugeFactory__factory.connect(gaugeFactory, signer)
    const streamer = IChildChainStreamer__factory.connect(await factory.getPoolStreamer(pool), signer)
    await TokenUtils.getToken(rewardToken, streamer.address, rewardAmount);
    const rewardData = await streamer.reward_data(rewardToken)
    await streamer.connect(await Misc.impersonate(rewardData.distributor)).notify_reward_amount(rewardToken)

    // need for new gauges
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 24 * 7)
  }
}