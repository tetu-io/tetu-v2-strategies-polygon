import { ethers } from "hardhat"
import LinearPoolABI from "../abis/LinearPool.json"
import LinearPoolRebalancerABI from "../abis/LinearPoolRebalancer.json"

const USDC_LINEAR_POOL_ADDRESS = "0xae646817e458C0bE890b81e8d880206710E3c44e"
const USDC_LINEAR_POOL_REBALANCER_ADDRESS = "0x9756549A334Bd48423457D057e8EDbFAf2104b16"


async function main() {
  const signer = (await ethers.getSigners())[0]
  console.log(`signer address is ${signer.address}`)
  const usdcLinerPool = new ethers.Contract(USDC_LINEAR_POOL_ADDRESS, LinearPoolABI, signer)
  const usdcRebalancer = new ethers.Contract(USDC_LINEAR_POOL_REBALANCER_ADDRESS, LinearPoolRebalancerABI, signer)
  const tx = await usdcRebalancer.rebalance(signer.address)
  console.log(`tx hash is ${tx.hash}`)
  tx.wait();
  console.log("Done ")
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
