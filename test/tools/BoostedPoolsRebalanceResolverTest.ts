// import { ethers, upgrades } from 'hardhat';
// import { BoostedPoolsRebalanceResolver, BoostedPoolsRebalanceResolver__factory } from '../../typechain';
// import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
// import { expect } from 'chai';
//
// const rebalancers = [
//   '0x47Ada091aB72627AF6a7EAd768aD2e39e085A342', // DAI
//   '0x9756549A334Bd48423457D057e8EDbFAf2104b16', // USDC
//   '0xf30d0756053734128849666E01a0a4C04A5603C6', // USDT
//   '0x65c574A3e3ceae1CB8c9d46d92aE4b32F3f33D3c', // stMATIC
//   '0xC9c3bA34aBd888C7Bb68EA1d2f5650965b543Fbc', // MATIC
// ]
//
// describe.skip('BoostedPoolsRebalanceResolverTest tests', function() {
//
//   const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
//   const USDC_BIG_HOLDER_ADDRESS = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245';
//   const TETU_BOOSTED_USDC_REBALANCER = '0x9756549a334bd48423457d057e8edbfaf2104b16';
//
//   const DEFAULT_AMOUNT = '1000';
//
//   async function deployContracts() {
//     const [signer, other] = await ethers.getSigners();
//
//     const BoostedPoolsRebalanceResolverFact = await ethers.getContractFactory('BoostedPoolsRebalanceResolver');
//     const resolver = await upgrades.deployProxy(
//       BoostedPoolsRebalanceResolverFact,
//       [rebalancers],
//     ) as BoostedPoolsRebalanceResolver;
//
//     const balRebalancer = await ethers.getContractAt('ILinearPoolRebalancer', TETU_BOOSTED_USDC_REBALANCER);
//     const poolAddress = await balRebalancer.getPool();
//     const pool = await ethers.getContractAt('IBalancerBoostedAaveStablePool', poolAddress);
//     const poolId = await pool.getPoolId();
//     const vault = await ethers.getContractAt('IBVault', await pool.getVault());
//
//
//     return { resolver, vault, poolId, signer };
//   }
//
//   describe('Smoke tests', function() {
//     it('Owner properly set', async function() {
//       const { resolver, signer } = await loadFixture(deployContracts);
//       expect(signer.address).is.eq(await resolver.owner());
//     });
//
//     it.skip('updateRebalancers test', async function() {
//       const { resolver, signer } = await loadFixture(deployContracts);
//       await resolver.updateRebalancers([TETU_BOOSTED_USDC_REBALANCER]);
//       const { canExec } = await resolver.checker();
//       expect(canExec).is.eq(true);
//     });
//
//     it.skip('execution test', async function() {
//       const { resolver, signer } = await loadFixture(deployContracts);
//
//
//       const data = await resolver.checker();
//
//       expect(data.canExec).eq(true);
//       const callData = BoostedPoolsRebalanceResolver__factory.createInterface()
//         .decodeFunctionData('rebalance', data.execPayload);
//
//       const balancerRebalancer = callData.balancerRebalancer;
//       const amount = callData.amount;
//       const extra = callData.extra;
//
//       console.log('balancerRebalancer', balancerRebalancer);
//       console.log('amount', amount.toString());
//       console.log('extra', extra);
//
//       await resolver.changeOperatorStatus(signer.address, true);
//       await resolver.rebalance(balancerRebalancer, amount, extra);
//     });
//
//   });
// });
