import {ethers} from "hardhat";
import {IStakingRewards__factory, IStakingRewardsFactory__factory, IUniswapV2Pair__factory} from "../../typechain";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {TokenUtils} from "../utils/TokenUtils";
import {BigNumber} from "ethers";
import {mkdir, writeFileSync} from "fs";

/**
 * Download QuickSwap reward pools info to CSV file.
 * "Pure" means that there are no vaults or other tetu-related info in results.
 *
 * To run the script execute a following command:
 *      npx hardhat run scripts/download/DownloadQuickswapPoolsPure.ts
 *      npx hardhat run --network localhost scripts/download/DownloadQuickswapPoolsPure.ts
 */
async function downloadQuickswapPure() {
  const signer = (await ethers.getSigners())[0];
  const factory = IStakingRewardsFactory__factory.connect(MaticAddresses.QUICK_STAKING_FACTORY_V2, signer);
  console.log('rewardsToken', await factory.rewardsToken());

  const rows: string[] = [];
  rows.push([
    "index",
    "pool",
    "token0",
    "token0Name",
    "token1",
    "token1Name",
    "stakingRewards",
    "rewardAmount",
    "duration",
    "rewardRate",
    "TVL",
    "finished",
    "expire in [days]",
    "finish",
    "current"
  ].join(";"));

  const poolLength = 10000;
  const startFrom = 0; // 110 // all reward-pools with lower indices are finished... we can skip them

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
    const poolContract = IStakingRewards__factory.connect(info.stakingRewards, signer);

    const rewardRate = await poolContract.rewardRate();
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
      info.rewardAmount,
      info.duration,
      rewardRate,
      tvl,
      isRewardPeriodFinished,
      finish > currentTime
        ? (finish - currentTime) / 60 / 60 / 24
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

  writeFileSync('./tmp/download/quick_pools_pure.csv', rows.join("\n"), 'utf8');
  console.log('done');
}

downloadQuickswapPure()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
