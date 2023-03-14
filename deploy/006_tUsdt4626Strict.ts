import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { ethers } from "hardhat"
import { Consts } from "../deploy_constants/constatants"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;
  const {deployer, USDT_ADDRESS} = await getNamedAccounts();
  const strategy = await deployments.get('tUsdtStrategy');

  await deploy('tUsdt4626Strict', {
    contract: 'ERC4626Strict',
    from: deployer,
    args: [USDT_ADDRESS, "tUSDT", "tUSDT", strategy.address, Consts.STRICT_VAULT_BUFFER],
    log: true,
  });

  const erc4626 = await deployments.get('tUsdt4626Strict');
  const strategyContract = await ethers.getContractAt("TetuV1SingleTokenStrictStrategy", strategy.address)
  await strategyContract.init(erc4626.address)


};
export default func;
func.tags = ['tUsdt4626Strict']
