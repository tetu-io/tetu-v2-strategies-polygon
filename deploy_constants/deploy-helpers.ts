import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { providers } from 'ethers';
import hre, { ethers } from 'hardhat';
import { Libraries } from 'hardhat-deploy/types';
import { txParamsBasic } from '../scripts/utils/tx-params';

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


export async function txParams(
  hreL: HardhatRuntimeEnvironment = hre,
  provider: providers.Provider = ethers.provider,
  acceptance = 2,
) {
  return txParamsBasic(provider, hreL, acceptance);
}

export async function txParams2() {
  return txParams();
}

export async function getDeployedContractByName(name: string): Promise<string> {
  const { deployments } = hre;
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
    ...(await txParams()),
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
