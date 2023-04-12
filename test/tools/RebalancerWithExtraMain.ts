import { ethers } from 'hardhat'
import { RebalancerWithExtraMain } from '../../typechain'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'

describe('RebalancerWithExtraMain tests', function() {

  const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
  const USDC_BIG_HOLDER_ADDRESS = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245'
  const TETU_BOOSTED_USDC_REBALANCER = '0x9756549a334bd48423457d057e8edbfaf2104b16'

  const DEFAULT_AMOUNT = '1000'

  async function deployContracts() {
    const [signer] = await ethers.getSigners()

    const RebalancerWithExtraMainFact = await ethers.getContractFactory('RebalancerWithExtraMain')
    const rebalancer = await RebalancerWithExtraMainFact.deploy() as RebalancerWithExtraMain
    const balRebalancer = await ethers.getContractAt('ILinearPoolRebalancer', TETU_BOOSTED_USDC_REBALANCER);
    const poolAddress = await balRebalancer.getPool();
    const pool = await ethers.getContractAt("IBalancerBoostedAaveStablePool", poolAddress);
    const poolId = await pool.getPoolId();
    const vault = await ethers.getContractAt("IBVault", await pool.getVault());
    return { rebalancer, vault, poolId, signer }
  }

  describe('Smoke tests', function() {
    it('Owner properly set', async function() {
      const { rebalancer, signer } = await loadFixture(deployContracts)
      expect(signer.address).is.eq(await rebalancer.owner())
    })
  })

  describe('Rebalance tests', function() {
    it('Rebalance with no tokens in rebalancer', async function() {
      const { rebalancer } = await loadFixture(deployContracts)
      await expect(rebalancer.rebalanceWithExtraMain(TETU_BOOSTED_USDC_REBALANCER, DEFAULT_AMOUNT)).to.be.rejectedWith('Not enough tokens')
    })

    it('Rebalance with tokens in rebalancer', async function() {
      const { rebalancer,vault, poolId, signer } = await loadFixture(deployContracts)
      // transfer some USDC to signer
      const usdc = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol:IERC20', USDC_ADDRESS)
      const impersonatedSigner = await ethers.getImpersonatedSigner(USDC_BIG_HOLDER_ADDRESS)
      await usdc.connect(impersonatedSigner).transfer(signer.address, ethers.utils.parseUnits('1000000', 6))
      await usdc.connect(signer)

      // transfer some tokens to rebalancer
      await usdc.transfer(rebalancer.address, ethers.utils.parseUnits('10', 6))

      let tokenInfo = await vault.getPoolTokens(poolId)

      const expectedAmountAfterRebalance = BigNumber.from("25000000000");

      expect(tokenInfo.balances[2]).is.gt(expectedAmountAfterRebalance)

      await rebalancer.rebalanceWithExtraMain(TETU_BOOSTED_USDC_REBALANCER, DEFAULT_AMOUNT)

      tokenInfo = await vault.getPoolTokens(poolId)

      expect(tokenInfo.balances[2]).is.eq("25000000000")
    })

    it('Owner should be able to withdraw tokens', async function() {
      const { rebalancer,vault, poolId, signer } = await loadFixture(deployContracts)
      // transfer some USDC to signer
      const usdc = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol:IERC20', USDC_ADDRESS)
      const impersonatedSigner = await ethers.getImpersonatedSigner(USDC_BIG_HOLDER_ADDRESS)
      await usdc.connect(impersonatedSigner).transfer(signer.address, ethers.utils.parseUnits('1000000', 6))
      await usdc.connect(signer)
      const transferAmount = ethers.utils.parseUnits('10', 6)

      await usdc.transfer(rebalancer.address, transferAmount)
      expect(await usdc.balanceOf(rebalancer.address)).is.eq(transferAmount)
      await rebalancer.withdraw(USDC_ADDRESS, transferAmount)
      expect(await usdc.balanceOf(rebalancer.address)).is.eq(0)

    })
  })
})