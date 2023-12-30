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
  const { deployer, CONVERTER_ADDRESS, PANCAKE_USDC_USDbC_BASE, SPLITTER_USDbC_ADDRESS, PANCAKE_MASTERCHEF_BASE } = await getNamedAccounts();

  if (await isContractExist(hre, 'Strategy_PancakeConverterStrategy_UsdcUsdbc')) {
    return;
  }

  const core = Addresses.getCore() as CoreAddresses;

  const strategyImplDeployment = await deployments.get('PancakeConverterStrategy');
  const proxyDeployResult = await deployments.deploy('Strategy_PancakeConverterStrategy_UsdcUsdbc', {
    contract: '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });

  await deployments.execute(
    'Strategy_PancakeConverterStrategy_UsdcUsdbc',
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
  // console.log("core.controller", core.controller);
  // console.log("SPLITTER_USDbC_ADDRESS", SPLITTER_USDbC_ADDRESS);
  // console.log("CONVERTER_ADDRESS", CONVERTER_ADDRESS);
  // console.log("PANCAKE_USDC_USDbC_BASE", PANCAKE_USDC_USDbC_BASE);
  // console.log("PANCAKE_MASTERCHEF", PANCAKE_MASTERCHEF_BASE);
  await RunHelper.runAndWait2(strategyContract.populateTransaction.init(
    core.controller,
    SPLITTER_USDbC_ADDRESS,
    CONVERTER_ADDRESS,
    PANCAKE_USDC_USDbC_BASE,
    0,
    0,
    [
      parseUnits('0.997'),
      parseUnits('0.998'),
      parseUnits('1.003'),
      parseUnits('1.002')
    ],
    PANCAKE_MASTERCHEF_BASE,
    {
      ...params,
    },
  ));
};
export default func;
func.tags = ['Strategy_PancakeConverterStrategy_UsdcUsdbc'];
func.dependencies = ['PancakeConverterStrategy'];
func.skip = async hre => (await hre.getChainId()) !== '8453'
