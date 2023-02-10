/* tslint:disable:no-trailing-whitespace */
import chai from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../scripts/utils/TimeUtils';
import { DeployerUtils } from '../../scripts/utils/DeployerUtils';
import {BigNumber} from "ethers";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {
  ISwapper,
  ISwapper__factory,
  UniswapV3ResearchStrategy, UniswapV3ResearchStrategy__factory
} from "../../typechain";
import {MaticAddresses} from "../../scripts/MaticAddresses";
import {TokenUtils} from "../../scripts/utils/TokenUtils";

const { expect } = chai;

describe('UniswapV3ResearchStrategyTests', function() {
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let strategy: UniswapV3ResearchStrategy;

  let _1: BigNumber;
  let _100: BigNumber;
  let _1_000: BigNumber;
  let _5_000: BigNumber;
  let _10_000: BigNumber;
  let _100_000: BigNumber;

  let swapper: ISwapper;

  before(async function() {
    [signer, signer2] = await ethers.getSigners();

    snapshotBefore = await TimeUtils.snapshot();

    _1 = parseUnits('1', 6);
    _100 = parseUnits('100', 6);
    _1_000 = parseUnits('1000', 6);
    _5_000 = parseUnits('5000', 6);
    _10_000 = parseUnits('10000', 6);
    _100_000 = parseUnits('100000', 6);

    // WMATIC / USDC 0.05%
    const poolAddress = '0xA374094527e1673A86dE625aa59517c5dE346d32';
    // +-5% price (10 ticks == 0.05%*2 price change)
    const range = 600;
    // const range = 250;
    // const range = 750;
    // const range = 375;
    // +-0.5% price - rebalance
    const rebalanceRange = 40;

    strategy = await DeployerUtils.deployContract(signer, 'UniswapV3ResearchStrategy', poolAddress, range, rebalanceRange, MaticAddresses.USDC_TOKEN) as UniswapV3ResearchStrategy

    swapper = ISwapper__factory.connect('0x7b505210a0714d2a889E41B59edc260Fa1367fFe', signer)
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  describe('UniswapV3 research strategy tests', function() {
    /*it('Deposit, withdraw', async () => {
      const tokenIn = MaticAddresses.USDC_TOKEN
      const depositAmount = _1_000
      await TokenUtils.getToken(tokenIn, signer.address, depositAmount);
      await TokenUtils.approve(tokenIn, signer, strategy.address, depositAmount.toString())

      const priceMoveAmount = parseUnits('200000', 6)
      await movePriceUp(signer2, strategy.address, priceMoveAmount)

      const balanceBefore = await TokenUtils.balanceOf(tokenIn, signer.address)
      expect(await strategy.needRebalance()).eq(true)
      await strategy.deposit(tokenIn, depositAmount)
      expect(await strategy.needRebalance()).eq(false)

      // await expect(strategy.connect(signer2).withdraw(tokenIn, 100)).to.be.revertedWith('Denied')
      await expect(strategy.connect(signer2).withdrawAll(tokenIn)).to.be.revertedWith('Denied')

      // await strategy.withdraw(tokenIn, 1000)

      await strategy.withdrawAll(tokenIn)
      expect(balanceBefore.sub(await TokenUtils.balanceOf(tokenIn, signer.address))).lt(depositAmount.div(2000)) // 0.05% fee

      await expect(strategy.withdrawAll(tokenIn)).to.be.revertedWith('Zero amount')

      await expect(strategy.connect(signer2).changeTickRange(1000)).to.be.revertedWith('Denied')
      await expect(strategy.connect(signer2).changeRebalanceTickRange(100)).to.be.revertedWith('Denied')
    })*/

    it('Simulation', async () => {
      console.log(await strategy.name())

      // console.log(await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))

      const tokenIn = MaticAddresses.USDC_TOKEN
      const depositAmount = _1
      const priceMoveAmount = parseUnits('50000', 6)
      const priceMoveIterations = 4
      const priceMoveAmount2 = parseUnits('20000', 6)
      const priceMoveIterations2 = 4
      let rebalances = 0
      const boughtAmounts = []
      await TokenUtils.getToken(tokenIn, signer.address, depositAmount);
      await TokenUtils.approve(tokenIn, signer, strategy.address, depositAmount.toString())

      await strategy.deposit(tokenIn, depositAmount)
      const estimatedBefore = await strategy.getEstimatedBalance(tokenIn)
      const priceStart = await swapper.getPrice(await strategy.pool(), MaticAddresses.WMATIC_TOKEN, MaticAddresses.ZERO_ADDRESS, 0);

      for(let i = 0; i < priceMoveIterations; i++) {
        const bought = await movePriceUp(signer, strategy.address, priceMoveAmount)
        boughtAmounts.push(bought)

        if (await strategy.needRebalance()) {
          rebalances++;
          await strategy.rebalanceWithTracking()
        }
      }

      let price2 = await swapper.getPrice(await strategy.pool(), MaticAddresses.WMATIC_TOKEN, MaticAddresses.ZERO_ADDRESS, 0);

      for(let i = 0; i < priceMoveIterations2; i++) {
        const bought = await movePriceUp(signer, strategy.address, priceMoveAmount2)
        boughtAmounts.push(bought)
        if (await strategy.needRebalance()) {
          rebalances++;
          await strategy.rebalanceWithTracking()
        }
      }


      const priceMax = await swapper.getPrice(await strategy.pool(), MaticAddresses.WMATIC_TOKEN, MaticAddresses.ZERO_ADDRESS, 0);

      for(let i = 0; i < priceMoveIterations2; i++) {
        // await movePriceDown(signer, strategy.address, priceMoveAmount2.mul(parseUnits('1')).div(price2)/*.mul(2)*/)
        await movePriceDown(signer, strategy.address, boughtAmounts.pop() as BigNumber)

        if (await strategy.needRebalance()) {
          rebalances++;
          await strategy.rebalanceWithTracking()
        }
      }

      for(let i = 0; i < priceMoveIterations; i++) {
        // await movePriceDown(signer, strategy.address, priceMoveAmount.mul(parseUnits('1')).div(priceStart)/*.mul(2)*/)
        await movePriceDown(signer, strategy.address, boughtAmounts.pop() as BigNumber)
        if (await strategy.needRebalance()) {
          rebalances++;
          await strategy.rebalanceWithTracking()
        }
      }

      ///  --------------------------

      for(let i = 0; i < priceMoveIterations; i++) {
        const bought = await movePriceDown(signer, strategy.address, priceMoveAmount.mul(parseUnits('1')).div(priceStart)/*.mul(2)*/)
        boughtAmounts.push(bought)
        // await movePriceDown(signer, strategy.address, boughtAmounts.pop() as BigNumber)
        if (await strategy.needRebalance()) {
          rebalances++;
          await strategy.rebalanceWithTracking()
        }
      }

      price2 = await swapper.getPrice(await strategy.pool(), MaticAddresses.WMATIC_TOKEN, MaticAddresses.ZERO_ADDRESS, 0);

      for(let i = 0; i < priceMoveIterations2; i++) {
        const bought = await movePriceDown(signer, strategy.address, priceMoveAmount2.mul(parseUnits('1')).div(price2)/*.mul(2)*/)
        boughtAmounts.push(bought)
        // await movePriceDown(signer, strategy.address, boughtAmounts.pop() as BigNumber)

        if (await strategy.needRebalance()) {
          rebalances++;
          await strategy.rebalanceWithTracking()
        }
      }

      const priceMin = await swapper.getPrice(await strategy.pool(), MaticAddresses.WMATIC_TOKEN, MaticAddresses.ZERO_ADDRESS, 0);

      for(let i = 0; i < priceMoveIterations2; i++) {
        await movePriceUp(signer, strategy.address, boughtAmounts.pop() as BigNumber)
        if (await strategy.needRebalance()) {
          rebalances++;
          await strategy.rebalanceWithTracking()
        }
      }

      for(let i = 0; i < priceMoveIterations; i++) {
        await movePriceUp(signer, strategy.address, boughtAmounts.pop() as BigNumber)
        if (await strategy.needRebalance()) {
          rebalances++;
          await strategy.rebalanceWithTracking()
        }
      }

      const priceEnd = await swapper.getPrice(await strategy.pool(), MaticAddresses.WMATIC_TOKEN, MaticAddresses.ZERO_ADDRESS, 0);

      const loss = estimatedBefore.sub(await strategy.getEstimatedBalance(tokenIn))

      const tracking = await strategy.tracking()
      console.log('RESULTS')
      console.log(`Strategy: ${await strategy.name()}`)
      console.log(`Price moving: ${priceStart} -> ${priceMax} -> ${priceMin}-> ${priceEnd}`)
      console.log(`Rebalances: ${rebalances}`)
      console.log('Earned', tracking.earned.toString())
      console.log('Impermanent loss', tracking.il.toString())
      console.log(`Total loss estimate: ${loss} (${formatUnits(loss.mul(10**10).div(estimatedBefore).div(10**4), 4)}%)`)
      console.log(`-------------------------------------`)
    })

  })
})


async function movePriceUp(signer: SignerWithAddress, strategyAddress: string, amount: BigNumber) {
  const strategy = UniswapV3ResearchStrategy__factory.connect(strategyAddress, signer) as UniswapV3ResearchStrategy
  const swapper = ISwapper__factory.connect('0x7b505210a0714d2a889E41B59edc260Fa1367fFe', signer)
  const tokenA = MaticAddresses.USDC_TOKEN
  const tokenB = MaticAddresses.WMATIC_TOKEN
  const swapAmount = amount
  let price
  let priceBefore
  const signerBalanceOfTokenA = await TokenUtils.balanceOf(tokenA, signer.address)
  if (signerBalanceOfTokenA.lt(swapAmount)) {
    await TokenUtils.getToken(tokenA, signer.address, amount.mul(5))
  }

  const signerBalanceOfTokenB = await TokenUtils.balanceOf(tokenB, signer.address)

  console.log('Moving price up...');
  priceBefore = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB price', formatUnits(priceBefore, 6))
  console.log('swap in pool USDC to tokenB...');
  await TokenUtils.transfer(tokenA, signer, swapper.address, swapAmount.toString())
  await swapper.connect(signer).swap(await strategy.pool(), tokenA, tokenB, signer.address, 10000) // 10% slippage
  price = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB new price', formatUnits(price, 6))
  console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%')

  return (await TokenUtils.balanceOf(tokenB, signer.address)).sub(signerBalanceOfTokenB)
}

async function movePriceDown(signer: SignerWithAddress, strategyAddress: string, amount: BigNumber) {
  const strategy = UniswapV3ResearchStrategy__factory.connect(strategyAddress, signer) as UniswapV3ResearchStrategy
  const swapper = ISwapper__factory.connect('0x7b505210a0714d2a889E41B59edc260Fa1367fFe', signer)
  const tokenA = MaticAddresses.USDC_TOKEN
  const tokenB = MaticAddresses.WMATIC_TOKEN
  const swapAmount = amount
  let price
  let priceBefore
  const signerBalanceOfTokenB = await TokenUtils.balanceOf(tokenB, signer.address)
  if (signerBalanceOfTokenB.lt(swapAmount)) {
    await TokenUtils.getToken(tokenB, signer.address, amount.mul(5))
  }

  const signerBalanceOfTokenA = await TokenUtils.balanceOf(tokenA, signer.address)

  console.log('Moving price down...');
  priceBefore = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB price', formatUnits(priceBefore, 6))
  console.log('swap in pool tokenB to USDC...');
  await TokenUtils.transfer(tokenB, signer, swapper.address, swapAmount.toString())
  await swapper.connect(signer).swap(await strategy.pool(), tokenB, tokenA, signer.address, 10000) // 10% slippage
  price = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB new price', formatUnits(price, 6))
  console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%')

  return (await TokenUtils.balanceOf(tokenA, signer.address)).sub(signerBalanceOfTokenA)
}
