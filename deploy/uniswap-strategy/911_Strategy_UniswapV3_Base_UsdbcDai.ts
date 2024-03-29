import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from 'hardhat';
import { UniswapV3ConverterStrategy } from '../../typechain';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { isContractExist, txParams } from '../../deploy_constants/deploy-helpers';
import { RunHelper } from '../../scripts/utils/RunHelper';
import {parseUnits} from "ethers/lib/utils";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer, CONVERTER_ADDRESS, UNISWAPV3_BASE_DAI_USDbC_100, SPLITTER_USDbC_ADDRESS } = await getNamedAccounts();

  if (await isContractExist(hre, 'Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai')) {
    return;
  }

  const core = Addresses.getCore() as CoreAddresses;

  const strategyImplDeployment = await deployments.get('UniswapV3ConverterStrategy');
  const proxyDeployResult = await deployments.deploy('Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai', {
    contract: '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });

  await deployments.execute(
    'Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai',
    {
      from: deployer,
      log: true,
      ...(await txParams(hre, ethers.provider)),
    },
    'initProxy',
    strategyImplDeployment.address,
  );

  const strategyContract = await ethers.getContractAt(
    'UniswapV3ConverterStrategy',
    proxyDeployResult.address,
  ) as UniswapV3ConverterStrategy;
  const params = await txParams(hre, ethers.provider);
  await RunHelper.runAndWait(() => strategyContract.init(
    core.controller,
      SPLITTER_USDbC_ADDRESS,
    CONVERTER_ADDRESS,
      UNISWAPV3_BASE_DAI_USDbC_100,
    0,
    0,
    [
      parseUnits('0.9995'),
      parseUnits('0.9996'),
      parseUnits('1.0005'),
      parseUnits('1.0004'),
    ],
    {
      ...params,
    },
  ));
};
export default func;
func.tags = ['Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai'];
func.dependencies = ['UniswapV3ConverterStrategy'];
func.skip = async hre => (await hre.getChainId()) !== '8453'
