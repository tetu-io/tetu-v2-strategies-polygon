import { ethers } from "hardhat";
import LinearPoolABI from "../abis/LinearPool.json"
import { MaticAddresses } from "../addresses/MaticAddresses"
import { ERC4626Strict, TetuV1SingleTokenStrictStrategy } from "../../typechain"

const ERC4626LinearPoolFactoryAddress = "0xa3B9515A9c557455BC53F7a535A85219b59e8B2E";

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
const X_TETU_ADDRESS = "0x225084D30cc297F3b177d9f93f5C3Ab8fb6a1454"
const X_USDC_VAULT_ADDRESS = "0xeE3B4Ce32A6229ae15903CDa0A5Da92E739685f7"
const LIQUIDATOR_ADDRESS = "0xC737eaB847Ae6A92028862fE38b828db41314772"
const USDC_BIG_HOLDER_ADDRESS = "0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245"
const USDC_LINEAR_POOL_ADDRESS = "0xe1Fb90D0d3b47E551d494d7eBe8f209753526B01"

async function main() {
  const signer = (await ethers.getSigners())[0];
  console.log(`signer address is ${signer.address}`);

  // transfer some USDC to owner
  const usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS)
  const impersonatedSigner = await ethers.getImpersonatedSigner(USDC_BIG_HOLDER_ADDRESS)
  await usdc.connect(impersonatedSigner).transfer(signer.address, ethers.utils.parseUnits("1000000", 6))
  await usdc.connect(signer)
  console.log(`signer USDC balance is ${await usdc.balanceOf(signer.address)}`)
  const usdcLinearPool = new ethers.Contract(USDC_LINEAR_POOL_ADDRESS, LinearPoolABI, signer);
  console.log(`signer USDC Linear Pool balance is ${await usdcLinearPool.balanceOf(signer.address)}`)
  // const usdcLinearPool = await ethers.getContractAt("IERC20", USDC_LINEAR_POOL_ADDRESS)


  console.log("Done ")
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
