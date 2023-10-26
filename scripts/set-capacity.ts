import { ethers } from 'hardhat';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { IStrategyV2__factory, StrategySplitterV2__factory, TetuVaultV2__factory } from '../typechain';
import { RunHelper } from './utils/RunHelper';
import { txParams2 } from '../deploy_constants/deploy-helpers';
import { Misc } from './utils/Misc';

const STRATS: { [chainId: number]: Map<string, number> } = {
  137: new Map<string, number>([
    ['0xA8105284aA9C9A20A2081EEE1ceeF03d9719A5AD', 100_000], // Strategy_AlgebraConverterStrategy_UsdcUsdt 3.0.0
    ['0xd0Dff2a31516fEDb80824C9B9E2DDcbfeF2C41e2', 100_000], // Strategy_KyberConverterStrategy_UsdcDai 3.0.0
    ['0x792Bcc2f14FdCB9FAf7E12223a564e7459eA4201', 300_000], // Strategy_KyberConverterStrategy_UsdcUsdt 3.0.0
    ['0xCdc5560AB926Dca3d4989bF814469Af3f989Ab2C', 300_000], // Strategy_UniswapV3ConverterStrategy_UsdcUsdt 3.0.0
  ]),
  8453: new Map<string, number>([
    ['0x32f7C3a5319A612C1992f021aa70510bc9F16161', 50], // Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai
    ['0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e', 50], // Strategy_UniswapV3ConverterStrategy_Base_UsdbcUsdc
  ]),
};

async function main() {
  const [signer] = await ethers.getSigners();


  for (const [strat, capacity] of STRATS[Misc.getChainId()]) {
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
