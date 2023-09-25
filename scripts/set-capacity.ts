import { ethers } from 'hardhat';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { IStrategyV2__factory, StrategySplitterV2__factory, TetuVaultV2__factory } from '../typechain';
import { RunHelper } from './utils/RunHelper';
import { txParams2 } from '../deploy_constants/deploy-helpers';

const STRATS = new Map<string, number>([
  ['0x7bbCDcEe68c3DB2Dce5C9b132E426Ef778b48533', 700_000], // Algebra USDC/USDT NSR
  ['0x6565e8136CD415F053C81Ff3656E72574F726a5E', 200_000], // UniV3 USDC/USDT-100 NSR
  ['0x4B8bD2623d7480850E406B9f2960305f44c7aDeb', 200_000], // Kyber USDC/USDT NSR
  ['0x8EC9134046740F83BDED78d6DDcAdAEC42fC61b0', 200_000], // Kyber USDC/DAI NSR
]);

async function main() {
  const [signer] = await ethers.getSigners();


  for (const [strat, capacity] of STRATS) {
    const splitter = StrategySplitterV2__factory.connect(await IStrategyV2__factory.connect(strat, ethers.provider)
      .splitter(), signer);
    const vault = await splitter.vault();
    const decimals = await TetuVaultV2__factory.connect(vault, ethers.provider).decimals();

    const name = await IStrategyV2__factory.connect(strat, ethers.provider).strategySpecificName();
    const currentCapacity = +formatUnits(await splitter.strategyCapacity(strat), decimals);
    if (currentCapacity !== capacity) {
      console.log(`${name} set capacity ${currentCapacity} => ${capacity}`);
      const tp = await txParams2();
      await RunHelper.runAndWaitAndSpeedUp(
        ethers.provider,
        () => splitter.setStrategyCapacity(strat, parseUnits(capacity.toString(), decimals),
          { ...tp },
        ),
      );
      console.log(`${name} capacity after ${formatUnits(await splitter.strategyCapacity(strat), decimals)}`);
    } else {
      console.log('capacity is fine');
    }
  }
}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
