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
  TetuConverter__factory,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory, VaultFactory__factory,
} from '../../../../typechain';
import { BigNumber } from 'ethers';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { PolygonAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { getConverterAddress, Misc } from '../../../../scripts/utils/Misc';
import { TokenUtils } from '../../../../scripts/utils/TokenUtils';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { config as dotEnvConfig } from 'dotenv';
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {UniswapV3StrategyUtils} from "../../../UniswapV3StrategyUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {PriceOracleManagerUtils} from "../../../baseUT/converter/PriceOracleManagerUtils";

const { expect } = chai;

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: 'boolean',
      default: false,
    },
    hardhatChainId: {
      type: 'number',
      default: 137,
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
  let signer3: SignerWithAddress;
  let operator: SignerWithAddress;
  let controller: IController;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: UniswapV3ConverterStrategy;
  let vault2: TetuVaultV2; // pool with reverse tokens order
  let strategy2: UniswapV3ConverterStrategy;
  let vault3: TetuVaultV2; // stable pool
  let strategy3: UniswapV3ConverterStrategy;
  let _1: BigNumber;
  let _100: BigNumber;
  let _1_000: BigNumber;
  let _5_000: BigNumber;
  let _10_000: BigNumber;
  let _100_000: BigNumber;
  const bufferRate = 1_000; // n_%
  let swapper: ISwapper;
  let FEE_DENOMINATOR: BigNumber;

  before(async function() {
    [signer, signer2, signer3] = await ethers.getSigners();
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

    let data;
    const converterAddress = getConverterAddress();

    // use the latest implementations
    const vaultLogic = await DeployerUtils.deployContract(signer, 'TetuVaultV2');
    const splitterLogic = await DeployerUtils.deployContract(signer, 'StrategySplitterV2');
    const vaultFactory = VaultFactory__factory.connect(core.vaultFactory, signer);
    await vaultFactory.connect(gov).setVaultImpl(vaultLogic.address);
    await vaultFactory.connect(gov).setSplitterImpl(splitterLogic.address);

    const strategyUSDCWETH500Deployer = async(_splitterAddress: string) => {
      const _strategy = UniswapV3ConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
        gov,
      );

      // USDC / WETH 0.05%
      const poolAddress = MaticAddresses.UNISWAPV3_USDC_WETH_500;
      // +-10% price (1 tick == 0.01% price change)
      const range = 1000;
      // +-1% price - rebalance
      const rebalanceRange = 100;

      await _strategy.init(
        core.controller,
        _splitterAddress,
        converterAddress,
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
        gov,
      );

      // WMATIC / USDC 0.05%
      const poolAddress = MaticAddresses.UNISWAPV3_WMATIC_USDC_500;
      // +-2.5% price (1 tick == 0.01% price change)
      const range = 250;
      // +-0.5% price - rebalance
      const rebalanceRange = 50;

      await _strategy.init(
        core.controller,
        _splitterAddress,
        converterAddress,
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

    const strategyUSDCUSDT100Deployer = async(_splitterAddress: string) => {
      const _strategy = UniswapV3ConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
        gov,
      );

      // USDC / USDT 0.01%
      const poolAddress = MaticAddresses.UNISWAPV3_USDC_USDT_100;
      // +-0.01% price (1 tick == 0.01% price change)
      const range = 0;
      const rebalanceRange = 0;

      await _strategy.init(
        core.controller,
        _splitterAddress,
        converterAddress,
        poolAddress,
        range,
        rebalanceRange,
      );

      return _strategy as unknown as IStrategyV2;
    };
    data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_UniswapV3_USDC_USDT-0.01%',
      strategyUSDCUSDT100Deployer,
      controller,
      gov,
      bufferRate,
      300,
      300,
      false,
    );
    vault3 = data.vault.connect(signer);
    strategy3 = data.strategy as unknown as UniswapV3ConverterStrategy;

    await TokenUtils.getToken(asset.address, signer.address, _100_000);
    await TokenUtils.getToken(asset.address, signer3.address, _100_000);
    // await TokenUtils.getToken(asset.address, signer2.address, _100_000);
    await asset.approve(vault.address, Misc.MAX_UINT);
    await asset.approve(vault2.address, Misc.MAX_UINT);
    await asset.approve(vault3.address, Misc.MAX_UINT);
    await asset.connect(signer3).approve(vault3.address, Misc.MAX_UINT);

    // Disable platforms at TetuConverter
    // await ConverterUtils.disableDForce(signer);
    // await ConverterUtils.disableAaveV2(signer);
    // await ConverterUtils.disableAaveV3(signer);

    swapper = ISwapper__factory.connect(MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, signer);

    FEE_DENOMINATOR = await vault.FEE_DENOMINATOR();

    await ConverterUtils.whitelist([strategy.address, strategy2.address, strategy3.address]);

    operator = await UniversalTestUtils.getAnOperator(strategy3.address, signer)
    await strategy3.connect(operator).setReinvestThresholdPercent(10) // 0.01%

    await vault.connect(gov).setWithdrawRequestBlocks(0)
    await vault2.connect(gov).setWithdrawRequestBlocks(0)
    await vault3.connect(gov).setWithdrawRequestBlocks(0)
  });

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
    it('Fuse test', async() => {
      const s = strategy3
      const v = vault3
      const investAmount = _1_000;
      const swapAssetValueForPriceMove = parseUnits('500000', 6);

      const priceOracleManager = await PriceOracleManagerUtils.build(signer, await s.converter());
      console.log('Price USDT in oracle', (await priceOracleManager.priceOracleInTetuConverter.getAssetPrice(MaticAddresses.USDT_TOKEN)).toString())

      console.log('deposit...');
      await v.deposit(investAmount, signer.address);

      await priceOracleManager.incPrice(MaticAddresses.USDT_TOKEN, 1);
      console.log('Price USDT in oracle', (await priceOracleManager.priceOracleInTetuConverter.getAssetPrice(MaticAddresses.USDT_TOKEN)).toString())
      await UniswapV3StrategyUtils.movePriceUp(signer2, s.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAssetValueForPriceMove)
      expect((await s.getState()).isFuseTriggered).eq(false)
      expect(await s.needRebalance()).eq(true)
      await s.rebalance()
      expect((await s.getState()).isFuseTriggered).eq(true)
      expect(await s.needRebalance()).eq(false)

      await s.connect(operator).disableFuse()
      expect((await s.getState()).isFuseTriggered).eq(false)
      expect(await s.needRebalance()).eq(true)
      await s.rebalance()
      expect((await s.getState()).isFuseTriggered).eq(false)
    })

    it('Rebalance and hardwork', async() => {
      const investAmount = _10_000;
      const swapAssetValueForPriceMove = parseUnits('500000', 6);
      const state = await strategy.getState();

      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter());
      let price;
      price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6));

      console.log('deposit...');
      await vault.deposit(investAmount, signer.address);

      expect(await strategy.isReadyToHardWork()).eq(false);
      expect(await strategy.needRebalance()).eq(false);

      await UniswapV3StrategyUtils.movePriceUp(signer2, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAssetValueForPriceMove);

      price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0);

      expect(await strategy.isReadyToHardWork()).eq(true);
      expect(await strategy.needRebalance()).eq(true);

      const rebalanceGasUsed = await strategy.estimateGas.rebalance();
      console.log('>>> REBALANCE GAS USED', rebalanceGasUsed.toNumber());
      expect(rebalanceGasUsed.toNumber()).lessThan(5_000_000);

      await strategy.rebalance();
      expect(await strategy.needRebalance()).eq(false);

      await UniswapV3StrategyUtils.movePriceDown(signer2, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAssetValueForPriceMove.mul(parseUnits('1')).div(price).mul(2));

      expect(await strategy.isReadyToHardWork()).eq(true);
      await strategy.connect(splitterSigner).doHardWork();
      expect(await strategy.isReadyToHardWork()).eq(false);
    });

    it('Loop with rebalance, hardwork, deposit and withdraw', async() => {
      const investAmount = _1_000;
      const swapAssetValueForPriceMove = parseUnits('500000', 6);
      const state = await strategy3.getState();
      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault3.splitter());
      let price;
      price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6));
      const platformVoter = await DeployerUtilsLocal.impersonate(await controller.platformVoter());
      await strategy3.connect(platformVoter).setCompoundRatio(50000);

      console.log('initial deposits...');
      await vault3.deposit(investAmount, signer.address);
      await vault3.connect(signer3).deposit(_1_000, signer3.address);

      let lastDirectionUp = false
      for (let i = 0; i < 10; i++) {
        await UniswapV3StrategyUtils.makeVolume(signer2, strategy3.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('100000', 6));

        if (i % 3) {
          if (!lastDirectionUp) {
            await UniswapV3StrategyUtils.movePriceUp(signer2, strategy3.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAssetValueForPriceMove);
          } else {
            await UniswapV3StrategyUtils.movePriceDown(signer2, strategy3.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAssetValueForPriceMove.mul(parseUnits('1', 6)).div(price));
          }
          lastDirectionUp = !lastDirectionUp
        }

        if (await strategy3.needRebalance()) {
          console.log('Rebalance..')
          await strategy3.rebalance();
        }

        if (i % 5) {
          console.log('Hardwork..')
          await strategy3.connect(splitterSigner).doHardWork();
        }

        if (i % 2) {
          console.log('Deposit..')
          await vault3.connect(signer3).deposit(parseUnits('100.496467', 6), signer3.address);
        } else {
          console.log('Withdraw..')
          const toWithdraw = parseUnits('100.111437', 6)
          const balBefore = await TokenUtils.balanceOf(state.tokenA, signer3.address)
          await vault3.connect(signer3).requestWithdraw()
          await vault3.connect(signer3).withdraw(toWithdraw, signer3.address, signer3.address)
          const balAfter = await TokenUtils.balanceOf(state.tokenA, signer3.address)
          console.log(`To withdraw: ${toWithdraw.toString()}. Withdrawn: ${balAfter.sub(balBefore).toString()}`)
        }
      }

      await vault3.connect(signer3).requestWithdraw()
      console.log('withdrawAll as signer3...');
      await vault3.connect(signer3).withdrawAll();

      await vault3.requestWithdraw()
      console.log('withdrawAll...');
      await vault3.withdrawAll();
    });

    it('Rebalance and hardwork with earned/lost checks for stable pool', async() => {
      const investAmount = _10_000;
      const swapAssetValueForPriceMove = parseUnits('500000', 6);
      let state = await strategy3.getState();

      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault3.splitter());
      let price;
      price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0);
      console.log('tokenB price', formatUnits(price, 6));

      console.log('deposit...');
      await vault3.deposit(investAmount, signer.address);

      await UniswapV3StrategyUtils.movePriceUp(signer2, strategy3.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAssetValueForPriceMove);
      await strategy3.rebalance();
      price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0);

      await UniswapV3StrategyUtils.movePriceDown(signer2, strategy3.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAssetValueForPriceMove.mul(parseUnits('1', 6)).div(price));
      await strategy3.rebalance();

      await UniswapV3StrategyUtils.makeVolume(signer2, strategy3.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('100000', 6));

      state = await strategy3.getState()

      price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0);

      let earnedTotal = BigNumber.from(0)

      earnedTotal = state.rebalanceResults[0].add(state.rebalanceResults[1].mul(price).div(parseUnits('1', 6)))

      const fees = await strategy3.getFees()

      earnedTotal = earnedTotal.add(fees[0].add(fees[1].mul(price).div(parseUnits('1', 6))))

      expect(await strategy3.isReadyToHardWork()).eq(true);

      const hwReturns = await strategy3.connect(splitterSigner).callStatic.doHardWork()

      expect(hwReturns[0].div(100)).eq(earnedTotal.div(100))
      expect(hwReturns[1].div(1000)).eq(state.rebalanceResults[2].div(1000))

      await strategy3.connect(splitterSigner).doHardWork();

      expect(await strategy3.isReadyToHardWork()).eq(false);
    });

    it('Hardwork test for reverse tokens order pool', async() => {
      const platformVoter = await DeployerUtilsLocal.impersonate(await controller.platformVoter());
      await strategy2.connect(platformVoter).setCompoundRatio(100000); // 100%
      const converter = TetuConverter__factory.connect(getConverterAddress(), signer);
      const converterController = IConverterController__factory.connect(await converter.controller(), signer);
      const converterGovernance = await DeployerUtilsLocal.impersonate(await converterController.governance());
      const borrowManager = IBorrowManager__factory.connect(
        await converterController.borrowManager(),
        converterGovernance,
      );
      await converterController.connect(converterGovernance).setMinHealthFactor2(102);
      await converterController.connect(converterGovernance).setTargetHealthFactor2(112);
      await borrowManager.setTargetHealthFactors([MaticAddresses.USDC_TOKEN, MaticAddresses.WMATIC_TOKEN], [112, 112]);
      const investAmount = _1_000;
      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault2.splitter());

      console.log('Deposit 1k USDC...');
      await vault2.deposit(investAmount, signer.address);

      // const totalAssetsBefore = await vault2.totalAssets()
      console.log('Vault totalAssets', await vault2.totalAssets());
      console.log('Strategy totalAssets', await strategy2.totalAssets());
      // console.log(await strategy2.callStatic.calcInvestedAssets())

      await UniswapV3StrategyUtils.makeVolume(signer2, strategy2.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('500000', 6));

      console.log('Vault totalAssets', await vault2.totalAssets());
      console.log('Strategy totalAssets', await strategy2.totalAssets());

      expect(await strategy2.needRebalance()).eq(false);
      expect(await strategy2.isReadyToHardWork()).eq(true);
      await strategy2.connect(splitterSigner).doHardWork();
      expect(await strategy2.isReadyToHardWork()).eq(false);

      console.log('Vault totalAssets', await vault2.totalAssets());
      console.log('Strategy totalAssets', await strategy2.totalAssets());
    });

    /*it('deposit / withdraw, fees, totalAssets + check insurance and LossCovered', async() => {
     // after insurance logic changed this test became incorrect

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
     let expectedAssets: BigNumber
     let extractedFee: BigNumber

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
     extractedFee = _1.mul(FEE_DENOMINATOR).div(FEE_DENOMINATOR.sub(withdrawFee)).sub(_1)
     expect(totalAssetsDiff.sub(extractedFee)).eq(_1)
     totalWithdrawFee = totalWithdrawFee.add(extractedFee)

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
     expectedAssets = totalDeposited.sub(totalDeposited.mul(depositFee).div(FEE_DENOMINATOR)).sub(_1).sub(totalWithdrawFee)
     // console.log('totalAssets()', await vault.totalAssets())
     // console.log('expectedAssets', expectedAssets)
     expect(await vault.totalAssets()).gte(expectedAssets.sub(1))
     expect(await vault.totalAssets()).lte(expectedAssets.add(1))

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
     extractedFee = _1_000.mul(FEE_DENOMINATOR).div(FEE_DENOMINATOR.sub(withdrawFee)).sub(_1_000)
     expect(totalAssetsDiff.sub(extractedFee)).eq(_1_000)
     totalWithdrawFee = totalWithdrawFee.add(extractedFee)

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
     })*/

    /*it('deposit / withdraw, fees, totalAssets for reverse tokens order pool', async() => {
     // after insurance logic changed this test became incorrect

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
  });
});
