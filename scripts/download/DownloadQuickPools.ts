import {ethers} from "hardhat";
import {mkdir, writeFileSync} from "fs";
import {utils} from "ethers";
import {DeployerUtilsLocal} from "../utils/DeployerUtilsLocal";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {VaultUtils} from "../../test/VaultUtils";
import {TokenUtils} from "../utils/TokenUtils";
import {
  IDragonLair__factory,
  IStakingRewards__factory,
  IStakingRewardsFactory__factory,
  IUniswapV2Pair__factory
} from "../../typechain";

const exclude = new Set<string>([]);


/**
 * Download QuickSwap reward pools info to CSV file.
 * Problems:
 * 1) tetu-v2 doesn't have tools.calculator, so some part of the code was commented with todo
 * 2) getVaultInfoFromServer doesn't work with v2
 *
 * To run the script execute a following command:
 *      npx hardhat run scripts/download/DownloadQuickPools.ts
 *      npx hardhat run --network localhost scripts/download/DownloadQuickPools.ts
 */
async function downloadQuick() {
  const signer = (await ethers.getSigners())[0];
  const core = await DeployerUtilsLocal.getCoreAddresses();
  const tools = await DeployerUtilsLocal.getToolsAddresses();
  const factory = IStakingRewardsFactory__factory.connect(MaticAddresses.QUICK_STAKING_FACTORY_V2, signer);
  console.log('rewardsToken', await factory.rewardsToken());

  // todo const priceCalculator = IPriceCalculator__factory.connect(tools.calculator, signer);

  const vaultInfos = await VaultUtils.getVaultInfoFromServer();
  const underlyingStatuses = new Map<string, boolean>();
  const currentRewards = new Map<string, number>();
  const underlyingToVault = new Map<string, string>();
  for (const vInfo of vaultInfos) {
    if (vInfo.platform !== '2') {
      continue;
    }
    underlyingStatuses.set(vInfo.underlying.toLowerCase(), vInfo.active);
    underlyingToVault.set(vInfo.underlying.toLowerCase(), vInfo.addr);
    if (vInfo.active) {
      // todo const vctr = ISmartVault__factory.connect(vInfo.addr, signer);
      // todo currentRewards.set(vInfo.underlying.toLowerCase(), await VaultUtils.vaultRewardsAmount(vctr, core.psVault));
    }
  }
  console.log('loaded vaults', underlyingStatuses.size);
  const poolLength = 10000;
  // todo const quickPrice = await priceCalculator.getPriceWithDefaultOutput(MaticAddresses.QUICK_TOKEN);

  const dQuickCtr = IDragonLair__factory.connect(MaticAddresses.dQUICK_TOKEN, signer);
  const dQuickRatio = await dQuickCtr.dQUICKForQUICK(utils.parseUnits('1'));
  // todo const dQuickPrice = quickPrice.mul(dQuickRatio).div(utils.parseUnits('1'));
  // todo console.log('dQuickPrice', utils.formatUnits(dQuickPrice));
  // todo console.log('quickPrice', utils.formatUnits(quickPrice));

  let infos: string = 'idx, lp_name, lp_address, token0, token0_name, token1, token1_name, pool, rewardAmount, vault, weekRewardUsd, tvlUsd, apr, currentRewards \n';
  for (let i = 0; i < poolLength; i++) {
    console.log('id', i);
    let lp;
    let token0: string = '';
    let token1: string = '';
    let token0Name: string = '';
    let token1Name: string = '';

    try {
      lp = await factory.stakingTokens(i);
    } catch (e) {
      console.log('looks like we dont have more lps', i);
      break;
    }

    console.log('lp', lp);

    const status = underlyingStatuses.get(lp.toLowerCase());
    if (!status) {
      console.log('not active', i);
      // continue;
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
    // factory doesn't hold duration, suppose that it is a week
    const durationSec = 60 * 60 * 24 * 7;

    const poolContract = IStakingRewards__factory.connect(info[0], signer);

    const rewardRate = await poolContract.rewardRate();
    const notifiedAmount = rewardRate.mul(durationSec);
    const notifiedAmountN = +utils.formatUnits(notifiedAmount);

    let durationDays = (durationSec) / 60 / 60 / 24;
    const weekDurationRatio = 7 / durationDays;
    // todo let notifiedAmountUsd = notifiedAmountN * +utils.formatUnits(dQuickPrice);

    const finish = (await poolContract.periodFinish()).toNumber();
    const currentTime = Math.floor(Date.now() / 1000);

    if (finish < currentTime) {
      console.log('reward finished', token0Name, token1Name);
      durationDays = 0
      // todo notifiedAmountUsd = 0;
    }

    console.log('duration', durationDays);
    console.log('weekDurationRatio', weekDurationRatio);
    console.log('notifiedAmount', notifiedAmountN);
    // todo let tvlUsd = 0;
    try {
      const tvl = await poolContract.totalSupply();
      // todo const underlyingPrice = await priceCalculator.getPriceWithDefaultOutput(lp);
      // todo tvlUsd = +utils.formatUnits(tvl) * +utils.formatUnits(underlyingPrice);
    } catch (e) {
      console.log('error fetch tvl', lp);
    }
    // todo const apr = ((notifiedAmountUsd / tvlUsd) / durationDays) * 365 * 100

    const data = [
      i,
      'QUICK_' + token0Name + '_' + token1Name,
      lp,
      token0,
      token0Name,
      token1,
      token1Name,
      info[0],
      "rewardAmount", // todo notifiedAmountUsd.toFixed(2),
      underlyingToVault.get(lp.toLowerCase()),
      "weekRewardUsd", // todo (notifiedAmountUsd * weekDurationRatio).toFixed(2),
      "TVL", // todo tvlUsd.toFixed(2)
      "APR", // todo apr.toFixed(2) + ',' +
      currentRewards.get(lp.toLowerCase())
    ].join(",");

    console.log(data);
    infos += data + '\n';
  }

  mkdir('./tmp/download', {recursive: true}, (err) => {
    if (err) throw err;
  });

  writeFileSync('./tmp/download/quick_pools.csv', infos, 'utf8');
  console.log('done');
}

downloadQuick()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
