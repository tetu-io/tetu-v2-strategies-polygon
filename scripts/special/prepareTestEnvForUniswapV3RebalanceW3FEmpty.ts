/* tslint:disable:no-trailing-whitespace */
// tslint:disable-next-line:ban-ts-ignore
// @ts-ignore
import hre, {ethers, run} from "hardhat";
import {
  ControllerV2__factory,
  UniswapV3ConverterStrategy__factory
} from "../../typechain";
import {DeployerUtilsLocal} from "../utils/DeployerUtilsLocal";
import {formatUnits} from "ethers/lib/utils";
import { Misc } from '../utils/Misc';
import { reset } from '@nomicfoundation/hardhat-network-helpers';
import { EnvSetup } from '../utils/EnvSetup';

async function main() {
  const chainId = Misc.getChainId()
  if (chainId !== 137) {
    console.error(`Incorrect hardhat chainId ${chainId}. Need 137.`)
    process.exit(-1)
  }
  await reset(EnvSetup.getEnv().maticRpcUrl, 44905000)

  const signer = (await ethers.getSigners())[0];

  const strategy = UniswapV3ConverterStrategy__factory.connect('0x29ce0ca8d0A625Ebe1d0A2F94a2aC9Cc0f9948F1', signer)
  console.log(`Strategy totalAssets: ${formatUnits(await strategy.totalAssets(), 6)} USDC`)

  const needRebalance = await strategy.needRebalance()
  if (!needRebalance) {
    console.log('Not need rebalance.')
    process.exit(-1)
  }

  // signer must be operator for rebalancing
  const controllerV2 = ControllerV2__factory.connect(await strategy.controller(), signer)
  const governanceAsSigner = await DeployerUtilsLocal.impersonate(await controllerV2.governance())
  await controllerV2.connect(governanceAsSigner).registerOperator(signer.address)

  // start localhost hardhat node
  await run("node", {'noDeploy': true});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
