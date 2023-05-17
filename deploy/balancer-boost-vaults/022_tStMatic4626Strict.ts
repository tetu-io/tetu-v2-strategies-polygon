import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { Consts } from '../../deploy_constants/constatants'
import { TetuV1SingleTokenStrictStrategy__factory } from '../../typechain';
import { ethers } from 'hardhat';
import { Misc } from '../../scripts/utils/Misc';
import { txParams } from '../../deploy_constants/deploy-helpers';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;
  const {deployer, STMATIC_ADDRESS} = await getNamedAccounts();

  const strategy = await deployments.get('tStMaticStrategy');

  await deploy('tStMatic4626Strict', {
    contract: 'ERC4626Strict',
    from: deployer,
    args: [STMATIC_ADDRESS, 'tstMATIC', 'tstMATIC', strategy.address, Consts.STRICT_VAULT_BUFFER],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  const currentVault = await TetuV1SingleTokenStrictStrategy__factory.connect(
    strategy.address,
    (await ethers.getSigners())[0],
  ).vault();

  if (currentVault === Misc.ZERO_ADDRESS) {
    const vault = await deployments.get('tStMatic4626Strict');
    await deployments.execute(
      'tStMaticStrategy',
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
func.tags = ['tStMatic4626Strict']
func.dependencies = ['tStMaticStrategy']
