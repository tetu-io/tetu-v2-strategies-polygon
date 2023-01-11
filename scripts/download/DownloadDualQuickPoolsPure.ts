import {ethers} from "hardhat";
import {
  IStakingDualRewards__factory,
  IStakingRewards__factory,
  IStakingRewardsFactory__factory, IStakingRewardsFactoryV2__factory,
  IUniswapV2Pair__factory
} from "../../typechain";
import {MaticAddresses} from "../MaticAddresses";
import {TokenUtils} from "../utils/TokenUtils";
import {BigNumber} from "ethers";
import {mkdir, writeFileSync} from "fs";

/**
 * Download QuickSwap reward pools info to CSV file.
 * "Pure" means that there are no vaults or other tetu-related info in results.
 *
 * To run the script execute a following command:
 *      npx hardhat run scripts/download/DownloadDualQuickPoolsPure.ts
 *      npx hardhat run --network localhost scripts/download/DownloadDualQuickPoolsPure.ts
 */
async function downloadDualQuickswapPure() {
  const signer = (await ethers.getSigners())[0];
  const factory = IStakingRewardsFactoryV2__factory.connect(MaticAddresses.QUICK_STAKING_FACTORY_V3, signer);

  const rows: string[] = [];
  rows.push([
    "index",
    "pool",
    "token0",
    "token0Name",
    "token1",
    "token1Name",
    "stakingRewards",
    "rewardAmountA",
    "rewardAmountB",
    "duration",
    "rewardRateA",
    "rewardRateB",
    "TVL",
    "finished",
    "expire in [days]",
    "finish",
    "current"
  ].join(";"));

  const poolLength = 10000;
  const startFrom = 0; // all reward-pools with lower indices are finished... we can skip them

  for (let i = startFrom; i < poolLength; i++) {
    console.log("i", i);
    let lp;
    let token0: string = '';
    let token1: string = '';
    let token0Name: string = '';
    let token1Name: string = '';
    let tvl: BigNumber | undefined;

    try {
      lp = await factory.stakingTokens(i);
    } catch (e) {
      console.log('looks like we dont have more lps', i);
      break;
    }

    try {
      const lpContract = IUniswapV2Pair__factory.connect(lp, signer);
      token0 = await lpContract.token0();
      token1 = await lpContract.token1();
      token0Name = await TokenUtils.tokenSymbol(token0);
      token1Name = await TokenUtils.tokenSymbol(token1);
    } catch (e) {
      console.error('cant fetch token names for ', lp);
      continue;
    }

    const info = await factory.stakingRewardsInfoByStakingToken(lp);
    const poolContract = IStakingDualRewards__factory.connect(info.stakingRewards, signer);

    const rewardRateA = await poolContract.rewardRateA();
    const rewardRateB = await poolContract.rewardRateB();
    const finish = (await poolContract.periodFinish()).toNumber();
    const currentTime = Math.floor(Date.now() / 1000);
    const isRewardPeriodFinished = finish < currentTime;

    try {
      tvl = await poolContract.totalSupply();
    } catch (e) {
      console.log('error fetch tvl', lp);
    }

    const line = [
      i,
      lp,
      token0,
      token0Name,
      token1,
      token1Name,
      info.stakingRewards,
      info.rewardAmountA,
      info.rewardAmountB,
      info.duration,
      rewardRateA,
      rewardRateB,
      tvl,
      isRewardPeriodFinished,
      finish > currentTime
        ? (finish - currentTime) / 60 / 60 / 24 // the number of days after which the pool will expire
        : 0,
      finish,
      currentTime
    ].join(";");
    rows.push(line);

    console.log("line", line);
  }

  mkdir('./tmp/download', {recursive: true}, (err) => {
    if (err) {
      throw err;
    }
  });

  writeFileSync('./tmp/download/dual_quick_pools_pure.csv', rows.join("\n"), 'utf8');
  console.log('done');
}

downloadDualQuickswapPure()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });