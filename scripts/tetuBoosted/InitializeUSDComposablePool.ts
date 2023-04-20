import { ethers } from 'hardhat';
import BalancerVaultABI from '../abis/BalancerVault.json';
import ComposableStablePoolABI from '../abis/ComposableStablePool.json';
import { BigNumber } from 'ethers';

const USDT_LINEAR_POOL_ADDRESS = "0x7c82A23B4C48D796dee36A9cA215b641C6a8709d"
const DAI_LINEAR_POOL_ADDRESS = "0xDa1CD1711743e57Dd57102E9e61b75f3587703da"
const USDC_LINEAR_POOL_ADDRESS = "0xae646817e458C0bE890b81e8d880206710E3c44e"

const BALANCER_VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8"
const USD_COMPOSABLE_POOL_ADDRESS = "0xb3d658d5b95BF04E2932370DD1FF976fe18dd66A"


async function main() {
  const signer = (await ethers.getSigners())[0]
  console.log(`signer address is ${signer.address}`)

  const bbtUSDC = await ethers.getContractAt("IERC20", USDC_LINEAR_POOL_ADDRESS)
  const bbtUSDCBalance = await bbtUSDC.balanceOf(signer.address)
  const bbtUSDT = await ethers.getContractAt("IERC20", USDT_LINEAR_POOL_ADDRESS)
  const bbtUSDTBalance = await bbtUSDT.balanceOf(signer.address)
  const bbtDAI = await ethers.getContractAt("IERC20", DAI_LINEAR_POOL_ADDRESS)
  const bbtDAIBalance = await bbtDAI.balanceOf(signer.address)
  const vault = new ethers.Contract(BALANCER_VAULT_ADDRESS, BalancerVaultABI, signer)

  const usdComposablePool = new ethers.Contract(USD_COMPOSABLE_POOL_ADDRESS, ComposableStablePoolABI, signer);

  const allTokens = [USDT_LINEAR_POOL_ADDRESS, USDC_LINEAR_POOL_ADDRESS, USD_COMPOSABLE_POOL_ADDRESS, DAI_LINEAR_POOL_ADDRESS];

  const currentBalances = [bbtUSDTBalance, bbtUSDCBalance, BigNumber.from(0), bbtDAIBalance];
  // not sure why we need to add "519229685853482762853049632900000000" for BPT token.
  // Copied from the boosted aave pool initialization
  const maxBalances = [bbtUSDTBalance, bbtUSDCBalance, BigNumber.from("519229685853482762853049632900000000"), bbtDAIBalance];
  console.log("Current balances", currentBalances);


  console.log("Approoving vault")
  await bbtUSDC.approve(BALANCER_VAULT_ADDRESS, bbtUSDCBalance)
  await bbtUSDT.approve(BALANCER_VAULT_ADDRESS, bbtUSDTBalance)
  await bbtDAI.approve(BALANCER_VAULT_ADDRESS, bbtDAIBalance)
  await usdComposablePool.approve(BALANCER_VAULT_ADDRESS, bbtDAIBalance)

  const JOIN_KIND_INIT = 0
  const initUserData = ethers.utils.defaultAbiCoder.encode(
    ["uint256", "uint256[]"],
    [JOIN_KIND_INIT, currentBalances]
  )
  const poolId = await usdComposablePool.getPoolId();
  console.log("Pool id", poolId)
  console.log("Join Init vault")
  const tx = await vault.joinPool(
    poolId,
    signer.address,
    signer.address,
    {
      assets: allTokens,
      maxAmountsIn: maxBalances,
      userData: initUserData,
      fromInternalBalance: false,
    })

  console.log("Joining pool", tx.hash);
  await tx.wait();
  console.log("Balance after joining", await usdComposablePool.balanceOf(signer.address));

  console.log("Done ")
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
