import { ethers } from 'hardhat'
import { IBalancerBoostedAavePool, IBVault, ILendingPool, IStMATIC } from '../../../typechain'


async function main() {

  const WMATIC_ADDRESS = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
  const ST_MATIC_ADDRESS = '0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4'

  const WMATIC_BIG_HOLDER_ADDRESS = '0xfffbcd322ceace527c8ec6da8de2461c6d9d4e6e'
  const ST_MATIC_BIG_HOLDER_ADDRESS = '0x8915814e90022093099854babd3ea9ac67d25565'

  const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
  const WMATIC_LINEAR_POOL_ADDRESS = '0x52Cc8389C6B93d740325729Cc7c958066CEE4262'

  const T_ST_MATIC_LINEAR_POOL_ADDRESS = '0x4739E50B59B552D490d3FDc60D200977A38510c0'
  const BB_T_MATIC_ADDRESS = '0x71BD10C2a590b5858f5576550c163976A48Af906'
  const REF_MATIC_POOL_ADDRESS = '0x8159462d255C1D24915CB51ec361F700174cD994'

  const AAVE_LENDING_POOL_ADDRESS = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'

  const wmaticLinearPool = await ethers.getContractAt('IBalancerBoostedAavePool', WMATIC_LINEAR_POOL_ADDRESS)
  const stMaticLinearPool = await ethers.getContractAt('IBalancerBoostedAavePool', T_ST_MATIC_LINEAR_POOL_ADDRESS)
  const bbtMaticPool = await ethers.getContractAt('IBalancerBoostedAavePool', BB_T_MATIC_ADDRESS) as IBalancerBoostedAavePool
  const refMaticPool = await ethers.getContractAt('IBalancerBoostedAavePool', REF_MATIC_POOL_ADDRESS) as IBalancerBoostedAavePool

  const signer = (await ethers.getSigners())[0]
  const stMatic = await ethers.getContractAt('@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol:IERC20', ST_MATIC_ADDRESS)

  console.log('=== TESTS ===')

  console.log("Wrap matic")

  const wmatic = await ethers.getContractAt('IWmatic', WMATIC_ADDRESS)
  await wmatic.deposit({value: ethers.utils.parseUnits("1000000000")})
  // console.log(await wmatic.balanceOf(signer.address))


  let impersonatedSigner = await ethers.getImpersonatedSigner(ST_MATIC_BIG_HOLDER_ADDRESS)
  await stMatic.connect(impersonatedSigner).transfer(signer.address, ethers.utils.parseUnits('10000'))
  await stMatic.connect(signer)


  const vault = await ethers.getContractAt('IBVault', BALANCER_VAULT_ADDRESS) as IBVault;
  await wmatic.approve(vault.address, ethers.utils.parseUnits('100000000000'))
  await stMatic.approve(vault.address, ethers.utils.parseUnits('100000000000'))

  console.log('Measure swaps at the reference pool')
  console.log("Pool params")

  const { tokens, balances } = await vault.getPoolTokens(await refMaticPool.getPoolId())
  console.log("ref Pool stored rate: ", (await refMaticPool.getRate()).toString());
  // console.log(tokens)
  console.log(`Wmatic reserve: ${balances[0]}`)
  console.log(`stMatic reserve: ${balances[1]}`)

  console.log("==============================");
  console.log('stMATIC to WMATIC')
  console.log("==============================");

  let maticBalanceBefore = await wmatic.balanceOf(signer.address);
  let stMaticBalanceBefore = await stMatic.balanceOf(signer.address);
  await vault.swap(
    {
      poolId: await refMaticPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: stMatic.address,
      assetOut: wmatic.address,
      userData: '0x',
      amount: ethers.utils.parseUnits('10')
    },
    {
      sender: signer.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: signer.address
    },
    1,
    Date.now() + 1000
  )
  let maticBalanceAfter = await wmatic.balanceOf(signer.address);
  let stMaticBalanceAfter = await stMatic.balanceOf(signer.address);
  const wmaticReceivedRef = maticBalanceAfter - maticBalanceBefore;

  console.log(`stMatic Swapped: ${stMaticBalanceAfter - stMaticBalanceBefore}`)
  console.log(`Matic received: ${wmaticReceivedRef}`)
  console.log(`Rate: ${(maticBalanceAfter - maticBalanceBefore)/(stMaticBalanceAfter - stMaticBalanceBefore)}`)

  console.log("==============================");
  console.log('WMATIC to stMATIC')
  console.log("==============================");

  maticBalanceBefore = await wmatic.balanceOf(signer.address);
  stMaticBalanceBefore = await stMatic.balanceOf(signer.address);
  await vault.swap(
    {
      poolId: await refMaticPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: wmatic.address,
      assetOut: stMatic.address,
      userData: '0x',
      amount: ethers.utils.parseUnits('10')
    },
    {
      sender: signer.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: signer.address
    },
    1,
    Date.now() + 1000
  )
  maticBalanceAfter = await wmatic.balanceOf(signer.address);
  stMaticBalanceAfter = await stMatic.balanceOf(signer.address);
  const stMaticReceived = stMaticBalanceAfter - stMaticBalanceBefore;
  console.log(`wmatic Swapped: ${maticBalanceAfter - maticBalanceBefore}`)
  console.log(`stMatic received: ${stMaticReceived}`)
  console.log(`Rate: ${(stMaticBalanceAfter - stMaticBalanceBefore)/(maticBalanceAfter - maticBalanceBefore)}`)

  console.log("==============================");
  console.log('Tetu pool simulation')
  console.log("==============================");
  console.log('>> swap 50kk wmatic at refPool to get stMatic')
  await vault.swap(
    {
      poolId: await refMaticPool.getPoolId(),
      kind: 0, // GIVEN_IN
      assetIn: wmatic.address,
      assetOut: stMatic.address,
      userData: '0x',
      amount: ethers.utils.parseUnits('200000000')
    },
    {
      sender: signer.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: signer.address
    },
    1,
    Date.now() + 1000
  )

  console.log(`stMatic balance ${await stMatic.balanceOf(signer.address)}`)

  const initAmountMatic = '25501939510672673805794939'
  const initAmountStMatic = '24316230152793510797266513'

  await vault.batchSwap(
     0, // GIVEN_IN
    [
        {
          poolId: await wmaticLinearPool.getPoolId(),
          assetInIndex: 0, // WMATIC
          assetOutIndex: 1, // tWMATIC
          amount: initAmountMatic,
          userData: '0x'
        },
        {
          poolId: await bbtMaticPool.getPoolId(),
          assetInIndex: 1, // tWMATIC
          assetOutIndex: 4, // bbtMatic
          amount: 0,
          userData: '0x'
        },
        {
          poolId: await stMaticLinearPool.getPoolId(),
          assetInIndex: 3, // STMATIC
          assetOutIndex: 2, // tSTMATIC
          amount: initAmountStMatic,
          userData: '0x'
        },
        {
          poolId: await bbtMaticPool.getPoolId(),
          assetInIndex: 2, // tSTMATIC
          assetOutIndex: 4, // bbtMatic
          amount: 0,
          userData: '0x'
        },
      ],
      [wmatic.address, wmaticLinearPool.address, stMaticLinearPool.address, stMatic.address, bbtMaticPool.address],
      {
        sender: signer.address,
        fromInternalBalance: false,
        recipient: signer.address,
        toInternalBalance: false
      },
      [ethers.utils.parseUnits('1000000000'), ethers.utils.parseUnits('1000000000'), ethers.utils.parseUnits('1000000000'), ethers.utils.parseUnits('1000000000'), ethers.utils.parseUnits('1000000000')],
      Date.now() + 1000
  )

  const { tokens1, balances1 } = await vault.getPoolTokens(await bbtMaticPool.getPoolId())
  console.log("tetu Pool stored rate: ", (await bbtMaticPool.getRate()).toString());
  // console.log(tokens1)
  // console.log(`Wmatic reserve: ${balances[0]}`)
  // console.log(`stMatic reserve: ${balances[0]}`)


  console.log("==============================");
  console.log('WMATIC to stMATIC')
  console.log("==============================");

  maticBalanceBefore = await wmatic.balanceOf(signer.address);
  stMaticBalanceBefore = await stMatic.balanceOf(signer.address);

  await vault.batchSwap(
     0, // GIVEN_IN
    [
        {
          poolId: await wmaticLinearPool.getPoolId(),
          assetInIndex: 0, // WMATIC
          assetOutIndex: 1, // tWMATIC
          amount: ethers.utils.parseUnits('10'),
          userData: '0x'
        },
        {
          poolId: await bbtMaticPool.getPoolId(),
          assetInIndex: 1, // tWMATIC
          assetOutIndex: 2, // tSTMATIC
          amount: 0,
          userData: '0x'
        },
        {
          poolId: await stMaticLinearPool.getPoolId(),
          assetInIndex: 2, // tSTMATIC
          assetOutIndex: 3, // STMATIC
          amount: 0,
          userData: '0x'
        }
      ],
      [wmatic.address, wmaticLinearPool.address, stMaticLinearPool.address, stMatic.address],
      {
        sender: signer.address,
        fromInternalBalance: false,
        recipient: signer.address,
        toInternalBalance: false
      },
      [ethers.utils.parseUnits('1000000000'), ethers.utils.parseUnits('1000000000'), ethers.utils.parseUnits('1000000000'), ethers.utils.parseUnits('1000000000')],
      Date.now() + 1000
  )

  maticBalanceAfter = await wmatic.balanceOf(signer.address);
  stMaticBalanceAfter = await stMatic.balanceOf(signer.address);
  const stMaticReceivedTetu = stMaticBalanceAfter - stMaticBalanceBefore;
  console.log(`wmatic Swapped: ${maticBalanceAfter - maticBalanceBefore}`)
  console.log(`stMatic received: ${stMaticReceivedTetu}`)
  console.log(`Rate: ${(stMaticBalanceAfter - stMaticBalanceBefore)/(maticBalanceAfter - maticBalanceBefore)}`)

  console.log("==============================");
  console.log("stMatic results")
  console.log("==============================");
  console.log("ref pool reseived", stMaticReceived.toString());
  console.log("tetu pool reseived", stMaticReceivedTetu.toString());
  console.log("difference", stMaticReceivedTetu - stMaticReceived);


  impersonatedSigner = await ethers.getImpersonatedSigner(ST_MATIC_BIG_HOLDER_ADDRESS)
  await stMatic.connect(impersonatedSigner).transfer(signer.address, ethers.utils.parseUnits('100'))
  await stMatic.connect(signer)

  console.log("==============================");
  console.log('stMATIC to WMATIC')
  console.log("==============================");

  maticBalanceBefore = await wmatic.balanceOf(signer.address);
  stMaticBalanceBefore = await stMatic.balanceOf(signer.address);

  await vault.batchSwap(
     0, // GIVEN_IN
    [
        {
          poolId: await stMaticLinearPool.getPoolId(),
          assetInIndex: 3, // STMATIC
          assetOutIndex: 2, // tSTMATIC
          amount: ethers.utils.parseUnits('10'),
          userData: '0x'
        },
        {
          poolId: await bbtMaticPool.getPoolId(),
          assetInIndex: 2, // tSTMATIC
          assetOutIndex: 1, // tWMATIC
          amount: 0,
          userData: '0x'
        },
        {
          poolId: await wmaticLinearPool.getPoolId(),
          assetInIndex: 1, // tWMATIC
          assetOutIndex: 0, // WMATIC
          amount: 0,
          userData: '0x'
        }
      ],
      [wmatic.address, wmaticLinearPool.address, stMaticLinearPool.address, stMatic.address],
      {
        sender: signer.address,
        fromInternalBalance: false,
        recipient: signer.address,
        toInternalBalance: false
      },
      [ethers.utils.parseUnits('1000000000'), ethers.utils.parseUnits('1000000000'), ethers.utils.parseUnits('1000000000'), ethers.utils.parseUnits('1000000000')],
      Date.now() + 1000
  )
  maticBalanceAfter = await wmatic.balanceOf(signer.address);
  stMaticBalanceAfter = await stMatic.balanceOf(signer.address);

  const wmaticReceivedTetu = maticBalanceAfter - maticBalanceBefore;

  console.log(`Matic DIFF: ${maticBalanceAfter - maticBalanceBefore}`)
  console.log(`stMatic DIFF: ${stMaticBalanceAfter - stMaticBalanceBefore}`)
  console.log(`Rate: ${(stMaticBalanceAfter - stMaticBalanceBefore)/(maticBalanceAfter - maticBalanceBefore)}`)

  console.log("==============================");
  console.log("WMatic results")
  console.log("==============================");
  console.log("ref pool reseived", wmaticReceivedRef.toString());
  console.log("tetu pool reseived", wmaticReceivedTetu.toString());
  console.log("difference", wmaticReceivedTetu - wmaticReceivedRef);

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
