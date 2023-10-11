/*
import { univ3ConverterData } from './univ3-converter-data';
import { ethers } from 'hardhat';

const STRATEGY = '0x807a528818113a6f65b7667a59a4caaac719fc12';

async function main() {
  const block = await ethers.provider.getBlockNumber();

  await univ3ConverterData(STRATEGY, block);
  await univ3ConverterData(STRATEGY, block - 60 * 60 * 24 / 2 * 2);
}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
*/
