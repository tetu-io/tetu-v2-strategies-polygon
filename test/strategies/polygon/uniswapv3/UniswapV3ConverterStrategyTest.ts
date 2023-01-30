import chai from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  IController,
  IERC20,
  IERC20__factory, IStrategyV2, ISwapper, ISwapper__factory, IUniswapV3Pool__factory,
  TetuVaultV2,
  UniswapV3ConverterStrategy, UniswapV3ConverterStrategy__factory
} from "../../../../typechain";
import {BigNumber} from "ethers";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";

const { expect } = chai;

describe('UniswapV3ConverterStrategyTests', function() {
  let snapshotBefore: string;
  let snapshot: string;
  let gov: SignerWithAddress;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let controller: IController;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: UniswapV3ConverterStrategy;
  let vault2: TetuVaultV2; // pool with reverse tokens order
  let strategy2: UniswapV3ConverterStrategy;
  let _1: BigNumber;
  let _100: BigNumber;
  let _100_000: BigNumber;
  const bufferRate = 1_000; // n_%
  let swapper: ISwapper;

  before(async function() {
    [signer, signer2] = await ethers.getSigners();
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();

    const core = Addresses.getCore();
    controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);

    _1 = parseUnits('1', 6);
    _100 = parseUnits('100', 6);
    _100_000 = parseUnits('100000', 6);

    gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    let data

    const strategyUSDCWETH500Deployer = async(_splitterAddress: string) => {
      const _strategy = UniswapV3ConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
        gov
      );

      // USDC / WETH 0.05%
      const poolAddress = '0x45dDa9cb7c25131DF268515131f647d726f50608';
      // +-10% price (10 ticks == 0.05%*2 price change)
      const range = 1000;
      // +-1% price - rebalance
      const rebalanceRange = 100;

      await _strategy.init(
        core.controller,
        _splitterAddress,
        getConverterAddress(),
        poolAddress,
        range,
        rebalanceRange,
      );

      return _strategy as unknown as IStrategyV2;
    };
    data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_UniswapV3_USDC-WETH-0.05%',
      strategyUSDCWETH500Deployer,
      controller,
      gov,
      bufferRate,
      0,
      0,
      false,
    );
    vault = data.vault.connect(signer);
    strategy = data.strategy as unknown as UniswapV3ConverterStrategy;

    const strategyWMATICUSDC500Deployer = async(_splitterAddress: string) => {
      const _strategy = UniswapV3ConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
        gov
      );

      // WMATIC / USDC 0.05%
      const poolAddress = '0xA374094527e1673A86dE625aa59517c5dE346d32';
      // +-10% price (10 ticks == 0.05%*2 price change)
      const range = 1000;
      // +-1% price - rebalance
      const rebalanceRange = 100;

      await _strategy.init(
        core.controller,
        _splitterAddress,
        getConverterAddress(),
        poolAddress,
        range,
        rebalanceRange,
      );

      return _strategy as unknown as IStrategyV2;
    };
    data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_UniswapV3_WMATIC_USDC-0.05%',
      strategyWMATICUSDC500Deployer,
      controller,
      gov,
      bufferRate,
      0,
      0,
      false,
    );
    vault2 = data.vault.connect(signer);
    strategy2 = data.strategy as unknown as UniswapV3ConverterStrategy;

    await TokenUtils.getToken(asset.address, signer.address, _100_000);
    // await TokenUtils.getToken(asset.address, signer2.address, _100_000);
    await asset.approve(vault.address, Misc.MAX_UINT);
    await asset.approve(vault2.address, Misc.MAX_UINT);

    // Disable platforms at TetuConverter
    // await ConverterUtils.disableHf(signer);
    await ConverterUtils.disableDForce(signer);
    await ConverterUtils.disableAaveV2(signer);
    await ConverterUtils.disableAaveV3(signer);

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

  describe('UniswapV3 strategy tests', function() {
    it('hardwork with rebalance', async() => {
      const investAmount = _100;
      const swapAssetValueForPriceMove = parseUnits('1000000', 6);
      let price;
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      let priceBefore = price

      console.log('deposit...');
      // const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      await vault.deposit(investAmount, signer.address);

      expect(await strategy.needRebalance()).eq(false)

      console.log('swap in pool USDC to tokenB...');
      await TokenUtils.getToken(asset.address, swapper.address, swapAssetValueForPriceMove);
      await swapper.connect(signer2).swap(await strategy.pool(), asset.address, await strategy.tokenB(), signer2.address, 10000) // 10% slippage
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%')
      priceBefore = price

      expect(await strategy.needRebalance()).eq(true)
      await strategy.doHardWork()
      expect(await strategy.needRebalance()).eq(false)

      console.log('swap in pool tokenB to USDC...');
      const amountofTokenBToSell = swapAssetValueForPriceMove.mul(parseUnits('1')).div(price)
      console.log('Swap amount of tokenB:', formatUnits(amountofTokenBToSell, 18))
      await TokenUtils.getToken(await strategy.tokenB(), swapper.address, amountofTokenBToSell);
      await swapper.connect(signer2).swap(await strategy.pool(), await strategy.tokenB(), asset.address, signer2.address, 10000) // 10% slippage
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      console.log(`TokenB price change: -${formatUnits(priceBefore.sub(price).mul(1e13).div(priceBefore).div(1e8), 3)}%`)

      expect(await strategy.needRebalance()).eq(true)
      await strategy.doHardWork()
      expect(await strategy.needRebalance()).eq(false)
    })

    it('hardwork with rebalance for reverse tokens order pool', async() => {
      const investAmount = _100;
      const swapAssetValueForPriceMove = parseUnits('1000000', 6);
      let price;
      price = await swapper.getPrice(await strategy2.pool(), await strategy2.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      let priceBefore = price

      console.log('deposit...');
      // const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      await vault2.deposit(investAmount, signer.address);

      console.log('swap in pool USDC to tokenB...');
      await TokenUtils.getToken(asset.address, swapper.address, swapAssetValueForPriceMove);
      await swapper.connect(signer2).swap(await strategy2.pool(), asset.address, await strategy2.tokenB(), signer2.address, 10000) // 10% slippage
      price = await swapper.getPrice(await strategy2.pool(), await strategy2.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%')
      priceBefore = price

      expect(await strategy2.needRebalance()).eq(true)
      await strategy2.doHardWork()
      expect(await strategy2.needRebalance()).eq(false)

      console.log('swap in pool tokenB to USDC...');
      const amountofTokenBToSell = swapAssetValueForPriceMove.mul(parseUnits('1')).div(price)
      console.log('Swap amount of tokenB:', formatUnits(amountofTokenBToSell, 18))
      await TokenUtils.getToken(await strategy2.tokenB(), swapper.address, amountofTokenBToSell);
      await swapper.connect(signer2).swap(await strategy2.pool(), await strategy2.tokenB(), asset.address, signer2.address, 10000) // 10% slippage
      price = await swapper.getPrice(await strategy2.pool(), await strategy2.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      console.log(`TokenB price change: -${formatUnits(priceBefore.sub(price).mul(1e13).div(priceBefore).div(1e8), 3)}%`)

      expect(await strategy2.needRebalance()).eq(true)
      await strategy2.doHardWork()
      expect(await strategy2.needRebalance()).eq(false)

    })

    it('deposit / withdraw', async() => {
      console.log('deposit 1.0 USDC...');
      const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      await vault.deposit(_1, signer.address);

      console.log('deposit 100.0 USDC...');
      await vault.deposit(_100, signer.address);

      console.log('withdraw 100.0 USDC...');
      await vault.withdraw(_100, signer.address, signer.address);

      console.log('withdrawAll...');
      await vault.withdrawAll();
      const balanceAfter = await TokenUtils.balanceOf(asset.address, signer.address);
      // max loss - 0.000010 USDC
      expect(balanceBefore.sub(balanceAfter)).lt(10)
    })

    it('deposit / withdraw for reverse tokens order pool', async() => {
      console.log('deposit 1.0 USDC...');
      const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      await vault2.deposit(_1, signer.address);

      console.log('deposit 100.0 USDC...');
      await vault2.deposit(_100, signer.address);

      console.log('withdraw 100.0 USDC...');
      await vault2.withdraw(_100, signer.address, signer.address);

      console.log('withdrawAll...');
      await vault2.withdrawAll();

      const balanceAfter = await TokenUtils.balanceOf(asset.address, signer.address);
      // max loss - 0.000010 USDC
      expect(balanceBefore.sub(balanceAfter)).lt(10)
    })

    /*it('Claim fees', async() => {
      const investAmount = _100;
      const swapAssetValueForPriceMove = parseUnits('1000000', 6);

      // No fees to burn
      await strategy.connect(gov).claim()

      let price;
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      let priceBefore = price

      console.log('deposit...');
      // const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      await vault.deposit(investAmount, signer.address);

      console.log('swap in pool USDC to tokenB...');
      await TokenUtils.getToken(asset.address, swapper.address, swapAssetValueForPriceMove);
      await swapper.connect(signer2).swap(await strategy.pool(), asset.address, await strategy.tokenB(), signer2.address, 10000) // 10% slippage
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%')
      priceBefore = price

      // rebalance here

      console.log('swap in pool tokenB to USDC...');
      const amountofTokenBToSell = swapAssetValueForPriceMove.mul(parseUnits('1')).div(price)
      console.log('Swap amount of tokenB:', formatUnits(amountofTokenBToSell, 18))
      await TokenUtils.getToken(await strategy.tokenB(), swapper.address, amountofTokenBToSell);
      await swapper.connect(signer2).swap(await strategy.pool(), await strategy.tokenB(), asset.address, signer2.address, 10000) // 10% slippage
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      console.log(`TokenB price change: -${formatUnits(priceBefore.sub(price).mul(1e13).div(priceBefore).div(1e8), 3)}%`)

      // todo make doHardWork workable
      // await strategy.doHardWork()

      await strategy.connect(gov).claim()
    })

    it('Claim fees for reverse tokens order pool', async() => {
      const investAmount = _100;
      const swapAssetValueForPriceMove = parseUnits('1000000', 6);

      // No fees to burn
      await strategy2.connect(gov).claim()

      let price;
      price = await swapper.getPrice(await strategy2.pool(), await strategy2.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      let priceBefore = price

      console.log('deposit...');
      // const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      await vault2.deposit(investAmount, signer.address);

      console.log('swap in pool USDC to tokenB...');
      await TokenUtils.getToken(asset.address, swapper.address, swapAssetValueForPriceMove);
      await swapper.connect(signer2).swap(await strategy2.pool(), asset.address, await strategy2.tokenB(), signer2.address, 10000) // 10% slippage
      price = await swapper.getPrice(await strategy2.pool(), await strategy2.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%')
      priceBefore = price

      // rebalance here

      console.log('swap in pool tokenB to USDC...');
      const amountofTokenBToSell = swapAssetValueForPriceMove.mul(parseUnits('1')).div(price)
      console.log('Swap amount of tokenB:', formatUnits(amountofTokenBToSell, 18))
      await TokenUtils.getToken(await strategy2.tokenB(), swapper.address, amountofTokenBToSell);
      await swapper.connect(signer2).swap(await strategy2.pool(), await strategy2.tokenB(), asset.address, signer2.address, 10000) // 10% slippage
      price = await swapper.getPrice(await strategy2.pool(), await strategy2.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      console.log(`TokenB price change: -${formatUnits(priceBefore.sub(price).mul(1e13).div(priceBefore).div(1e8), 3)}%`)

      // await strategy2.doHardWork()

      await strategy2.connect(gov).claim()
    })*/

    /*it('Calculate rebalance cost when shorted (borrowed) tokenB price goes up', async() => {
      const investAmount = _1;
      const swapAssetValueForPriceMove = parseUnits('250000', 6);
      let price;
      let balances;
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      const priceBefore = price

      console.log('deposit...');
      // const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      await vault.deposit(investAmount, signer.address);

      balances = await strategy.getUnderlyingBalances()
      const tokenABalanceBefore = balances[0]
      const tokenBBalanceBefore = balances[1]

      console.log('swap in pool USDC to tokenB...');
      console.log('Swap amount of USDC:', formatUnits(swapAssetValueForPriceMove, 6))
      await TokenUtils.getToken(asset.address, swapper.address, swapAssetValueForPriceMove);
      await swapper.connect(signer2).swap(await strategy.pool(), asset.address, await strategy.tokenB(), signer2.address, 10000) // 10% slippage
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      // console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%')
      // priceBefore = price

      balances = await strategy.getUnderlyingBalances()
      const tokenABalanceAfter = balances[0]
      const tokenBBalanceAfter = balances[1]
      const needToBuyTokenBToRepayDebt = tokenBBalanceBefore.sub(tokenBBalanceAfter)
      // console.log('needToBuyTokenBToRepayDebt', needToBuyTokenBToRepayDebt.toString())
      const needToSpendTokenAWithoutImpact = needToBuyTokenBToRepayDebt.mul(price).div(parseUnits('1'))
      // console.log('needToSpendTokenAWithoutImpact', needToSpendTokenAWithoutImpact.toString())
      const tokenABalanceChange = tokenABalanceAfter.sub(tokenABalanceBefore)
      // console.log('tokenABalanceChange', tokenABalanceChange.toString())
      const rebalanceCost = needToSpendTokenAWithoutImpact.sub(tokenABalanceChange)
      const rebalanceCostPercent = rebalanceCost.mul(1e13).div(investAmount).div(1e6)

      const pool = IUniswapV3Pool__factory.connect(await strategy.pool(), signer)
      console.log('--------------------------')
      console.log('Vault:', await vault.name())
      console.log(`Price range: ~+-${(((await strategy.upperTick()) - (await strategy.lowerTick())) / 2) / ((await pool.fee()) * 2 / 10)}%`)
      console.log(`Invested: ${formatUnits(investAmount, 6)} USDC`)
      console.log(`TokenB price change: +${formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3)}%`)
      console.log(`Estimated REBALANCE COST = ${formatUnits(rebalanceCost, 6)} USDC (${formatUnits(rebalanceCostPercent, 5)}%)`)
      console.log('--------------------------')
    })

    it('Calculate rebalance cost when shorted (borrowed) tokenB price goes down', async() => {
      const investAmount = _1;
      const swapAssetValueForPriceMove = parseUnits('200000', 6);
      let price;
      let balances;
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))
      const priceBefore = price

      console.log('deposit...');
      // const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      await vault.deposit(investAmount, signer.address);

      balances = await strategy.getUnderlyingBalances()
      const tokenABalanceBefore = balances[0]
      const tokenBBalanceBefore = balances[1]

      console.log('swap in pool tokenB to USDC...');
      const amountofTokenBToSell = swapAssetValueForPriceMove.mul(parseUnits('1')).div(price)
      console.log('Swap amount of tokenB:', formatUnits(amountofTokenBToSell, 18))
      await TokenUtils.getToken(await strategy.tokenB(), swapper.address, amountofTokenBToSell);
      await swapper.connect(signer2).swap(await strategy.pool(), await strategy.tokenB(), asset.address, signer2.address, 10000) // 10% slippage
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))

      balances = await strategy.getUnderlyingBalances()
      const tokenABalanceAfter = balances[0]
      const tokenBBalanceAfter = balances[1]
      const canSellTokenB = tokenBBalanceAfter.sub(tokenBBalanceBefore)
      // console.log('canSellTokenB', canSellTokenB.toString())
      const gotTokenAWithoutImpact = canSellTokenB.mul(price).div(parseUnits('1'))
      // console.log('gotTokenAWithoutImpact', gotTokenAWithoutImpact.toString())
      const tokenANewBalance = tokenABalanceAfter.add(gotTokenAWithoutImpact)
      // console.log('tokenANewBalance', tokenANewBalance.toString())
      const rebalanceCost = tokenABalanceBefore.sub(tokenANewBalance)
      const rebalanceCostPercent = rebalanceCost.mul(1e13).div(investAmount).div(1e6)

      const pool = IUniswapV3Pool__factory.connect(await strategy.pool(), signer)
      console.log('--------------------------')
      console.log('Vault:', await vault.name())
      console.log(`Price range: ~+-${(((await strategy.upperTick()) - (await strategy.lowerTick())) / 2) / ((await pool.fee()) * 2 / 10)}%`)
      console.log(`Invested: ${formatUnits(investAmount, 6)} USDC`)
      console.log(`TokenB price change: -${formatUnits(priceBefore.sub(price).mul(1e13).div(priceBefore).div(1e8), 3)}%`)
      console.log(`Estimated REBALANCE COST = ${formatUnits(rebalanceCost, 6)} USDC (${formatUnits(rebalanceCostPercent, 5)}%)`)
      console.log('--------------------------')
    })*/
  })
})
