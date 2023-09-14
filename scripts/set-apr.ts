import { ethers } from 'hardhat';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { IStrategyV2__factory, StrategySplitterV2__factory } from '../typechain';
import { RunHelper } from './utils/RunHelper';
import { txParams2 } from '../deploy_constants/deploy-helpers';

const STRATS = new Map<string, number>([
  ['0x7bbCDcEe68c3DB2Dce5C9b132E426Ef778b48533', -1], // Algebra USDC/USDT NSR
  ['0x6565e8136CD415F053C81Ff3656E72574F726a5E', 52], // UniV3 USDC/USDT-100 NSR
  ['0x4B8bD2623d7480850E406B9f2960305f44c7aDeb', 51], // Kyber USDC/USDT NSR
  ['0x8EC9134046740F83BDED78d6DDcAdAEC42fC61b0', 50], // Kyber USDC/DAI NSR
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
