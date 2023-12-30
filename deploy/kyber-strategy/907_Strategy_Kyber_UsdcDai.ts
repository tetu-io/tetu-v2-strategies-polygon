import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from 'hardhat';
import { KyberConverterStrategy } from '../../typechain';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { isContractExist, txParams } from '../../deploy_constants/deploy-helpers';
import { RunHelper } from '../../scripts/utils/RunHelper';
import {parseUnits} from "ethers/lib/utils";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer, CONVERTER_ADDRESS, KYBER_USDC_DAI, SPLITTER_USDC_ADDRESS, KNC_ADDRESS} = await getNamedAccounts();

  if (await isContractExist(hre, 'Strategy_KyberConverterStrategy_UsdcDai')) {
    return;
  }

  const core = Addresses.getCore() as CoreAddresses;

  const strategyImplDeployment = await deployments.get('KyberConverterStrategy');
  const proxyDeployResult = await deployments.deploy('Strategy_KyberConverterStrategy_UsdcDai', {
    contract: '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });

  await deployments.execute(
    'Strategy_KyberConverterStrategy_UsdcDai',
    {
      from: deployer,
      log: true,
      ...(await txParams(hre, ethers.provider)),
    },
    'initProxy',
    strategyImplDeployment.address,
  );

  const strategyContract = await ethers.getContractAt(
    'KyberConverterStrategy',
    proxyDeployResult.address,
  ) as KyberConverterStrategy;
  const params = await txParams(hre, ethers.provider);
  await RunHelper.runAndWait(() => strategyContract.init(
    core.controller,
    SPLITTER_USDC_ADDRESS,
    CONVERTER_ADDRESS,
    KYBER_USDC_DAI,
    0,
    0,
    true,
    55,
    [
      parseUnits('0.999'),
      parseUnits('0.9991'),
      parseUnits('1.001'),
      parseUnits('1.0009')
    ],
    {
      ...params,
    },
  ));
};
export default func;
func.tags = ['Strategy_KyberConverterStrategy_UsdcDai'];
func.dependencies = ['KyberConverterStrategy'];
func.skip = async hre => true // (await hre.getChainId()) !== '137'
