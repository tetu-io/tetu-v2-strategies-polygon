import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from 'hardhat';
import { KyberConverterStrategy } from '../../typechain';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { isContractExist, txParams } from '../../deploy_constants/deploy-helpers';
import { RunHelper } from '../../scripts/utils/RunHelper';
import {Misc} from "../../scripts/utils/Misc";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer, CONVERTER_ADDRESS, KYBER_USDC_USDT, SPLITTER_USDC_ADDRESS, KNC_ADDRESS} = await getNamedAccounts();

  if (await isContractExist(hre, 'Strategy_KyberConverterStrategy_UsdcUsdt')) {
    return;
  }

  const core = Addresses.getCore() as CoreAddresses;

  const strategyImplDeployment = await deployments.get('KyberConverterStrategy');
  const proxyDeployResult = await deployments.deploy('Strategy_KyberConverterStrategy_UsdcUsdt', {
    contract: '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    from: deployer,
    log: true,
    ...(await txParams(hre, ethers.provider)),
  });

  await deployments.execute(
    'Strategy_KyberConverterStrategy_UsdcUsdt',
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
    KYBER_USDC_USDT,
    0,
    0,
    true,
    40,
      [0, 0, Misc.MAX_UINT, 0],
      [0, 0, Misc.MAX_UINT, 0],
    {
      ...params,
    },
  ));
};
export default func;
func.tags = ['Strategy_KyberConverterStrategy_UsdcUsdt'];
func.dependencies = ['KyberConverterStrategy'];
