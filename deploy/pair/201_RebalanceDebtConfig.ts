import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import {hardhatDeploy, isContractExist} from '../../deploy_constants/deploy-helpers';
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const core = Addresses.getCore() as CoreAddresses;

  await hardhatDeploy(
    hre,
    'RebalanceDebtConfig',
    true,
    undefined,
    undefined,
    [core.controller],
    true // if set it to true, will not attempt to deploy even if the contract deployed under the same name is different
  );
};
export default func;
func.tags = ['RebalanceDebtConfig'];
