import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from 'hardhat';
import { UniswapV3ConverterStrategy } from '../../typechain';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { isContractExist, txParams } from '../../deploy_constants/deploy-helpers';
import { RunHelper } from '../../scripts/utils/RunHelper';
import {Misc} from "../../scripts/utils/Misc";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer, CONVERTER_ADDRESS, UNISWAPV3_WMATIC_MATICX_100, SPLITTER_WMATIC_ADDRESS } = await getNamedAccounts();

  if (await isContractExist(hre, 'Strategy_UniswapV3ConverterStrategy_WMaticMaticX100')) {
    return;
  }

  const core = Addresses.getCore() as CoreAddresses;

  const strategyImplDeployment = await deployments.get('UniswapV3ConverterStrategy');
  const proxyDeployResult = await deployments.deploy('Strategy_UniswapV3ConverterStrategy_WMaticMaticX100', {
    contract: '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });

  await deployments.execute(
    'Strategy_UniswapV3ConverterStrategy_WMaticMaticX100',
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
    SPLITTER_WMATIC_ADDRESS,
    CONVERTER_ADDRESS,
    UNISWAPV3_WMATIC_MATICX_100,
    0,
    0,
    [0, 0, Misc.MAX_UINT, 0],
    [0, 0, Misc.MAX_UINT, 0],
    {
      ...params,
    },
  ));
};
export default func;
func.tags = ['Strategy_UniswapV3ConverterStrategy_WMaticMaticX100'];
func.dependencies = ['UniswapV3ConverterStrategy'];
func.skip = async () => true
