import chai from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre, { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  IBorrowManager__factory,
  IController,
  IConverterController__factory,
  IERC20,
  IERC20__factory,
  IERC20Metadata__factory,
  IStrategyV2,
  ISwapper,
  ISwapper__factory,
  TetuConverter__factory,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
  VaultFactory__factory,
} from '../../../../typechain';
import { BigNumber } from 'ethers';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { PolygonAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { getConverterAddress, Misc } from '../../../../scripts/utils/Misc';
import { TokenUtils } from '../../../../scripts/utils/TokenUtils';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";

const { expect } = chai;

describe('UniswapV3ConverterStrategyTests', function() {

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
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    // await HardhatUtils.switchToMostCurrentBlock();

    snapshotBefore = await TimeUtils.snapshot();

    [signer, signer2, signer3] = await ethers.getSigners();
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);
    await InjectUtils.injectTetuConverterBeforeAnyTest(signer);

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
      // +-0.1% price - rebalance
      const rebalanceRange = 10;

      await _strategy.init(
        core.controller,
        _splitterAddress,
        converterAddress,
        poolAddress,
        range,
        rebalanceRange,
        [0, 0, Misc.MAX_UINT, 0]
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
      300,
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
        [0, 0, Misc.MAX_UINT, 0]
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
        [0, 0, Misc.MAX_UINT, 0]
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

    let profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.WETH_TOKEN])
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)
    profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy2.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.WMATIC_TOKEN])
    await strategy2.connect(operator).setStrategyProfitHolder(profitHolder.address)
    profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy3.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN])
    await strategy3.connect(operator).setStrategyProfitHolder(profitHolder.address)

    await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.WETH_TOKEN, parseUnits('1', 10));
    await strategy3.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, 1000);
  });

  after(async function() {
    await HardhatUtils.restoreBlockFromEnv();
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  describe('UniswapV3 strategy tests', function() {
    it('Rebalance and hardwork with earned/lost checks for stable pool', async() => {
      const investAmount = _10_000;
      const swapAssetValueForPriceMove = parseUnits('500000', 6);
      let state = await PackedData.getDefaultState(strategy3);
      const decimalsB = await IERC20Metadata__factory.connect(state.tokenB, signer).decimals();

      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault3.splitter());
      let price;
      price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, parseUnits("1", decimalsB));
      console.log('tokenB price', formatUnits(price, 6));

      console.log('deposit...');
      await vault3.deposit(investAmount, signer.address);

      await UniversalUtils.movePoolPriceUp(signer2, state, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAssetValueForPriceMove);
      await strategy3.rebalanceNoSwaps(true, { gasLimit: 10_000_000 });
      price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, parseUnits("1", decimalsB));

      await UniversalUtils.movePoolPriceDown(signer2, state, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAssetValueForPriceMove.mul(parseUnits('1', 6)).div(price));
      await strategy3.rebalanceNoSwaps(true, { gasLimit: 10_000_000 });

      await UniversalUtils.makePoolVolume(signer2, state, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('100000', 6));

      state = await PackedData.getDefaultState(strategy3);
      const specificState = await PackedData.getSpecificStateUniv3(strategy3);

      price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, parseUnits("1", decimalsB));

      let earnedTotal = BigNumber.from(0)

      earnedTotal = specificState.rebalanceEarned0.add(specificState.rebalanceEarned1.mul(price).div(parseUnits('1', 6)))

      const fees = await strategy3.getFees()

      earnedTotal = earnedTotal.add(fees[0].add(fees[1].mul(price).div(parseUnits('1', 6))))

      expect(await strategy3.isReadyToHardWork()).eq(true);

      const hwReturns = await strategy3.connect(splitterSigner).callStatic.doHardWork()

      // 1252818 ~ 1252796
      expect(hwReturns[0]).approximately(earnedTotal, 1000);
      // expect(hwReturns[0].div(100)).eq(earnedTotal.div(100))
      // expect(hwReturns[1].div(1000)).eq(specificState.rebalanceLost.div(1000))

      await strategy3.connect(splitterSigner).doHardWork();

      expect(await strategy3.isReadyToHardWork()).eq(false);
    });

    /**
     * Currently USDC-WMATIC pool is not used, so the test is skipped.
     */
    it.skip('Hardwork test for reverse tokens order pool', async() => {
      const platformVoter = await DeployerUtilsLocal.impersonate(await controller.platformVoter());
      await strategy2.connect(platformVoter).setCompoundRatio(100000); // 100%
      const state = await PackedData.getDefaultState(strategy2);
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

      await UniversalUtils.makePoolVolume(signer2, state, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('500000', 6));

      console.log('Vault totalAssets', await vault2.totalAssets());
      console.log('Strategy totalAssets', await strategy2.totalAssets());

      expect(await strategy2.needRebalance()).eq(false);
      expect(await strategy2.isReadyToHardWork()).eq(true);
      await strategy2.connect(splitterSigner).doHardWork();

      // SCB-776: now we allow isReadyToHardWork() returns true just after calling hardwork()
      // expect(await strategy2.isReadyToHardWork()).eq(false);

      console.log('Vault totalAssets', await vault2.totalAssets());
      console.log('Strategy totalAssets', await strategy2.totalAssets());
    });
  });
});
