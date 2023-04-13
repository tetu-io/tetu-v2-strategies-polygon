import { ethers } from 'hardhat';


const DAI_LINEAR_POOL_REBALANCER_ADDRESS = "0x47ada091ab72627af6a7ead768ad2e39e085a342"
const USDC_LINEAR_POOL_REBALANCER_ADDRESS = "0x9756549a334bd48423457d057e8edbfaf2104b16"
const USDT_LINEAR_POOL_REBALANCER_ADDRESS = "0xf30d0756053734128849666e01a0a4c04a5603c6"
const BOOSTED_POOL_RESOLVER_ADDRESS = "0x1f11199C4440DDd419b1C6bc39C2c355aA31B942"
const REBALANCERS = [DAI_LINEAR_POOL_REBALANCER_ADDRESS, USDC_LINEAR_POOL_REBALANCER_ADDRESS, USDT_LINEAR_POOL_REBALANCER_ADDRESS]

async function main() {
  const signer = (await ethers.getSigners())[0]
  console.log(`signer address is ${signer.address}`)
  const boostedPoolResolver = await ethers.getContractAt("BoostedPoolsRebalanceResolver", BOOSTED_POOL_RESOLVER_ADDRESS)

  const tx = await boostedPoolResolver.updateRebalancers(REBALANCERS)

  console.log(`tx hash is ${tx.hash}`)
  await tx.wait();
  console.log("Done ")
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
