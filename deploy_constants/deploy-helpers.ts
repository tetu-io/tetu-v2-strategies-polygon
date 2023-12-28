import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { providers } from 'ethers';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { ethers } from 'hardhat';
import { delay } from '@nomiclabs/hardhat-etherscan/dist/src/etherscan/EtherscanService';
import { Libraries } from 'hardhat-deploy/types';

// tslint:disable-next-line:no-var-requires
const hreLocal = require('hardhat');

export async function isContractExist(hre: HardhatRuntimeEnvironment, contractName: string): Promise<boolean> {
  const { deployments } = hre;
  try {
    const existingContract = await deployments.get(contractName);
    if (existingContract.address) {
      console.log(contractName + ' already deployed at:', existingContract.address);
      return true;
    }
  } catch {}
  return false;
}

/** @deprecated */
export async function _txParams(hre: HardhatRuntimeEnvironment, provider: providers.Provider) {

  const gasPrice = (await provider.getGasPrice()).toNumber();
  console.log('Gas price:', formatUnits(gasPrice, 9));
  if (hre.network.name === 'hardhat') {
    return {
      maxPriorityFeePerGas: parseUnits('1', 9),
      maxFeePerGas: (gasPrice * 1.5).toFixed(0),
    };
  } else if (hre.network.config.chainId === 137) {
    return {
      maxPriorityFeePerGas: parseUnits('50', 9),
      maxFeePerGas: (gasPrice * 3).toFixed(0),
    };
  } else if (hre.network.config.chainId === 1) {
    return {
      maxPriorityFeePerGas: parseUnits('1', 9),
      maxFeePerGas: (gasPrice * 1.5).toFixed(0),
    };
  } else if (hre.network.config.chainId === 8453) {
    return {
      maxPriorityFeePerGas: parseUnits('0.000001', 9),
      maxFeePerGas: (gasPrice * 1.5).toFixed(0),
    };
  }
  return {
    gasPrice: (gasPrice * 1.1).toFixed(0),
  };
}

export async function txParams(hre: HardhatRuntimeEnvironment, provider: providers.Provider) {
  const feeData = await provider.getFeeData();

  console.log('maxPriorityFeePerGas', formatUnits(feeData.maxPriorityFeePerGas?.toString() ?? '0', 9));
  console.log('maxFeePerGas', formatUnits(feeData.maxFeePerGas?.toString() ?? '0', 9));
  console.log('gas price:', formatUnits(feeData.gasPrice?.toString() ?? '0', 9));

  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    const maxPriorityFeePerGas = Math.max(feeData.maxPriorityFeePerGas?.toNumber() ?? 1, feeData.lastBaseFeePerGas?.toNumber() ?? 1);
    const maxFeePerGas = (feeData.maxFeePerGas?.toNumber() ?? 1) * 2;
    return {
      maxPriorityFeePerGas: maxPriorityFeePerGas.toFixed(0),
      maxFeePerGas: maxFeePerGas.toFixed(0),
    };
  } else {
    return {
      gasPrice: ((feeData.gasPrice?.toNumber() ?? 1) * 1.2).toFixed(0),
    };
  }
}

export async function txParams2() {
  return txParams(hreLocal, ethers.provider);
}

export async function getDeployedContractByName(name: string): Promise<string> {
  const { deployments } = hreLocal;
  const contract = await deployments.get(name);
  if (!contract) {
    throw new Error(`Contract ${name} not deployed`);
  }
  return contract.address;
}

export async function hardhatDeploy(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  verify = false,
  libraries?: Libraries,
  deploymentName?: string,
  // tslint:disable-next-line:no-any
  args?: any[] | undefined,
  skipIfAlreadyDeployed = false,
) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  let oldAdr: string | undefined;
  try {
    oldAdr = (await deployments.get(deploymentName || contractName)).address;
  } catch (e) {}

  await deployments.deploy(deploymentName || contractName, {
    contract: contractName,
    from: deployer,
    log: true,
    args,
    libraries,
    skipIfAlreadyDeployed,
    ...(await txParams(hre, ethers.provider)),
  });

  const newAdr = await deployments.get(deploymentName || contractName);

  // verify manually later - much faster
  // if (!oldAdr || oldAdr !== newAdr.address) {
  //   if (verify && hre.network.name !== 'hardhat') {
  //     await wait(10);
  //     if (args) {
  //       await verifyWithArgs(newAdr.address, args);
  //     } else {
  //       await verifyWithoutArgs(newAdr.address);
  //     }
  //   }
  // }
}


async function wait(blocks: number) {
  if (hreLocal.network.name === 'hardhat') {
    return;
  }
  const start = hreLocal.ethers.provider.blockNumber;
  while (true) {
    console.log('wait 10sec');
    await delay(10000);
    if (hreLocal.ethers.provider.blockNumber >= start + blocks) {
      break;
    }
  }
}

// tslint:disable-next-line:no-any
async function verifyWithArgs(address: string, constructorArguments: any[]) {
  try {
    await hreLocal.run('verify:verify', {
      address,
      constructorArguments,
    });
  } catch (e) {
    console.error('error verify ' + e);
  }
}

async function verifyWithoutArgs(address: string) {
  try {
    await hreLocal.run('verify:verify', {
      address,
    });
  } catch (e) {
    console.error('error verify ' + e);
  }
}


// Algebra USDC/USDT NSR 0x7bbCDcEe68c3DB2Dce5C9b132E426Ef778b48533
// UniV3 USDC/USDT-100 NSR 0x6565e8136CD415F053C81Ff3656E72574F726a5E
// Kyber USDC/USDT NSR 0x4B8bD2623d7480850E406B9f2960305f44c7aDeb
// Kyber USDC/DAI NSR 0x8EC9134046740F83BDED78d6DDcAdAEC42fC61b0
