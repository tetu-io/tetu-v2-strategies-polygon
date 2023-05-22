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

export async function txParams(hre: HardhatRuntimeEnvironment, provider: providers.Provider) {

  const gasPrice = (await provider.getGasPrice()).toNumber();
  console.log('Gas price:', formatUnits(gasPrice, 9));
  if (hre.network.name === 'hardhat') {
    return {
      maxPriorityFeePerGas: parseUnits('1', 9),
      maxFeePerGas: (gasPrice * 1.5).toFixed(0),
    };
  } else if (hre.network.config.chainId === 137) {
    return {
      maxPriorityFeePerGas: parseUnits('31', 9),
      maxFeePerGas: (gasPrice * 1.5).toFixed(0),
    };
  } else if (hre.network.config.chainId === 1) {
    return {
      maxPriorityFeePerGas: parseUnits('1', 9),
      maxFeePerGas: (gasPrice * 1.5).toFixed(0),
    };
  }
  return {
    gasPrice: (gasPrice * 1.1).toFixed(0),
  };
}

export async function getDeployedContractByName(name: string) {
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
  // tslint:disable-next-line:no-any
  args?: any[] | undefined,
) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  let oldAdr: string | undefined;
  try {
    oldAdr = (await deployments.get(contractName)).address;
  } catch (e) {}


  await deployments.deploy(contractName, {
    contract: contractName,
    from: deployer,
    log: true,
    args,
    libraries,
    ...(await txParams(hre, ethers.provider)),
  });

  const newAdr = await deployments.get(contractName);

  if (!oldAdr || oldAdr !== newAdr.address) {
    if (verify && hre.network.name !== 'hardhat') {
      await wait(10);
      await verifyWithoutArgs(newAdr.address);
    }
  }
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

async function verifyWithoutArgs(address: string) {
  try {
    await hreLocal.run('verify:verify', {
      address,
    });
  } catch (e) {
    console.error('error verify ' + e);
  }
}
