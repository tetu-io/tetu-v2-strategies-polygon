/* tslint:disable:no-trailing-whitespace */
// tslint:disable-next-line:ban-ts-ignore
// @ts-ignore
import hre, {ethers, run} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {
  ControllerV2__factory,
  ProxyControlled__factory,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory
} from "../../typechain";
import {DeployerUtilsLocal} from "../utils/DeployerUtilsLocal";
import {UniswapV3StrategyUtils} from "../../test/UniswapV3StrategyUtils";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId
  if (chainId !== 137) {
    console.error(`Incorrect hardhat chainId ${chainId}. Need 137.`)
    process.exit(-1)
  }

  await hre.network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
          blockNumber: undefined,
        },
      },
    ],
  });

  const signer = (await ethers.getSigners())[0];

  // upgrade UniswapV3Strategy
  const proxyAddress = '0x05C7D307632a36D31D7eECbE4cC5Aa46D15fA752'
  const proxy = ProxyControlled__factory.connect(proxyAddress, signer)
  let strategy = UniswapV3ConverterStrategy__factory.connect(proxyAddress, signer)
  console.log('Strategy proxy address', proxyAddress)
  const controllerAddress = await strategy.controller()
  const controllerAsSigner = await DeployerUtilsLocal.impersonate(controllerAddress)
  console.log('Current strategy version', await strategy.STRATEGY_VERSION())

  const newImplementation = await DeployerUtils.deployContract(signer, 'UniswapV3ConverterStrategy') as UniswapV3ConverterStrategy

  await proxy.connect(controllerAsSigner).upgrade(newImplementation.address)
  strategy = UniswapV3ConverterStrategy__factory.connect(proxyAddress, signer)
  console.log('New strategy version', await strategy.STRATEGY_VERSION())
  console.log(`Strategy totalAssets: ${formatUnits(await strategy.totalAssets(), 6)} USDC`)

  // prepare to rebalance
  console.log('Swap..')
  await UniswapV3StrategyUtils.movePriceUp(signer, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('300000', 6));

  const needRebalance = await strategy.needRebalance()
  if (!needRebalance) {
    console.log('Not need rebalance. Increase swap amount.')
    process.exit(-1)
  }

  // signer must be operator for rebalancing
  const controllerV2 = ControllerV2__factory.connect(controllerAddress, signer)
  const governanceAsSigner = await DeployerUtilsLocal.impersonate(await controllerV2.governance())
  await controllerV2.connect(governanceAsSigner).registerOperator(signer.address)

  // start localhost hardhat node
  await run("node", {'noDeploy': true});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
