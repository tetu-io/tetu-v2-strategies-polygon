import {ethers} from "hardhat";
import {MaticAddresses} from "../MaticAddresses";
import {deployContract} from "./DeployContract";
// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");

async function main() {
  // WMATIC-USDC-0.05%
  const poolAddress = '0xA374094527e1673A86dE625aa59517c5dE346d32';

  const signer = (await ethers.getSigners())[0];
  // await deployContract(hre, signer, 'UniswapV3ResearchStrategy', poolAddress, 1200, 30, MaticAddresses.USDC_TOKEN)
  await deployContract(hre, signer, 'UniswapV3ResearchStrategy', poolAddress, 1200, 20, MaticAddresses.USDC_TOKEN)
  // await deployContract(hre, signer, 'UniswapV3ResearchStrategy', poolAddress, 400, 30, MaticAddresses.USDC_TOKEN)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
