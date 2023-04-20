import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction, DeploymentSubmission } from 'hardhat-deploy/types';
import { Consts } from '../deploy_constants/constatants';
import { ethers } from 'hardhat';
import ComposableStablePoolFactoryABI from '../scripts/abis/ComposableStablePoolFactory.json';
import ComposableStablePoolABI from '../scripts/abis/ComposableStablePool.json';
import LinearPoolABI from '../scripts/abis/LinearPool.json';
import BalancerVaultABI from '../scripts/abis/BalancerVault.json';
import { isContractExist } from '../deploy_constants/deploy-helpers';

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { COMPOSABLE_STABLE_POOL_FACTORY_ADDRESS } = await getNamedAccounts();

  if (await isContractExist(hre, 'bbTUsdComposablePool')) {
    return;
  }

  const usdcLinearPool = await deployments.get('bbTUsdc4626LinearPool');
  const daiLinearPool = await deployments.get('bbTDai4626LinearPool');
  const usdtLinearPool = await deployments.get('bbTUsdt4626LinearPool');
  const tUsdcStrategy = await deployments.get('tUsdcStrategy');
  const tDaiStrategy = await deployments.get('tDaiStrategy');
  const tUsdtStrategy = await deployments.get('tUsdtStrategy');

  const poolData = [
    { pool: usdcLinearPool.address, strategy: tUsdcStrategy.address },
    { pool: daiLinearPool.address, strategy: tDaiStrategy.address },
    { pool: usdtLinearPool.address, strategy: tUsdtStrategy.address },
  ];

  poolData.sort((a, b) => a.pool.localeCompare(b.pool));

  const usdPoolParams = [
    'Balancer Tetu Boosted StablePool',
    'bb-t-USD',
    poolData.map(p => p.pool),
    '2000', // amplificationParameter
    poolData.map(p => p.strategy), // strategy implements IRatesProvider interface
    ['21600', '21600', '21600'], // tokenRateCacheDurations
    [false, false, false], // exemptFromYieldProtocolFeeFlags
    '100000000000000', // swapFeePercentage
    Consts.BAL_DELEGATED_OWNER_ADDRESS,
  ];

  const signer = (await ethers.getSigners())[0];
  const factory = new ethers.Contract(COMPOSABLE_STABLE_POOL_FACTORY_ADDRESS, ComposableStablePoolFactoryABI, signer);
  const tx = await factory.create(...usdPoolParams);
  const receipt = await tx.wait();

  // tslint:disable-next-line:no-any
  const poolAddress = receipt.events?.find((e: any) => e.event === 'PoolCreated')?.args?.pool;
  console.log('bb-t-USD PoolAddress:', poolAddress);

  const deploymentSubmission: DeploymentSubmission = {
    abi: ComposableStablePoolABI,
    address: poolAddress,
  };
  await deployments.save('bbTUsdComposablePool', deploymentSubmission);
  if (hre.network.name === 'hardhat') {
    console.log('=== TESTS ===');
    const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
    const USDC_BIG_HOLDER_ADDRESS = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245';
    const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

    const usdc = await ethers.getContractAt(
      '@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol:IERC20',
      USDC_ADDRESS,
    );
    const impersonatedSigner = await ethers.getImpersonatedSigner(USDC_BIG_HOLDER_ADDRESS);
    await usdc.connect(impersonatedSigner).transfer(signer.address, ethers.utils.parseUnits('1000000', 6));
    await usdc.connect(signer);
    console.log(`signer USDC balance is ${await usdc.balanceOf(signer.address)}`);
    const vault = new ethers.Contract(BALANCER_VAULT_ADDRESS, BalancerVaultABI, signer);
    await usdc.approve(vault.address, ethers.utils.parseUnits('1000000', 6));

    // whitelist strategy
    const TETU_V1_CONTROLLER_ADDRESS = '0x6678814c273d5088114B6E40cC49C8DB04F9bC29';
    const controller = await ethers.getContractAt('ITetuV1Controller', TETU_V1_CONTROLLER_ADDRESS);
    await signer.sendTransaction({ to: await controller.governance(), value: ethers.utils.parseEther('10') });
    const impersonatedGovernance = await ethers.getImpersonatedSigner(await controller.governance());
    await controller.connect(impersonatedGovernance).changeWhiteListStatus([tUsdcStrategy.address], true);

    const tUsdc = await deployments.get('tUsdc4626Strict');
    const tUsdPool = await ethers.getContractAt('ERC4626Strict', tUsdc.address);
    await usdc.approve(tUsdPool.address, ethers.utils.parseUnits('1000000', 6));
    await tUsdPool.deposit(ethers.utils.parseUnits('1000', 6), signer.address);
    console.log(`tUsdc4626Strict balance is ${await tUsdPool.balanceOf(signer.address)}`);
    await tUsdPool.approve(vault.address, ethers.utils.parseUnits('1000000', 18));


    const usdcLinerPool = new ethers.Contract(usdcLinearPool.address, LinearPoolABI, signer);
    console.log('swap 1 (USDC -> bb-t-USDC) join pool');
    await vault.swap(
      {
        poolId: await usdcLinerPool.getPoolId(),
        kind: 0, // GIVEN_IN
        assetIn: USDC_ADDRESS,
        assetOut: usdcLinearPool.address,
        userData: '0x',
        amount: ethers.utils.parseUnits('100', 6),
      },
      {
        sender: signer.address,
        fromInternalBalance: false,
        toInternalBalance: false,
        recipient: signer.address,
      },
      1,
      Date.now() + 1000,
    );

    console.log(`Signer BPT balance: ${await usdcLinerPool.balanceOf(signer.address)}`);
    console.log(`Signer USDC balance: ${await usdc.balanceOf(signer.address)}`);

    console.log('swap 2 (tUSDC -> bb-t-USDC) join pool');
    await vault.swap(
      {
        poolId: await usdcLinerPool.getPoolId(),
        kind: 0, // GIVEN_IN
        assetIn: tUsdPool.address,
        assetOut: usdcLinearPool.address,
        userData: '0x',
        amount: ethers.utils.parseUnits('100', 6),
      },
      {
        sender: signer.address,
        fromInternalBalance: false,
        toInternalBalance: false,
        recipient: signer.address,
      },
      1,
      Date.now() + 1000,
    );

    console.log(`Signer BPT balance: ${await usdcLinerPool.balanceOf(signer.address)}`);
    console.log(`Signer USDC balance: ${await usdc.balanceOf(signer.address)}`);

    console.log('swap 3 (USDC -> tUSDC)');
    await vault.swap(
      {
        poolId: await usdcLinerPool.getPoolId(),
        kind: 0, // GIVEN_IN
        assetIn: tUsdPool.address,
        assetOut: USDC_ADDRESS,
        userData: '0x',
        amount: ethers.utils.parseUnits('10', 6),
      },
      {
        sender: signer.address,
        fromInternalBalance: false,
        toInternalBalance: false,
        recipient: signer.address,
      },
      1,
      Date.now() + 1000,
    );

    console.log(`Signer BPT balance: ${await usdcLinerPool.balanceOf(signer.address)}`);
    console.log(`Signer USDC balance: ${await usdc.balanceOf(signer.address)}`);

    const poolTokens = await vault.getPoolTokens(await usdcLinerPool.getPoolId());
    const t0 = await ethers.getContractAt(
      '@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol:IERC20Metadata',
      poolTokens.tokens[0],
    );
    const t1 = await ethers.getContractAt(
      '@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol:IERC20Metadata',
      poolTokens.tokens[1],
    );
    const t2 = await ethers.getContractAt(
      '@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol:IERC20Metadata',
      poolTokens.tokens[2],
    );
    console.log(`t0: ${await t0.symbol()}`);
    console.log(`t1: ${await t1.symbol()}`);
    console.log(`t2: ${await t2.symbol()}`);

    const poolId = await usdcLinerPool.getPoolId();
    console.log(`pool tokens: ${poolTokens} `);
    console.log(`pool info t0: ${await vault.getPoolTokenInfo(poolId, t0.address)} `);
    console.log(`pool info t1: ${await vault.getPoolTokenInfo(poolId, t1.address)} `);
    console.log(`pool info t2: ${await vault.getPoolTokenInfo(poolId, t2.address)} `);
  }
};
export default func;
func.tags = ['bbTUsdComposablePool'];
