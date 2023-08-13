import { ContractFactory, providers, utils } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Libraries } from 'hardhat-deploy/dist/types';
import { Logger } from 'tslog';
import logSettings from '../../log_settings';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

const log: Logger<undefined> = new Logger(logSettings);

export const WAIT_BLOCKS_BETWEEN_DEPLOY = 50;

const libraries = new Map<string, string[]>([
  ['VeTetu', ['VeTetuLogo']],
  ['MockConverterStrategy', ['ConverterStrategyBaseLib', 'ConverterStrategyBaseLib2', 'StrategyLib2']],
  // common
  ['ConverterStrategyBaseLib', ['IterationPlanLib']],
  ['ConverterStrategyBaseLib2', ['StrategyLib']],
  ['BorrowLib', ['ConverterStrategyBaseLib']],
  ['BorrowLibFacade', ['BorrowLib', 'ConverterStrategyBaseLib']],
  ['ConverterStrategyBaseLibFacade', ['ConverterStrategyBaseLib']],
  ['ConverterStrategyBaseLibFacade2', ['ConverterStrategyBaseLib2']],
  // Balancer
  [
    'BalancerBoostedStrategy',
    ['ConverterStrategyBaseLib', 'ConverterStrategyBaseLib2', 'BalancerLogicLib', 'StrategyLib2'],
  ],
  ['BalancerBoostedDepositorFacade', ['BalancerLogicLib']],
  // Pair
  ['PairBasedStrategyLib', ['ConverterStrategyBaseLib', 'IterationPlanLib']],
  ['PairBasedStrategyLibFacade', ['PairBasedStrategyLib', 'ConverterStrategyBaseLib']],
  ['PairBasedStrategyLogicLib', ['ConverterStrategyBaseLib', 'ConverterStrategyBaseLib2', 'PairBasedStrategyLib', 'StrategyLib2']],
  ['PairBasedStrategyLogicLibFacade', ['StrategyLib2', 'PairBasedStrategyLogicLib']],
  // Uniswap V3
  [
    'UniswapV3ConverterStrategy',
    ['ConverterStrategyBaseLib', 'ConverterStrategyBaseLib2', 'StrategyLib2', 'UniswapV3ConverterStrategyLogicLib', 'PairBasedStrategyLib', 'PairBasedStrategyLogicLib'],
  ],
  ['UniswapV3ConverterStrategyLogicLib', ['UniswapV3Lib', 'UniswapV3DebtLib', 'ConverterStrategyBaseLib2', 'PairBasedStrategyLogicLib']],
  ['UniswapV3DebtLib', ['UniswapV3Lib', 'ConverterStrategyBaseLib2', 'BorrowLib', 'PairBasedStrategyLogicLib']],
  ['UniswapV3LibFacade', ['UniswapV3Lib']],
  ['UniswapV3ConverterStrategyLogicLibFacade', ['UniswapV3ConverterStrategyLogicLib']],
  // Algebra
  [
    'AlgebraConverterStrategy',
    ['ConverterStrategyBaseLib', 'ConverterStrategyBaseLib2', 'StrategyLib2', 'AlgebraConverterStrategyLogicLib', 'PairBasedStrategyLib', 'PairBasedStrategyLogicLib'],
  ],
  ['AlgebraConverterStrategyLogicLib', ['AlgebraLib', 'AlgebraDebtLib', 'ConverterStrategyBaseLib2', 'PairBasedStrategyLogicLib']],
  ['AlgebraDebtLib', ['AlgebraLib', 'ConverterStrategyBaseLib2', 'BorrowLib', 'PairBasedStrategyLogicLib']],
  // Kyber
  [
    'KyberConverterStrategy',
    ['ConverterStrategyBaseLib', 'ConverterStrategyBaseLib2', 'StrategyLib2', 'KyberConverterStrategyLogicLib', 'PairBasedStrategyLib', 'PairBasedStrategyLogicLib'],
  ],
  ['KyberConverterStrategyLogicLib', ['KyberLib', 'KyberDebtLib', 'ConverterStrategyBaseLib2', 'PairBasedStrategyLogicLib']],
  ['KyberDebtLib', ['KyberLib', 'ConverterStrategyBaseLib2', 'BorrowLib', 'PairBasedStrategyLogicLib']],
]);

export async function deployContract<T extends ContractFactory>(
  // tslint:disable-next-line
  hre: any,
  signer: SignerWithAddress,
  name: string,
  // tslint:disable-next-line:no-any
  ...args: any[]
) {
  if (hre.network.name !== 'hardhat') {
    await hre.run('compile');
  }
  const web3 = hre.web3;
  const ethers = hre.ethers;
  log.info(`Deploying ${name}`);
  log.info('Account balance: ' + utils.formatUnits(await signer.getBalance(), 18));

  const gasPrice = await web3.eth.getGasPrice();
  log.info('Gas price: ' + formatUnits(gasPrice, 9));
  const libs: string[] | undefined = libraries.get(name);
  let _factory;
  if (libs) {
    const librariesObj: Libraries = {};
    for (const lib of libs) {
      log.info('DEPLOY LIBRARY', lib, 'for', name);
      librariesObj[lib] = (await deployContract(hre, signer, lib)).address;
    }

    _factory = (await ethers.getContractFactory(
      name,
      {
        signer,
        libraries: librariesObj,
      },
    )) as T;
  } else {
    _factory = (await ethers.getContractFactory(
      name,
      signer,
    )) as T;
  }

  const instance = await _factory.deploy(...args, {
    // large gas limit is required for npm run coverage
    // see https://github.com/NomicFoundation/hardhat/issues/3121
    gasLimit: hre.network.name === 'hardhat' ? 29_000_000 : undefined,
    ...(await txParams(hre, signer.provider as providers.Provider)),
  });

  log.info('Deploy tx:', instance.deployTransaction.hash);
  await instance.deployed();

  const receipt = await ethers.provider.getTransactionReceipt(instance.deployTransaction.hash);
  console.log('DEPLOYED: ', name, receipt.contractAddress);

  if (hre.network.name !== 'hardhat' && hre.network.name !== 'foundry' && hre.network.name !== 'zktest') {
    await wait(hre, 10);
    if (args.length === 0) {
      await verify(hre, receipt.contractAddress);
    } else {
      await verifyWithArgs(hre, receipt.contractAddress, args);
    }
  }
  return _factory.attach(receipt.contractAddress);
}

// tslint:disable-next-line:no-any
async function wait(hre: any, blocks: number) {
  if (hre.network.name === 'hardhat') {
    return;
  }
  const start = hre.ethers.provider.blockNumber;
  while (true) {
    log.info('wait 10sec');
    await delay(10000);
    if (hre.ethers.provider.blockNumber >= start + blocks) {
      break;
    }
  }
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// tslint:disable-next-line:no-any
async function verify(hre: any, address: string) {
  try {
    await hre.run('verify:verify', {
      address,
    });
  } catch (e) {
    log.info('error verify ' + e);
  }
}

// tslint:disable-next-line:no-any
async function verifyWithArgs(hre: any, address: string, args: any[]) {
  try {
    await hre.run('verify:verify', {
      address, constructorArguments: args,
    });
  } catch (e) {
    log.info('error verify ' + e);
  }
}

export async function txParams(hre: HardhatRuntimeEnvironment, provider: providers.Provider) {

  const gasPrice = (await provider.getGasPrice()).toNumber();
  console.log('Gas price:', formatUnits(gasPrice, 9));
  const maxFee = '0x' + Math.floor(gasPrice * 1.5).toString(16);
  if (hre.network.name === 'hardhat') {
    return {
      maxPriorityFeePerGas: parseUnits('1', 9).toHexString(),
      maxFeePerGas: maxFee,
    };
  } else if (hre.network.name === 'foundry') {
    return {
      gasPrice: '0x' + Math.floor(gasPrice * 1.1).toString(16),
    };
  } else if (hre.network.config.chainId === 137) {
    return {
      maxPriorityFeePerGas: parseUnits('31', 9).toHexString(),
      maxFeePerGas: maxFee,
    };
  } else if (hre.network.config.chainId === 1) {
    return {
      maxPriorityFeePerGas: parseUnits('1', 9).toHexString(),
      maxFeePerGas: maxFee,
    };
  }
  return {
    gasPrice: '0x' + Math.floor(gasPrice * 1.1).toString(16),
  };
}
