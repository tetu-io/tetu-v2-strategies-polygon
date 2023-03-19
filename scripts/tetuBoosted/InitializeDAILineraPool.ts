import { ethers } from 'hardhat';
import LinearPoolABI from '../abis/LinearPool.json';
import BalancerVaultABI from '../abis/BalancerVault.json';

const DAI_ADDRESS = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';
const DAI_LINEAR_POOL_ADDRESS = '0xDa1CD1711743e57Dd57102E9e61b75f3587703da';
const DAI_4626_ADDRESS = '0xacE2aC58E1E5A7BFE274916c4d82914D490Ed4a5';

const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

async function main() {
  const signer = (await ethers.getSigners())[0];
  console.log(`signer address is ${signer.address}`);

  const dai = await ethers.getContractAt('IERC20', DAI_ADDRESS);
  console.log(`signer DAI balance is ${await dai.balanceOf(signer.address)}`);
  const vault = new ethers.Contract(BALANCER_VAULT_ADDRESS, BalancerVaultABI, signer);

  await dai.approve(vault.address, ethers.utils.parseUnits('100', 18));

  const tDAIPool = await ethers.getContractAt('ERC4626Strict', DAI_4626_ADDRESS);
  await dai.approve(tDAIPool.address, ethers.utils.parseUnits('100', 18));
  await tDAIPool.deposit(ethers.utils.parseUnits('5', 18), signer.address);
  console.log(`tDAI4626Strict balance is ${await tDAIPool.balanceOf(signer.address)}`);
  await tDAIPool.approve(vault.address, ethers.utils.parseUnits('100', 18));

  const daiLinerPool = new ethers.Contract(DAI_LINEAR_POOL_ADDRESS, LinearPoolABI, signer);
  console.log('swap 1 (DAI -> bb-t-DAI) join pool');
  await vault.swap(
    {
      poolId: await daiLinerPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: DAI_ADDRESS,
      assetOut: DAI_LINEAR_POOL_ADDRESS,
      userData: '0x',
      amount: ethers.utils.parseUnits('5', 18),
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

  console.log(`Signer BPT balance: ${await daiLinerPool.balanceOf(signer.address)}`);
  console.log(`Signer USDC balance: ${await dai.balanceOf(signer.address)}`);
  console.log('swap 2 (tUSDC -> bb-t-USDC) join pool');
  await vault.swap(
    {
      poolId: await daiLinerPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: tDAIPool.address,
      assetOut: DAI_LINEAR_POOL_ADDRESS,
      userData: '0x',
      amount: ethers.utils.parseUnits('5', 18),
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

  console.log(`Signer BPT balance: ${await daiLinerPool.balanceOf(signer.address)}`);
  console.log(`Signer USDC balance: ${await dai.balanceOf(signer.address)}`);

  console.log(`Signer BPT balance: ${await daiLinerPool.balanceOf(signer.address)}`);
  console.log(`Signer USDC balance: ${await dai.balanceOf(signer.address)}`);

  const poolTokens = await vault.getPoolTokens(await daiLinerPool.getPoolId());
  const t0 = await ethers.getContractAt('IERC20Metadata', poolTokens.tokens[0]);
  const t1 = await ethers.getContractAt('IERC20Metadata', poolTokens.tokens[1]);
  const t2 = await ethers.getContractAt('IERC20Metadata', poolTokens.tokens[2]);
  console.log(`t0: ${await t0.symbol()}`);
  console.log(`t1: ${await t1.symbol()}`);
  console.log(`t2: ${await t2.symbol()}`);

  const poolId = await daiLinerPool.getPoolId();
  console.log(`pool tokens: ${poolTokens} `);
  console.log(`pool info t0: ${await vault.getPoolTokenInfo(poolId, t0.address)} `);
  console.log(`pool info t1: ${await vault.getPoolTokenInfo(poolId, t1.address)} `);
  console.log(`pool info t2: ${await vault.getPoolTokenInfo(poolId, t2.address)} `);

  console.log('Done ');
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
