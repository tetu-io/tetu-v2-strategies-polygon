import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from "hardhat";
import {
  ControllerV2,
  ProxyControlled, TetuVaultV2,
  UniswapV3ConverterStrategy,
  VaultFactory
} from "../typechain";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre
  const {deployer, USDC_ADDRESS, CONVERTER_ADDRESS, UNISWAPV3_USDC_USDT_100} = await getNamedAccounts()
  if (await hre.getChainId() !== '137') {
    console.error('Only matic or matic forking supported')
    return
  }

  const core = Addresses.getCore() as CoreAddresses

  const vaultName = 'TETUV2_USDC_USDT_UNISWAPV3'
  const symbol = 'X_USDC_USDT_UNISWAPV3'
  const vaultBuffer = 100

  const controllerContract = await ethers.getContractAt("ControllerV2", core.controller) as ControllerV2
  if (!await controllerContract.isOperator(deployer)) {
    if(hre.network.name === "hardhat") {
      const govSigner = await ethers.getImpersonatedSigner(await controllerContract.governance())
      await controllerContract.connect(govSigner).registerOperator(deployer)
    } else {
      console.error('Deployer is not operator. Only operators can create vaults.')
      return
    }
  }

  const factoryContract = await ethers.getContractAt("VaultFactory", core.vaultFactory) as VaultFactory
  await factoryContract.createVault(
    USDC_ADDRESS,
    vaultName,
    symbol,
    core.gauge,
    vaultBuffer
  )
  const vaultIndex = (await factoryContract.deployedVaultsLength()).toNumber() - 1
  const vaultAddress = await factoryContract.deployedVaults(vaultIndex)
  console.log('Vault address:', vaultAddress)
  const vaultContract = await ethers.getContractAt("TetuVaultV2", vaultAddress) as TetuVaultV2
  await controllerContract.registerVault(vaultAddress)
  const splitterAddress = await vaultContract.splitter()
  console.log('Splitter address:', splitterAddress)

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
    splitterAddress,
    CONVERTER_ADDRESS,
    UNISWAPV3_USDC_USDT_100,
    0,
    0
  )
}
export default func;
func.tags = ['UsdcUsdtUniswapV3Strategy']
func.dependencies = ['UniswapV3ConverterStrategy']
