import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { Consts } from '../../deploy_constants/constatants';
import { isContractExist } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, execute } = deployments;
  const { deployer, DAI_ADDRESS } = await getNamedAccounts();
  const strategy = await deployments.get('tDaiStrategy');

  if (await isContractExist(hre, 'tDai4626Strict')) {
    return;
  }

  await deploy('tDai4626Strict', {
    contract: 'ERC4626Strict',
    from: deployer,
    args: [DAI_ADDRESS, 'tDAI', 'tDAI', strategy.address, Consts.STRICT_VAULT_BUFFER],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  const erc4626 = await deployments.get('tDai4626Strict');
  await execute(
    'tDaiStrategy',
    {
      from: deployer,
      log: true,
    },
    'init',
    erc4626.address,
  );

};
export default func;
func.tags = ['tDai4626Strict'];
func.skip = async hre => (await hre.getChainId()) !== '137'
