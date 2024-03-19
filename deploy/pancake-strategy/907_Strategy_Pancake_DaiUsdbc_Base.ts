import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from 'hardhat';
import { PancakeConverterStrategy } from '../../typechain';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { isContractExist, txParams } from '../../deploy_constants/deploy-helpers';
import { RunHelper } from '../../scripts/utils/RunHelper';
import {parseUnits} from "ethers/lib/utils";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer, CONVERTER_ADDRESS, PANCAKE_DAI_USDbC_BASE, SPLITTER_USDbC_ADDRESS, PANCAKE_MASTERCHEF_BASE } = await getNamedAccounts();

  if (await isContractExist(hre, 'Strategy_PancakeConverterStrategy_DaiUsdbc')) {
    return;
  }

  const core = Addresses.getCore() as CoreAddresses;

  const strategyImplDeployment = await deployments.get('PancakeConverterStrategy');
  const proxyDeployResult = await deployments.deploy('Strategy_PancakeConverterStrategy_DaiUsdbc', {
    contract: '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });

  await deployments.execute(
    'Strategy_PancakeConverterStrategy_DaiUsdbc',
    {
      from: deployer,
      log: true,
      ...(await txParams(hre, ethers.provider)),
    },
    'initProxy',
    strategyImplDeployment.address,
  );

  const strategyContract = await ethers.getContractAt(
    'PancakeConverterStrategy',
    proxyDeployResult.address,
  ) as PancakeConverterStrategy;
  const params = await txParams(hre, ethers.provider);
  await RunHelper.runAndWait2(strategyContract.populateTransaction.init(
    core.controller,
    SPLITTER_USDbC_ADDRESS,
    CONVERTER_ADDRESS,
    PANCAKE_DAI_USDbC_BASE,
    0,
    0,
    [
      parseUnits('0.999'),
      parseUnits('0.9991'),
      parseUnits('1.001'),
      parseUnits('1.0009'),
    ],
    PANCAKE_MASTERCHEF_BASE,
    {
      ...params,
    },
  ));
};
export default func;
func.tags = ['Strategy_PancakeConverterStrategy_DaiUsdbc'];
func.dependencies = ['PancakeConverterStrategy'];
func.skip = async hre => true // (await hre.getChainId()) !== '8453'
