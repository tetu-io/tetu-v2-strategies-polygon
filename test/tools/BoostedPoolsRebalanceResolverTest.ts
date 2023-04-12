import { ethers, upgrades } from 'hardhat'
import { BoostedPoolsRebalanceResolver } from '../../typechain'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'

describe('BoostedPoolsRebalanceResolverTest tests', function() {

  const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
  const USDC_BIG_HOLDER_ADDRESS = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245'
  const TETU_BOOSTED_USDC_REBALANCER = '0x9756549a334bd48423457d057e8edbfaf2104b16'

  const DEFAULT_AMOUNT = '1000'

  async function deployContracts() {
    const [signer, other] = await ethers.getSigners()

    const BoostedPoolsRebalanceResolverFact = await ethers.getContractFactory('BoostedPoolsRebalanceResolver')
    const resolver = await upgrades.deployProxy(BoostedPoolsRebalanceResolverFact, [other.address, "300"]) as BoostedPoolsRebalanceResolver;

    const balRebalancer = await ethers.getContractAt('ILinearPoolRebalancer', TETU_BOOSTED_USDC_REBALANCER);
    const poolAddress = await balRebalancer.getPool();
    const pool = await ethers.getContractAt("IBalancerBoostedAaveStablePool", poolAddress);
    const poolId = await pool.getPoolId();
    const vault = await ethers.getContractAt("IBVault", await pool.getVault());


    return { resolver, vault, poolId, signer }
  }

  describe('Smoke tests', function() {
    it('Owner properly set', async function() {
      const { resolver, signer } = await loadFixture(deployContracts)
      expect(signer.address).is.eq(await resolver.owner())
    })

    it('Checker smoke test', async function() {
      const { resolver, signer } = await loadFixture(deployContracts)
      await resolver.updateRebalancers([TETU_BOOSTED_USDC_REBALANCER])
      const {canExec} = await resolver.checker()
      expect(canExec).is.eq(true)
    })

  })
})