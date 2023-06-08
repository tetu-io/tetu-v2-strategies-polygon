import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { Consts } from '../../deploy_constants/constatants';
import { TetuV1SingleTokenStrictStrategy__factory } from '../../typechain';
import { ethers } from 'hardhat';
import { Misc } from '../../scripts/utils/Misc';
import { txParams } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer, WMATIC_ADDRESS } = await getNamedAccounts();
  const strategy = await deployments.get('tWMaticStrategy');

  await deploy('tWMatic4626Strict', {
    contract: 'ERC4626Strict',
    from: deployer,
    args: [WMATIC_ADDRESS, 'tWMATIC', 'tWMATIC', strategy.address, Consts.STRICT_VAULT_BUFFER],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  const tWMaticVault = await TetuV1SingleTokenStrictStrategy__factory.connect(
    strategy.address,
    (await ethers.getSigners())[0],
  ).vault();

  if (tWMaticVault === Misc.ZERO_ADDRESS) {
    const vault = await deployments.get('tWMatic4626Strict');
    await deployments.execute(
      'tWMaticStrategy',
      {
        from: deployer,
        log: true,
        ...(await txParams(hre, ethers.provider)),
      },
      'init',
      vault.address,
    );
  }

};
export default func;
func.tags = ['tWMatic4626Strict'];
func.dependencies = ['tWMaticStrategy'];
func.skip = async () => true
