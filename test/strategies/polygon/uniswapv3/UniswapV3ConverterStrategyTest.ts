import chai from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  IBorrowManager__factory,
  IController,
  IConverterController__factory,
  IERC20,
  IERC20__factory,
  IStrategyV2,
  ISwapper,
  ISwapper__factory,
  ITetuConverter__factory,
  IUniswapV3Pool__factory,
  TetuConverter__factory,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory
} from "../../../../typechain";
import {BigNumber, ContractReceipt, ContractTransaction} from "ethers";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {config as dotEnvConfig} from "dotenv";

const { expect } = chai;

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: "boolean",
      default: false,
    },
    hardhatChainId: {
      type: "number",
      default: 137
    },
  }).argv;

describe('UniswapV3ConverterStrategyTests', function() {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

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
  let _1_000: BigNumber;
  let _5_000: BigNumber;
  let _10_000: BigNumber;
  let _100_000: BigNumber;
  const bufferRate = 1_000; // n_%
  let swapper: ISwapper;
  let FEE_DENOMINATOR: BigNumber

  before(async function() {
    [signer, signer2] = await ethers.getSigners();
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();

    const core = Addresses.getCore();
    controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);

    _1 = parseUnits('1', 6);
    _100 = parseUnits('100', 6);
    _1_000 = parseUnits('1000', 6);
    _5_000 = parseUnits('5000', 6);
    _10_000 = parseUnits('10000', 6);
    _100_000 = parseUnits('100000', 6);

    gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    let data

    const strategyUSDCWETH500Deployer = async(_splitterAddress: string) => {
      const _strategy = UniswapV3ConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
        gov
      );

      // USDC / WETH 0.05%
      const poolAddress = MaticAddresses.UNISWAPV3_USDC_WETH_500;
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
      const poolAddress = MaticAddresses.UNISWAPV3_WMATIC_USDC_500;
      // +-2.5% price (10 ticks == 0.05%*2 price change)
      const range = 250;
      // +-0.5% price - rebalance
      const rebalanceRange = 50;

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
    await ConverterUtils.disableHf(signer);
    await ConverterUtils.disableDForce(signer);
    // await ConverterUtils.disableAaveV2(signer);
    // await ConverterUtils.disableAaveV3(signer);

    swapper = ISwapper__factory.connect('0x7b505210a0714d2a889E41B59edc260Fa1367fFe', signer)

    FEE_DENOMINATOR = await vault.FEE_DENOMINATOR()
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
    it('Rebalance and hardwork', async() => {
      const investAmount = _10_000;
      const swapAssetValueForPriceMove = parseUnits('1000000', 6);

      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter())
      let price;
      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6))

      console.log('deposit...');
      await vault.deposit(investAmount, signer.address);

      expect(await strategy.isReadyToHardWork()).eq(false)
      expect(await strategy.needRebalance()).eq(false)

      await movePriceUp(signer2, strategy.address, swapAssetValueForPriceMove)

      price = await swapper.getPrice(await strategy.pool(), await strategy.tokenB(), MaticAddresses.ZERO_ADDRESS, 0);

      expect(await strategy.isReadyToHardWork()).eq(true)
      expect(await strategy.needRebalance()).eq(true)
      await strategy.rebalance()
      expect(await strategy.isReadyToHardWork()).eq(false) // all rewards spent to cover rebalance loss
      expect(await strategy.needRebalance()).eq(false)

      await movePriceDown(signer2, strategy.address, swapAssetValueForPriceMove.mul(parseUnits('1')).div(price).mul(2))

      /*expect(await strategy.needRebalance()).eq(true)
      console.log('rebalance...');
      await strategy.rebalance()
      expect(await strategy.needRebalance()).eq(false)*/

      expect(await strategy.isReadyToHardWork()).eq(true)
      await strategy.connect(splitterSigner).doHardWork()
      expect(await strategy.isReadyToHardWork()).eq(false)
    })

    /*it('More realistic test for reverse tokens order pool', async() => {
      const platformVoter = await DeployerUtilsLocal.impersonate(await controller.platformVoter())
      await strategy2.connect(platformVoter).setCompoundRatio(100000) // 100%
      const converter = TetuConverter__factory.connect(getConverterAddress(), signer)
      const converterController = IConverterController__factory.connect(await converter.controller(), signer)
      const converterGovernance = await DeployerUtilsLocal.impersonate(await converterController.governance())
      const borrowManager = IBorrowManager__factory.connect(await converterController.borrowManager(), converterGovernance)
      await converterController.connect(converterGovernance).setMinHealthFactor2(102)
      await converterController.connect(converterGovernance).setTargetHealthFactor2(112)
      await borrowManager.setTargetHealthFactors([MaticAddresses.USDC_TOKEN, MaticAddresses.WMATIC_TOKEN,], [112,112])
      const investAmount = _1_000;
      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault2.splitter())

      console.log('Deposit 1k USDC...');
      await vault2.deposit(investAmount, signer.address);

      const totalAssetsBefore = await vault2.totalAssets()
      console.log('Vault totalAssets', await vault2.totalAssets())
      console.log('Strategy totalAssets', await strategy2.totalAssets())
      // console.log(await strategy2.callStatic.calcInvestedAssets())

      await makeVolume(signer2, strategy2.address, parseUnits('1000000', 6))

      console.log('Vault totalAssets', await vault2.totalAssets())
      console.log('Strategy totalAssets', await strategy2.totalAssets())

      expect(await strategy2.needRebalance()).eq(false)
      expect(await strategy2.isReadyToHardWork()).eq(true)
      await strategy2.connect(splitterSigner).doHardWork()
      expect(await strategy2.isReadyToHardWork()).eq(false)

      console.log('Vault totalAssets', await vault2.totalAssets())
      console.log('Strategy totalAssets', await strategy2.totalAssets())
      // move price to more then 0.5%

      expect(await strategy2.needRebalance()).eq(true)
      await strategy.rebalance()
      await strategy2.connect(splitterSigner).doHardWork()
    })*/

    /*it('deposit / withdraw, fees, totalAssets + check insurance and LossCovered', async() => {
      let receipt: ContractReceipt
      let tx: ContractTransaction
      const depositFee = BigNumber.from(300)
      const withdrawFee = BigNumber.from(300)

      const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      let totalDeposited = BigNumber.from(0);
      let totalWithdrawFee = BigNumber.from(0);
      let totalAssetsBefore: BigNumber
      let totalAssetsDiff: BigNumber
      let totalLossCovered = BigNumber.from(0)

      // also setting fees prevents 'SB: Impact too high'
      await vault.connect(gov).setFees(depositFee, withdrawFee)

      console.log('deposit 1.0 USDC...');
      tx = await vault.deposit(_1, signer.address);
      receipt = await tx.wait()
      totalDeposited = totalDeposited.add(_1);
      expect(await vault.totalAssets()).eq(totalDeposited.sub(totalDeposited.mul(depositFee).div(FEE_DENOMINATOR)))

      console.log(`Insurance balance: ${formatUnits(await TokenUtils.balanceOf(asset.address, await vault.insurance()), 6)} USDC`)
      if (receipt.events && receipt.events.filter(x => x.event === "LossCovered").length) {
        const lostCovered = receipt.events.filter(x => x.event === "LossCovered")[0].args?.amount
        console.log(`Loss covered: ${formatUnits(lostCovered, 6)} USDC`)
        totalLossCovered = totalLossCovered.add(lostCovered)
      }

      console.log('deposit 100.0 USDC...');
      tx = await vault.deposit(_100, signer.address);
      receipt = await tx.wait()
      totalDeposited = totalDeposited.add(_100);
      expect(await vault.totalAssets()).eq(totalDeposited.sub(totalDeposited.mul(depositFee).div(FEE_DENOMINATOR)))

      console.log(`Insurance balance: ${formatUnits(await TokenUtils.balanceOf(asset.address, await vault.insurance()), 6)} USDC`)
      if (receipt.events && receipt.events.filter(x => x.event === "LossCovered").length) {
        const lostCovered = receipt.events.filter(x => x.event === "LossCovered")[0].args?.amount
        console.log(`Loss covered: ${formatUnits(lostCovered, 6)} USDC`)
        totalLossCovered = totalLossCovered.add(lostCovered)
      }

      console.log('withdraw 1.0 USDC...');
      totalAssetsBefore = await vault.totalAssets()
      tx = await vault.withdraw(_1, signer.address, signer.address);
      receipt = await tx.wait()
      totalAssetsDiff = totalAssetsBefore.sub(await vault.totalAssets())
      expect(totalAssetsDiff.sub(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))).eq(_1)
      totalWithdrawFee = totalWithdrawFee.add(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))

      console.log(`Insurance balance: ${formatUnits(await TokenUtils.balanceOf(asset.address, await vault.insurance()), 6)} USDC`)
      if (receipt.events && receipt.events.filter(x => x.event === "LossCovered").length) {
        const lostCovered = receipt.events.filter(x => x.event === "LossCovered")[0].args?.amount
        console.log(`Loss covered: ${formatUnits(lostCovered, 6)} USDC`)
        totalLossCovered = totalLossCovered.add(lostCovered)
      }

      console.log('deposit 5000.0 USDC...');
      tx = await vault.deposit(_5_000, signer.address);
      receipt = await tx.wait()
      totalDeposited = totalDeposited.add(_5_000);
      expect(await vault.totalAssets()).eq(totalDeposited.sub(totalDeposited.mul(depositFee).div(FEE_DENOMINATOR)).sub(_1).sub(totalWithdrawFee))

      console.log(`Insurance balance: ${formatUnits(await TokenUtils.balanceOf(asset.address, await vault.insurance()), 6)} USDC`)
      if (receipt.events && receipt.events.filter(x => x.event === "LossCovered").length) {
        const lostCovered = receipt.events.filter(x => x.event === "LossCovered")[0].args?.amount
        console.log(`Loss covered: ${formatUnits(lostCovered, 6)} USDC`)
        totalLossCovered = totalLossCovered.add(lostCovered)
      }

      console.log('withdraw 1000.0 USDC...')
      totalAssetsBefore = await vault.totalAssets()
      tx = await vault.withdraw(_1_000, signer.address, signer.address);
      receipt = await tx.wait()
      totalAssetsDiff = totalAssetsBefore.sub(await vault.totalAssets())
      expect(totalAssetsDiff.sub(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))).eq(_1_000)
      totalWithdrawFee = totalWithdrawFee.add(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))

      console.log(`Insurance balance: ${formatUnits(await TokenUtils.balanceOf(asset.address, await vault.insurance()), 6)} USDC`)
      if (receipt.events && receipt.events.filter(x => x.event === "LossCovered").length) {
        const lostCovered = receipt.events.filter(x => x.event === "LossCovered")[0].args?.amount
        console.log(`Loss covered: ${formatUnits(lostCovered, 6)} USDC`)
        totalLossCovered = totalLossCovered.add(lostCovered)
      }

      console.log('withdraw 100.0 USDC...');
      totalAssetsBefore = await vault.totalAssets()
      tx = await vault.withdraw(_100, signer.address, signer.address);
      receipt = await tx.wait()
      totalAssetsDiff = totalAssetsBefore.sub(await vault.totalAssets())
      expect(totalAssetsDiff.sub(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))).eq(_100)
      totalWithdrawFee = totalWithdrawFee.add(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))

      console.log(`Insurance balance: ${formatUnits(await TokenUtils.balanceOf(asset.address, await vault.insurance()), 6)} USDC`)
      if (receipt.events && receipt.events.filter(x => x.event === "LossCovered").length) {
        const lostCovered = receipt.events.filter(x => x.event === "LossCovered")[0].args?.amount
        console.log(`Loss covered: ${formatUnits(lostCovered, 6)} USDC`)
        totalLossCovered = totalLossCovered.add(lostCovered)
      }

      console.log('withdrawAll...');
      totalAssetsBefore = await vault.totalAssets()
      tx = await vault.withdrawAll();
      receipt = await tx.wait()
      totalAssetsDiff = totalAssetsBefore.sub(await vault.totalAssets())
      totalWithdrawFee = totalWithdrawFee.add(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))

      console.log(`Insurance balance: ${formatUnits(await TokenUtils.balanceOf(asset.address, await vault.insurance()), 6)} USDC`)
      if (receipt.events && receipt.events.filter(x => x.event === "LossCovered").length) {
        const lostCovered = receipt.events.filter(x => x.event === "LossCovered")[0].args?.amount
        console.log(`Loss covered: ${formatUnits(lostCovered, 6)} USDC`)
        totalLossCovered = totalLossCovered.add(lostCovered)
      }

      console.log(`Total lost covered: ${formatUnits(totalLossCovered, 6)} USDC`)

      const balanceAfter = await TokenUtils.balanceOf(asset.address, signer.address);
      const totalDepositFee = totalDeposited.mul(depositFee).div(FEE_DENOMINATOR)
      expect(balanceBefore.sub(balanceAfter)).eq(totalDepositFee.add(totalWithdrawFee))
    })

    it('deposit / withdraw, fees, totalAssets for reverse tokens order pool', async() => {
      const depositFee = BigNumber.from(300)
      const withdrawFee = BigNumber.from(300)

      const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      let totalDeposited = BigNumber.from(0);
      let totalWithdrawFee = BigNumber.from(0);
      let totalAssetsBefore: BigNumber
      let totalAssetsDiff: BigNumber

      // also setting fees prevents 'SB: Impact too high'
      await vault2.connect(gov).setFees(depositFee, withdrawFee)

      console.log('deposit 1.0 USDC...');
      await vault2.deposit(_1, signer.address);
      totalDeposited = totalDeposited.add(_1);
      expect(await vault2.totalAssets()).eq(totalDeposited.sub(totalDeposited.mul(depositFee).div(FEE_DENOMINATOR)))

      console.log('deposit 100.0 USDC...');
      await vault2.deposit(_100, signer.address);
      totalDeposited = totalDeposited.add(_100);
      expect(await vault2.totalAssets()).eq(totalDeposited.sub(totalDeposited.mul(depositFee).div(FEE_DENOMINATOR)))

      console.log('withdraw 1.0 USDC...');
      totalAssetsBefore = await vault2.totalAssets()
      await vault2.withdraw(_1, signer.address, signer.address);
      totalAssetsDiff = totalAssetsBefore.sub(await vault2.totalAssets())
      expect(totalAssetsDiff.sub(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))).eq(_1)
      totalWithdrawFee = totalWithdrawFee.add(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))

      console.log('deposit 5000.0 USDC...');
      await vault2.deposit(_5_000, signer.address);
      totalDeposited = totalDeposited.add(_5_000);
      expect(await vault2.totalAssets()).eq(totalDeposited.sub(totalDeposited.mul(depositFee).div(FEE_DENOMINATOR)).sub(_1).sub(totalWithdrawFee))

      console.log('withdraw 1000.0 USDC...')
      totalAssetsBefore = await vault2.totalAssets()
      await vault2.withdraw(_1_000, signer.address, signer.address);
      totalAssetsDiff = totalAssetsBefore.sub(await vault2.totalAssets())
      expect(totalAssetsDiff.sub(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))).eq(_1_000)
      totalWithdrawFee = totalWithdrawFee.add(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))

      console.log('withdraw 100.0 USDC...');
      totalAssetsBefore = await vault2.totalAssets()
      await vault2.withdraw(_100, signer.address, signer.address);
      totalAssetsDiff = totalAssetsBefore.sub(await vault2.totalAssets())
      expect(totalAssetsDiff.sub(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))).eq(_100)
      totalWithdrawFee = totalWithdrawFee.add(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))

      console.log('withdrawAll...');
      totalAssetsBefore = await vault2.totalAssets()
      await vault2.withdrawAll();
      totalAssetsDiff = totalAssetsBefore.sub(await vault2.totalAssets())
      totalWithdrawFee = totalWithdrawFee.add(totalAssetsDiff.mul(withdrawFee).div(FEE_DENOMINATOR))

      const balanceAfter = await TokenUtils.balanceOf(asset.address, signer.address);
      const totalDepositFee = totalDeposited.mul(depositFee).div(FEE_DENOMINATOR)
      expect(balanceBefore.sub(balanceAfter)).eq(totalDepositFee.add(totalWithdrawFee))
    })*/

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

async function makeVolume(signer: SignerWithAddress, strategyAddress: string, amount: BigNumber) {
  const strategy = UniswapV3ConverterStrategy__factory.connect(strategyAddress, signer) as UniswapV3ConverterStrategy
  const swapper = ISwapper__factory.connect('0x7b505210a0714d2a889E41B59edc260Fa1367fFe', signer)
  const tokenA = await strategy.tokenA()
  const tokenB = await strategy.tokenB()
  const swapAmount = amount.div(2)
  let price
  let priceBefore
  const signerBalanceOfTokenA = await TokenUtils.balanceOf(tokenA, signer.address)
  const signerBalanceOfTokenB = await TokenUtils.balanceOf(tokenB, signer.address)
  if (signerBalanceOfTokenA.lt(swapAmount)) {
    await TokenUtils.getToken(tokenA, signer.address, amount)
  }

  console.log('Making pool volume...');
  priceBefore = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB price', formatUnits(priceBefore, 6))
  console.log('swap in pool USDC to tokenB...');
  await TokenUtils.transfer(tokenA, signer, swapper.address, swapAmount.toString())
  await swapper.connect(signer).swap(await strategy.pool(), tokenA, tokenB, signer.address, 10000) // 10% slippage
  price = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB new price', formatUnits(price, 6))
  console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%')
  priceBefore = price
  const gotTokenBAmount = (await TokenUtils.balanceOf(tokenB, signer.address)).sub(signerBalanceOfTokenB)
  // console.log('gotTokenBAmount', gotTokenBAmount)
  console.log('swap in pool tokenB to USDC...');
  console.log('Swap amount of tokenB:', formatUnits(gotTokenBAmount, 18))
  await TokenUtils.transfer(tokenB, signer, swapper.address, gotTokenBAmount.toString())
  await swapper.connect(signer).swap(await strategy.pool(), tokenB, tokenA, signer.address, 10000) // 10% slippage
  price = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB new price', formatUnits(price, 6))
  console.log(`TokenB price change: -${formatUnits(priceBefore.sub(price).mul(1e13).div(priceBefore).div(1e8), 3)}%`)
}

async function movePriceUp(signer: SignerWithAddress, strategyAddress: string, amount: BigNumber) {
  const strategy = UniswapV3ConverterStrategy__factory.connect(strategyAddress, signer) as UniswapV3ConverterStrategy
  const swapper = ISwapper__factory.connect('0x7b505210a0714d2a889E41B59edc260Fa1367fFe', signer)
  const tokenA = await strategy.tokenA()
  const tokenB = await strategy.tokenB()
  const swapAmount = amount
  let price
  let priceBefore
  const signerBalanceOfTokenA = await TokenUtils.balanceOf(tokenA, signer.address)
  if (signerBalanceOfTokenA.lt(swapAmount)) {
    await TokenUtils.getToken(tokenA, signer.address, amount)
  }

  console.log('Moving price up...');
  priceBefore = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB price', formatUnits(priceBefore, 6))
  console.log('swap in pool USDC to tokenB...');
  await TokenUtils.transfer(tokenA, signer, swapper.address, swapAmount.toString())
  await swapper.connect(signer).swap(await strategy.pool(), tokenA, tokenB, signer.address, 10000) // 10% slippage
  price = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB new price', formatUnits(price, 6))
  console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%')
}

async function movePriceDown(signer: SignerWithAddress, strategyAddress: string, amount: BigNumber) {
  const strategy = UniswapV3ConverterStrategy__factory.connect(strategyAddress, signer) as UniswapV3ConverterStrategy
  const swapper = ISwapper__factory.connect('0x7b505210a0714d2a889E41B59edc260Fa1367fFe', signer)
  const tokenA = await strategy.tokenA()
  const tokenB = await strategy.tokenB()
  const swapAmount = amount
  let price
  let priceBefore
  const signerBalanceOfTokenB = await TokenUtils.balanceOf(tokenB, signer.address)
  if (signerBalanceOfTokenB.lt(swapAmount)) {
    await TokenUtils.getToken(tokenB, signer.address, amount)
  }

  console.log('Moving price down...');
  priceBefore = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB price', formatUnits(priceBefore, 6))
  console.log('swap in pool tokenB to USDC...');
  await TokenUtils.transfer(tokenB, signer, swapper.address, swapAmount.toString())
  await swapper.connect(signer).swap(await strategy.pool(), tokenB, tokenA, signer.address, 40000) // 40% slippage
  price = await swapper.getPrice(await strategy.pool(), tokenB, MaticAddresses.ZERO_ADDRESS, 0);
  console.log('tokenB new price', formatUnits(price, 6))
  console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%')
}