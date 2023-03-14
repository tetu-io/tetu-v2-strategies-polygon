import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { ethers } from "hardhat"
import { Consts } from "../deploy_constants/constatants"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;
  const {deployer, DAI_ADDRESS} = await getNamedAccounts();
  const strategy = await deployments.get('tDaiStrategy');

  await deploy('tDai4626Strict', {
    contract: 'ERC4626Strict',
    from: deployer,
    args: [DAI_ADDRESS, "tDAI", "tDAI", strategy.address, Consts.STRICT_VAULT_BUFFER],
    log: true,
  });

  const erc4626 = await deployments.get('tDai4626Strict');
  const strategyContract = await ethers.getContractAt("TetuV1SingleTokenStrictStrategy", strategy.address)
  await strategyContract.init(erc4626.address)

};
export default func;
func.tags = ['tDai4626Strict']
