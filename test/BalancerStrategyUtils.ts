import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IBVault__factory,
  IChildChainLiquidityGaugeFactory__factory,
  IChildChainStreamer__factory,
  IComposableStablePool__factory,
  ILinearPool,
  ILinearPool__factory
} from "../typechain";
import {TokenUtils} from "../scripts/utils/TokenUtils";
import {BigNumber} from "ethers";
import {TimeUtils} from "../scripts/utils/TimeUtils";
import {Misc} from "../scripts/utils/Misc";
import {parseUnits} from "ethers/lib/utils";

export class BalancerStrategyUtils {
  public static async getOtherToken(
    poolId: string,
    token: string,
    vault: string,
    signer: SignerWithAddress
  ):Promise<string> {
    const balancerVault = IBVault__factory.connect(vault, signer)
    const poolTokens = await balancerVault.getPoolTokens(poolId)
    let otherToken: string|undefined
    for (const poolToken of poolTokens.tokens) {
      if (poolToken.toLowerCase() !== poolId.substring(0, 42).toLowerCase()) {
        const linearPool = ILinearPool__factory.connect(poolToken, signer)
        const mainToken = await linearPool.getMainToken()
        if (mainToken.toLowerCase() !== token.toLowerCase()) {
          otherToken = mainToken
          break
        }
      }
    }
    if (!otherToken) {
      throw new Error()
    }
    return otherToken
  }

  public static async bbSwap(
    pool: string,
    tokenIn: string,
    tokenOut: string,
    amount: BigNumber,
    vault: string,
    signer: SignerWithAddress
  ) {
    const balancerVault = IBVault__factory.connect(vault, signer)
    await TokenUtils.getToken(tokenIn, signer.address, amount)
    await TokenUtils.approve(tokenIn, signer, balancerVault.address, amount.toString())
    const balancerBoostedPool = IComposableStablePool__factory.connect(pool, signer)
    const poolTokens = await balancerVault.getPoolTokens(await balancerBoostedPool.getPoolId())
    const rootBptIndex = (await balancerBoostedPool.getBptIndex()).toNumber()
    let linearPoolIn: ILinearPool|undefined
    let linearPoolOut: ILinearPool|undefined
    for (let i = 0; i < poolTokens.tokens.length; i++) {
      if (i !== rootBptIndex) {
        const linearPool = ILinearPool__factory.connect(poolTokens.tokens[i], signer)
        const mainToken = await linearPool.getMainToken()
        if (mainToken.toLowerCase() === tokenIn.toLowerCase()) {
          linearPoolIn = linearPool
        }
        if (mainToken.toLowerCase() === tokenOut.toLowerCase()) {
          linearPoolOut = linearPool
        }
      }
    }
    if (!linearPoolIn || !linearPoolOut) {
      throw new Error()
    }

    await balancerVault.batchSwap(
      0, // GIVEN_IN
      [
        {
          poolId: await linearPoolIn.getPoolId(),
          assetInIndex: 0,
          assetOutIndex: 1,
          amount,
          userData: '0x'
        },
        {
          poolId: await balancerBoostedPool.getPoolId(),
          assetInIndex: 1,
          assetOutIndex: 2,
          amount: 0,
          userData: '0x'
        },
        {
          poolId: await linearPoolOut.getPoolId(),
          assetInIndex: 2,
          assetOutIndex: 3,
          amount: 0,
          userData: '0x'
        },
      ],
      [tokenIn, linearPoolIn.address, linearPoolOut.address, tokenOut],
      {
        sender: signer.address,
        fromInternalBalance: false,
        recipient: signer.address,
        toInternalBalance: false
      },
      [parseUnits('1000000000'), parseUnits('1000000000'), parseUnits('1000000000'), parseUnits('1000000000')],
      Date.now() + 1000
    )
  }

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