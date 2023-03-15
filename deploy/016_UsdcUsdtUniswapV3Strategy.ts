import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from "hardhat";
import {
  ProxyControlled,
  UniswapV3ConverterStrategy
} from "../typechain";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre
  const {deployer, CONVERTER_ADDRESS, UNISWAPV3_USDC_USDT_100, SPLITTER_USDC_ADDRESS} = await getNamedAccounts()

  const core = Addresses.getCore() as CoreAddresses

  const strategyImplDeployment = await deployments.get('UniswapV3ConverterStrategy')
  const proxyDeployResult = await deployments.deploy('UsdcUsdtUniswapV3Strategy', {
    contract: '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    from: deployer,
    log: true,
  });
  const proxyContract = await ethers.getContractAt("@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled", proxyDeployResult.address) as ProxyControlled
  await proxyContract.initProxy(strategyImplDeployment.address)
  const strategyContract = await ethers.getContractAt("UniswapV3ConverterStrategy", proxyDeployResult.address) as UniswapV3ConverterStrategy

  await strategyContract.init(
    core.controller,
    SPLITTER_USDC_ADDRESS,
    CONVERTER_ADDRESS,
    UNISWAPV3_USDC_USDT_100,
    0,
    0
  )
}
export default func;
func.tags = ['UsdcUsdtUniswapV3Strategy']
func.dependencies = ['UniswapV3ConverterStrategy']
