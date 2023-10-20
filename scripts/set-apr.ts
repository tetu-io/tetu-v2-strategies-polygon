import { ethers } from 'hardhat';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { IStrategyV2__factory, StrategySplitterV2__factory } from '../typechain';
import { RunHelper } from './utils/RunHelper';
import { txParams2 } from '../deploy_constants/deploy-helpers';

const STRATS = new Map<string, number>([
  ['0xA8105284aA9C9A20A2081EEE1ceeF03d9719A5AD', 10], // Strategy_AlgebraConverterStrategy_UsdcUsdt 3.0.0
  ['0xd0Dff2a31516fEDb80824C9B9E2DDcbfeF2C41e2', 5], // Strategy_KyberConverterStrategy_UsdcDai 3.0.0
  ['0x792Bcc2f14FdCB9FAf7E12223a564e7459eA4201', 14], // Strategy_KyberConverterStrategy_UsdcUsdt 3.0.0
  ['0xCdc5560AB926Dca3d4989bF814469Af3f989Ab2C', 15], // Strategy_UniswapV3ConverterStrategy_UsdcUsdt 3.0.0
]);

async function main() {
  const [signer] = await ethers.getSigners();

  for (const [strat, apr] of STRATS) {
    const splitter = StrategySplitterV2__factory.connect(await IStrategyV2__factory.connect(strat, ethers.provider)
      .splitter(), signer);

    const name = await IStrategyV2__factory.connect(strat, ethers.provider).strategySpecificName();
    const currentApr = +formatUnits(await splitter.averageApr(strat), 3);
    if (apr > 0 && currentApr !== apr) {
      console.log(`${name} set APR ${currentApr} => ${apr}`);
      const tp = await txParams2();
      await RunHelper.runAndWaitAndSpeedUp(
        ethers.provider,
        () => splitter.setAPRs([strat], [parseUnits(apr.toString(), 3)],
          { ...tp },
        ),
      );

      console.log(`${name} APR after ${formatUnits(await splitter.averageApr(strat), 3)}`);
    } else {
      console.log('APR is fine: ', currentApr);
    }
  }


}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
