/* tslint:disable:no-trailing-whitespace */
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  BorrowManager,
  CErc20Immutable,
  CompPriceOracleImitator,
  Comptroller,
  ControllerV2,
  ControllerV2__factory,
  ConverterController,
  ForwarderV3__factory,
  HfPlatformAdapter,
  HfPoolAdapter,
  IERC20Metadata__factory,
  InvestFundV2__factory,
  IUniswapV3Pool__factory,
  JumpRateModelV2,
  MockToken,
  MultiBribe__factory,
  MultiGauge,
  MultiGauge__factory,
  PlatformVoter__factory,
  PriceOracleImitator,
  ProxyControlled,
  StrategySplitterV2__factory,
  TetuConverter,
  TetuLiquidator,
  TetuLiquidator__factory,
  TetuVaultV2,
  TetuVaultV2__factory,
  TetuVoter__factory,
  Uni3Swapper,
  Uni3Swapper__factory,
  UniswapV3Callee,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
  UniswapV3Factory,
  UniswapV3Lib,
  UniswapV3Pool,
  UniswapV3Pool__factory,
  VaultFactory,
  VeDistributor,
  VeDistributor__factory,
  VeTetu,
  VeTetu__factory,
} from '../../../../typechain';
import { formatUnits, getAddress, parseUnits } from 'ethers/lib/utils';
import { Controller as LiquidatorController } from '../../../../typechain/@tetu_io/tetu-liquidator/contracts';
import {
  ProxyControlled as ProxyControlled_1_0_0,
} from '../../../../typechain/@tetu_io/tetu-liquidator/contracts/proxy';
import { IPoolLiquiditySnapshot, TransactionType, UniswapV3Utils } from '../../../../scripts/utils/UniswapV3Utils';
import { BigNumber } from 'ethers';
import { RunHelper } from '../../../../scripts/utils/RunHelper';
import { Misc } from '../../../../scripts/utils/Misc';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { config as dotEnvConfig } from 'dotenv';
import {expect} from "chai";

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

describe('UmiswapV3 converter strategy backtester', function() {
  // ==== backtest config ====
  // 38500000 - Jan-25-2023 07:13:46 AM +UTC
  // 40200000 - Mar-10-2023 11:13:15 PM +UTC (before USDC price drop start, need liquiditySnapshotSurroundingTickSpacings = 2000 - 20%, for other periods 200 - 2% is enough)
  // 40360000 - Mar-15-2023 03:54:49 AM +UTC (after USDC price drop end)
  // 40600000 - Mar-21-2023 12:12:51 PM +UTC (after USDC full peg recovery)
  // 41100000 - Apr-03-2023 03:29:23 PM +UTC
  // 41150000 - Apr-04-2023 10:43:06 PM +UTC
  // 41210000 - Apr-06-2023 11:23:04 AM +UTC
  const backtestStartBlock = 41524672;
  const backtestEndBlock = 41562855;
  const investAmountUnits: string = '1000' // 1k USDC, 1k WMATIC etc
  const txLimit = 0; // 0 - unlimited
  const disableBurns = false; // backtest is 5x slower with enabled burns for volatile pools
  const disableMints = false;

  const strategies = [
    // USDC vault
    /*{
      vaultAsset: MaticAddresses.USDC_TOKEN,
      pool: MaticAddresses.UNISWAPV3_USDC_WETH_500,
      token0: MaticAddresses.USDC_TOKEN,
      token1: MaticAddresses.WETH_TOKEN,
      poolFee: 500, // 0.05%
      liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
      tickRange: 1200, // 1200*0.01% == +- 12% price
      rebalanceTickRange: 40, // 40*0.01% == 0.4% price change
    },*/
    /*{
      vaultAsset: MaticAddresses.USDC_TOKEN,
      pool: MaticAddresses.UNISWAPV3_WMATIC_USDC_500, // WMATIC_USDC_0.05%
      token0: MaticAddresses.WMATIC_TOKEN,
      token1: MaticAddresses.USDC_TOKEN,
      poolFee: 500, // 0.05%
      liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
      tickRange: 1200, // 1200*0.01% == +- 12% price
      rebalanceTickRange: 60, // 60*0.01% == 0.6% price change
    },*/
    /*{
      vaultAsset: MaticAddresses.USDC_TOKEN,
      pool: MaticAddresses.UNISWAPV3_WMATIC_USDC_3000, // WMATIC_USDC_0.3%
      token0: MaticAddresses.WMATIC_TOKEN,
      token1: MaticAddresses.USDC_TOKEN,
      poolFee: 3000, // 0.3%
      liquiditySnapshotSurroundingTickSpacings: 50, // 50*60*0.01% == +-30% price
      tickRange: 1200,
      rebalanceTickRange: 60,
    },*/
    /*{
      vaultAsset: MaticAddresses.USDC_TOKEN,
      pool: MaticAddresses.UNISWAPV3_USDC_DAI_100, // USDC_DAI_0.01%
      token0: MaticAddresses.USDC_TOKEN,
      token1: MaticAddresses.DAI_TOKEN,
      poolFee: 100, // 0.01%
      liquiditySnapshotSurroundingTickSpacings: 200, // 200*1*0.01% == +-2% price
      tickRange: 0, // 1 tick
      rebalanceTickRange: 0, // 1 tick
    },*/
    {
      vaultAsset: MaticAddresses.USDC_TOKEN,
      pool: MaticAddresses.UNISWAPV3_USDC_USDT_100, // USDC_USDT_0.01%
      token0: MaticAddresses.USDC_TOKEN,
      token1: MaticAddresses.USDT_TOKEN,
      poolFee: 100, // 0.01%
      liquiditySnapshotSurroundingTickSpacings: 200, // 200*1*0.01% == +-2% price
      tickRange: 0, // 1 tick
      rebalanceTickRange: 0, // 1 tick
    },
    /*{
      vaultAsset: MaticAddresses.USDC_TOKEN,
      pool: MaticAddresses.UNISWAPV3_USDC_miMATIC_100, // USDC_miMATIC_0.01%
      token0: MaticAddresses.USDC_TOKEN,
      token1: MaticAddresses.miMATIC_TOKEN,
      poolFee: 100, // 0.01%
      liquiditySnapshotSurroundingTickSpacings: 200, // 200*1*0.01% == +-2% price
      tickRange: 1, // 2 ticks
      rebalanceTickRange: 1, // 1 tick
    },*/
    // WMATIC vault
    /*{
      vaultAsset: MaticAddresses.WMATIC_TOKEN,
      pool: MaticAddresses.UNISWAPV3_WMATIC_WETH_500, // WMATIC_WETH_0.05%
      token0: MaticAddresses.WMATIC_TOKEN,
      token1: MaticAddresses.WETH_TOKEN,
      poolFee: 500, // 0.05%
      liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
      tickRange: 1200, // +- 12% price
      rebalanceTickRange: 60, // 0.6% price change
    },*/
  ]
  // =========================

  const data: {
    liquiditySnapshot: IPoolLiquiditySnapshot,
    pool: UniswapV3Pool,
  }[] = []

  const tokens: {[realAddress: string]: MockToken} = {}

  const strategyData: {
    vault: TetuVaultV2,
    strategy: UniswapV3ConverterStrategy,
  }[] = []

  // time snapshots
  let snapshot: string;
  let snapshotBefore: string;

  // signers
  let signer: SignerWithAddress;
  let user: SignerWithAddress;

  // tokens
  let USDC: MockToken;

  // uniswap v3
  let uniswapV3Factory: UniswapV3Factory;
  let uniswapV3Calee: UniswapV3Callee;
  let uniswapV3Helper: UniswapV3Lib;

  // compound
  let compPriceOracleImitator: CompPriceOracleImitator;
  let comptroller: Comptroller;
  let compInterestRateModel: JumpRateModelV2;
  const cTokens: {[realUnderlyingAddress: string]: CErc20Immutable} = {}

  // liquidator
  let liquidator: TetuLiquidator;
  let uni3swapper: Uni3Swapper;

  // price oracle for converter
  let priceOracleImitator: PriceOracleImitator;

  // converter
  let tetuConverter: TetuConverter;

  // tetu v2
  let controller: ControllerV2;
  let gauge: MultiGauge;
  let vaultFactory: VaultFactory;

  const backtestResults: IBacktestResult[] = [];

  if (argv.disableStrategyTests) {
    return;
  }

  if (argv.hardhatChainId !== 31337) {
    console.log('Backtester can only work in the local hardhat network (31337 chainId)');
    return;
  }

  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    let tx;
    [signer, user] = await ethers.getSigners();

    // check strategies vaultAsset
    let vaultAsset: string|undefined
    for (const s of strategies) {
      if (!vaultAsset) {
        vaultAsset = s.vaultAsset
      } else if (vaultAsset !== s.vaultAsset) {
        throw new Error('All backtesting strategies must have same vaultAsset')
      }
    }
    if (!vaultAsset) {
      throw new Error('Empty strategies list')
    }

    // deploy tokens
    const mintAmount = '100000000000'; // 100b
    tokens[MaticAddresses.USDC_TOKEN] = await DeployerUtils.deployMockToken(signer, 'USDC', 6, mintAmount);
    tokens[MaticAddresses.WETH_TOKEN] = await DeployerUtils.deployMockToken(signer, 'WETH', 18, mintAmount);
    tokens[MaticAddresses.WMATIC_TOKEN] = await DeployerUtils.deployMockToken(signer, 'WMATIC', 18, mintAmount);
    tokens[MaticAddresses.DAI_TOKEN] =  await DeployerUtils.deployMockToken(signer, 'DAI', 18, mintAmount);
    tokens[MaticAddresses.USDT_TOKEN] = await DeployerUtils.deployMockToken(signer, 'USDT', 6, mintAmount);
    tokens[MaticAddresses.miMATIC_TOKEN] = await DeployerUtils.deployMockToken(signer, 'miMATIC', 18, mintAmount);
    USDC = tokens[MaticAddresses.USDC_TOKEN]
    // give 10k USDC to user
    await USDC.transfer(user.address, parseUnits('10000', 6));

    // deploy uniswap v3 and periphery
    uniswapV3Factory = await DeployerUtils.deployContract(signer, 'UniswapV3Factory') as UniswapV3Factory;
    uniswapV3Helper = await DeployerUtils.deployContract(signer, 'UniswapV3Lib') as UniswapV3Lib;
    uniswapV3Calee = await DeployerUtils.deployContract(signer, 'UniswapV3Callee') as UniswapV3Callee;
    for (const [, token] of Object.entries(tokens)) {
      await token.approve(uniswapV3Calee.address, Misc.MAX_UINT)
    }

    // fetch liquidity snapshots, deploy and initialize pools
    for (const testStrategy of strategies) {
      const liquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(
        getAddress(testStrategy.pool),
        backtestStartBlock,
        testStrategy.liquiditySnapshotSurroundingTickSpacings,
      );
      await (await uniswapV3Factory.createPool(tokens[testStrategy.token0].address, tokens[testStrategy.token1].address, testStrategy.poolFee)).wait();
      const pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(
        tokens[testStrategy.token0].address,
        tokens[testStrategy.token1].address,
        testStrategy.poolFee,
      ), signer)
      await pool.initialize(liquiditySnapshot.currentSqrtPriceX96);
      data.push({
        liquiditySnapshot,
        pool,
      })
    }

    // TETU token and tetuAsset pool need for strategy testing with compoundRatio < 100%
    const tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    await (await uniswapV3Factory.createPool(tetu.address, tokens[vaultAsset].address, 500)).wait();
    const tetuAsset500Pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(
      tetu.address,
      tokens[vaultAsset].address,
      500,
    ), signer);
    await tetu.approve(uniswapV3Calee.address, Misc.MAX_UINT);
    await tetuAsset500Pool.initialize('79224306130848112672356'); // 1:1
    await uniswapV3Calee.mint(tetuAsset500Pool.address, signer.address, -277280, -275370, '21446390278959920000');

    // deploy tetu liquidator and setup
    const liquidatorController = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-liquidator/contracts/Controller.sol:Controller',
    ) as LiquidatorController;
    const liquidatorLogic = await DeployerUtils.deployContract(signer, 'TetuLiquidator');
    const liquidatorProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-liquidator/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled_1_0_0;
    tx = await liquidatorProxy.initProxy(liquidatorLogic.address);
    await tx.wait();
    liquidator = TetuLiquidator__factory.connect(liquidatorProxy.address, signer);
    tx = await liquidator.init(liquidatorController.address);
    await tx.wait();
    const uni3swapperLogic = await DeployerUtils.deployContract(signer, 'Uni3Swapper');
    const uni3swapperProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-liquidator/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled_1_0_0;
    tx = await uni3swapperProxy.initProxy(uni3swapperLogic.address);
    await tx.wait();
    uni3swapper = Uni3Swapper__factory.connect(uni3swapperProxy.address, signer);
    tx = await uni3swapper.init(liquidatorController.address);
    await tx.wait();

    const liquidatorPools: {
      pool: string,
      swapper: string,
      tokenIn: string,
      tokenOut: string,
    }[] = []

    for (const item of data) {
      liquidatorPools.push({
        pool: item.pool.address,
        swapper: uni3swapper.address,
        tokenIn: await item.pool.token0(),
        tokenOut: await item.pool.token1(),
      })
      liquidatorPools.push({
        pool: item.pool.address,
        swapper: uni3swapper.address,
        tokenIn: await item.pool.token1(),
        tokenOut: await item.pool.token0(),
      })
    }
    liquidatorPools.push({
      pool: tetuAsset500Pool.address,
      swapper: uni3swapper.address,
      tokenIn: tetu.address,
      tokenOut: tokens[vaultAsset].address,
    })
    await liquidator.addLargestPools(liquidatorPools, true);

    // deploy Compound and put liquidity
    compPriceOracleImitator = await DeployerUtils.deployContract(
      signer,
      'CompPriceOracleImitator',
      tokens[vaultAsset].address,// USDC.address,
      liquidator.address,
    ) as CompPriceOracleImitator;
    comptroller = await DeployerUtils.deployContract(signer, 'Comptroller') as Comptroller;
    await comptroller._setPriceOracle(compPriceOracleImitator.address);
    // baseRatePerYear, multiplierPerYear, jumpMultiplierPerYear, kink_, owner_
    compInterestRateModel = await DeployerUtils.deployContract(
      signer,
      'JumpRateModelV2',
      '1'/*'9512937595'*/,
      '1',
      '1',
      '1',
      signer.address,
    ) as JumpRateModelV2;

    for (const [realTokenAddress, token] of Object.entries(tokens)) {
      const cToken = await DeployerUtils.deployContract(
        signer,
        'CErc20Immutable',
        token.address,
        comptroller.address,
        compInterestRateModel.address,
        parseUnits('1', (await token.decimals()) + 8),
        `Compound ${await token.symbol()}`,
        `c${await token.symbol()}`,
        8,
        signer.address,
      ) as CErc20Immutable;
      cTokens[realTokenAddress] = cToken
      await comptroller._supportMarket(cToken.address);
      await comptroller._setCollateralFactor(cToken.address, parseUnits('0.9'));
      await token.approve(cToken.address, Misc.MAX_UINT)
      await comptroller.enterMarkets([cToken.address])
      await cToken.mint(parseUnits('500000', await token.decimals()));
      console.log(`Comp oracle ${await token.symbol()} price: ${await compPriceOracleImitator.getUnderlyingPrice(cToken.address)}`)
    }

    // deploy price oracle for converter
    priceOracleImitator = await DeployerUtils.deployContract(
      signer,
      'PriceOracleImitator',
      tokens[vaultAsset].address,
      liquidator.address,
    ) as PriceOracleImitator;

    // console.log(await priceOracleImitator.getAssetPrice(tokens[MaticAddresses.WMATIC_TOKEN].address))
    // console.log(await priceOracleImitator.getAssetPrice(tokens[MaticAddresses.WETH_TOKEN].address))

    // deploy tetu converter and setup
    const converterController = await DeployerUtils.deployContract(
      signer,
      'ConverterController',
      liquidator.address,
      priceOracleImitator.address,
    ) as ConverterController;
    const borrowManager = await DeployerUtils.deployContract(
      signer,
      'BorrowManager',
      converterController.address,
      parseUnits('0.9'),
    ) as BorrowManager;
    const debtMonitor = await DeployerUtils.deployContract(
      signer,
      'DebtMonitor',
      converterController.address,
      borrowManager.address,
    );
    const swapManager = await DeployerUtils.deployContract(
      signer,
      'SwapManager',
      converterController.address,
      liquidator.address,
      priceOracleImitator.address,
    );
    const keeperCaller = await DeployerUtils.deployContract(signer, 'KeeperCaller');
    const keeper = await DeployerUtils.deployContract(
      signer,
      'Keeper',
      converterController.address,
      keeperCaller.address,
      2 * 7 * 24 * 60 * 60,
    );
    tetuConverter = await DeployerUtils.deployContract(
      signer,
      'TetuConverter',
      converterController.address,
      borrowManager.address,
      debtMonitor.address,
      swapManager.address,
      keeper.address,
      priceOracleImitator.address,
    ) as TetuConverter;
    await converterController.initialize(
      signer.address,
      41142,
      101,
      120,
      400,
      tetuConverter.address,
      borrowManager.address,
      debtMonitor.address,
      keeper.address,
      swapManager.address,
      1000
    );
    const poolAdapter = await DeployerUtils.deployContract(signer, 'HfPoolAdapter') as HfPoolAdapter;
    const platformAdapter = await DeployerUtils.deployContract(
      signer,
      'HfPlatformAdapter',
      converterController.address,
      borrowManager.address,
      comptroller.address,
      poolAdapter.address,
      Object.entries(cTokens).map(e => e[1].address)// [cUSDC.address, cWETH.address, cWMATIC.address, cDAI.address, cUSDT.address],
    ) as HfPlatformAdapter;
    const assetsPairs = generateAssetPairs(Object.entries(tokens).map(e => e[1].address)/*[USDC.address, WETH.address, WMATIC.address, DAI.address, USDT.address]*/);
    tx = await borrowManager.addAssetPairs(platformAdapter.address, assetsPairs.leftAssets, assetsPairs.rightAssets);
    await tx.wait();

    // deploy Tetu V2 system
    const controllerLogic = await DeployerUtils.deployContract(signer, 'ControllerV2') as ControllerV2;
    const controllerProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled;
    tx = await controllerProxy.initProxy(controllerLogic.address);
    await tx.wait();
    controller = ControllerV2__factory.connect(controllerProxy.address, signer);
    tx = await controller.init(signer.address);
    await tx.wait();
    const veTetuLogic = await DeployerUtils.deployContract(signer, 'VeTetu') as VeTetu;
    const veTetuProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled;
    tx = await veTetuProxy.initProxy(veTetuLogic.address);
    await tx.wait();
    const veTetu = VeTetu__factory.connect(veTetuProxy.address, signer);
    tx = await veTetu.init(tetu.address, BigNumber.from(1000), controller.address);
    await tx.wait();
    const veDistLogic = await DeployerUtils.deployContract(signer, 'VeDistributor') as VeDistributor;
    const veDistProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled;
    tx = await veDistProxy.initProxy(veDistLogic.address);
    await tx.wait();
    const veDist = VeDistributor__factory.connect(veDistProxy.address, signer);
    tx = await veDist.init(controller.address, veTetu.address, tetu.address);
    await tx.wait();
    const gaugeLogic = await DeployerUtils.deployContract(signer, 'MultiGauge');
    const gaugeProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled;
    tx = await gaugeProxy.initProxy(gaugeLogic.address);
    await tx.wait();
    gauge = MultiGauge__factory.connect(gaugeProxy.address, signer);
    tx = await gauge.init(controller.address, veTetu.address, tetu.address);
    await tx.wait();
    const bribeLogic = await DeployerUtils.deployContract(signer, 'MultiBribe');
    const bribeProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled;
    tx = await bribeProxy.initProxy(bribeLogic.address);
    await tx.wait();
    const bribe = MultiBribe__factory.connect(bribeProxy.address, signer);
    tx = await bribe.init(controller.address, veTetu.address, tetu.address);
    await tx.wait();
    const tetuVoterLogic = await DeployerUtils.deployContract(signer, 'TetuVoter');
    const tetuVoterProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled;
    tx = await tetuVoterProxy.initProxy(tetuVoterLogic.address);
    await tx.wait();
    const tetuVoter = TetuVoter__factory.connect(tetuVoterProxy.address, signer);
    tx = await tetuVoter.init(controller.address, veTetu.address, tetu.address, gauge.address, bribe.address);
    await tx.wait();
    const platformVoterLogic = await DeployerUtils.deployContract(signer, 'PlatformVoter');
    const platformVoterProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled;
    tx = await platformVoterProxy.initProxy(platformVoterLogic.address);
    await tx.wait();
    const platformVoter = PlatformVoter__factory.connect(platformVoterProxy.address, signer);
    tx = await platformVoter.init(controller.address, veTetu.address);
    await tx.wait();
    const forwarderLogic = await DeployerUtils.deployContract(signer, 'ForwarderV3');
    const forwarderProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled;
    tx = await forwarderProxy.initProxy(forwarderLogic.address);
    await tx.wait();
    const forwarder = ForwarderV3__factory.connect(forwarderProxy.address, signer);
    tx = await forwarder.init(controller.address, tetu.address, bribe.address);
    await tx.wait();
    const investFundLogic = await DeployerUtils.deployContract(signer, 'InvestFundV2');
    const investFundProxy = await DeployerUtils.deployContract(
      signer,
      '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled',
    ) as ProxyControlled;
    tx = await investFundProxy.initProxy(investFundLogic.address);
    await tx.wait();
    const investFund = InvestFundV2__factory.connect(investFundProxy.address, signer);
    tx = await investFund.init(controller.address);
    await tx.wait();
    const vaultImpl = await DeployerUtils.deployContract(signer, 'TetuVaultV2');
    const vaultInsuranceImpl = await DeployerUtils.deployContract(signer, 'VaultInsurance');
    const splitterImpl = await DeployerUtils.deployContract(signer, 'StrategySplitterV2');
    vaultFactory = await DeployerUtils.deployContract(
      signer,
      'VaultFactory',
      controller.address,
      vaultImpl.address,
      vaultInsuranceImpl.address,
      splitterImpl.address,
    ) as VaultFactory;
    tx = await controller.announceAddressChange(2, tetuVoter.address);
    await tx.wait();
    tx = await controller.announceAddressChange(3, platformVoter.address);
    await tx.wait();
    tx = await controller.announceAddressChange(4, liquidator.address);
    await tx.wait();
    tx = await controller.announceAddressChange(5, forwarder.address);
    await tx.wait();
    tx = await controller.announceAddressChange(6, investFund.address);
    await tx.wait();
    tx = await controller.announceAddressChange(7, veDist.address);
    await tx.wait();
    tx = await controller.changeAddress(2);
    await tx.wait();
    tx = await controller.changeAddress(3);
    await tx.wait();
    tx = await controller.changeAddress(4);
    await tx.wait();
    tx = await controller.changeAddress(5);
    await tx.wait();
    tx = await controller.changeAddress(6);
    await tx.wait();
    tx = await controller.changeAddress(7);
    await tx.wait();

    // deploy strategies
    let vaultStrategyInfo: IVaultUniswapV3StrategyInfo;
    const platformVoterSigner = await DeployerUtilsLocal.impersonate(await controller.platformVoter());

    for (let i = 0; i < strategies.length; i++) {
      const token0 = IERC20Metadata__factory.connect(await data[i].pool.token0(), signer);
      const token1 = IERC20Metadata__factory.connect(await data[i].pool.token1(), signer);
      const vaultAssetAddress = tokens[strategies[i].vaultAsset].address
      vaultStrategyInfo = await deployAndInitVaultAndUniswapV3Strategy(
        vaultAssetAddress,
        `TetuV2_UniswapV3_${await token0.symbol()}-${await token1.symbol()}-${strategies[i].poolFee}`,
        controller,
        gauge,
        vaultFactory,
        tetuConverter.address,
        signer,
        data[i].pool.address,
        strategies[i].tickRange,
        strategies[i].rebalanceTickRange,
      );
      await vaultStrategyInfo.strategy.connect(platformVoterSigner).setCompoundRatio(100000); // 100%
      await converterController.setWhitelistValues([vaultStrategyInfo.strategy.address,], true)
      strategyData.push({
        vault: vaultStrategyInfo.vault,
        strategy: vaultStrategyInfo.strategy,
      })
    }
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
    if (backtestResults.length > 0) {
      console.log('');
      console.log('');
      console.log(`=== Uniswap V3 delta-neutral strategy backtester ===`);
      console.log('');
      for (const r of backtestResults) {
        showBacktestResult(r);
      }
    }
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  it('Backtesting', async function() {
    for (let i = 0; i < strategies.length; i++) {
      const result = await strategyBacktest(
        signer,
        strategyData[i].vault,
        strategyData[i].strategy,
        uniswapV3Calee,
        uniswapV3Helper,
        data[i].liquiditySnapshot,
        investAmountUnits,
        backtestStartBlock,
        backtestEndBlock,
        strategies[i].pool,
        txLimit,
        disableBurns,
        disableMints,
      )
      backtestResults.push(result)
    }
  })
});

function generateAssetPairs(tokens: string[]): IPlatformAdapterAssets {
  const leftAssets: string[] = [];
  const rightAssets: string[] = [];
  for (let i = 0; i < tokens.length; ++i) {
    for (let j = i + 1; j < tokens.length; ++j) {
      leftAssets.push(tokens[i]);
      rightAssets.push(tokens[j]);
    }
  }
  return { leftAssets, rightAssets };
}

interface IPlatformAdapterAssets {
  leftAssets: string[];
  rightAssets: string[];
}

interface IVaultUniswapV3StrategyInfo {
  vault: TetuVaultV2,
  strategy: UniswapV3ConverterStrategy
}

interface IBacktestResult {
  vaultName: string;
  vaultAssetSymbol: string;
  vaultAssetDecimals: number;
  tickRange: number;
  rebalanceTickRange: number;
  startTimestamp: number;
  endTimestamp: number;
  investAmount: BigNumber;
  earned: BigNumber;
  rebalances: number;
  startPrice: BigNumber;
  endPrice: BigNumber;
  maxPrice: BigNumber;
  minPrice: BigNumber;
  backtestLocalTimeSpent: number;
  tokenBSymbol: string;
  disableBurns: boolean;
  disableMints: boolean;
}

function showBacktestResult(r: IBacktestResult) {
  console.log(`Strategy ${r.vaultName}. Tick range: ${r.tickRange} (+-${r.tickRange /
  100}% price). Rebalance tick range: ${r.rebalanceTickRange} (+-${r.rebalanceTickRange / 100}% price).`);
  const earnedPerSec1e10 = r.earned.mul(parseUnits('1', 10)).div(r.endTimestamp - r.startTimestamp);
  const earnedPerDay = earnedPerSec1e10.mul(86400).div(parseUnits('1', 10));
  const apr = earnedPerDay.mul(365).mul(100000000).div(r.investAmount).div(1000);
  console.log(`APR: ${formatUnits(apr, 3)}%. Invest amount: ${formatUnits(
    r.investAmount,
    r.vaultAssetDecimals,
  )} ${r.vaultAssetSymbol}. Earned: ${formatUnits(r.earned, r.vaultAssetDecimals)} ${r.vaultAssetSymbol}. Rebalances: ${r.rebalances}.`);
  console.log(`Period: ${periodHuman(r.endTimestamp - r.startTimestamp)}. Start: ${new Date(r.startTimestamp *
    1000).toLocaleDateString('en-US')} ${new Date(r.startTimestamp *
    1000).toLocaleTimeString('en-US')}. Finish: ${new Date(r.endTimestamp *
    1000).toLocaleDateString('en-US')} ${new Date(r.endTimestamp * 1000).toLocaleTimeString('en-US')}.`);
  console.log(`Start price of ${r.tokenBSymbol}: ${formatUnits(r.startPrice, r.vaultAssetDecimals)}. End price: ${formatUnits(
    r.endPrice,
    r.vaultAssetDecimals,
  )}. Min price: ${formatUnits(r.minPrice, r.vaultAssetDecimals)}. Max price: ${formatUnits(r.maxPrice, r.vaultAssetDecimals)}.`);
  console.log(`Mints: ${!r.disableMints ? 'enabled' : 'disabled'}. Burns: ${!r.disableBurns
    ? 'enabled'
    : 'disabled'}.`);
  console.log(`Time spent for backtest: ${periodHuman(r.backtestLocalTimeSpent)}.`);
  console.log('');
}

function periodHuman(periodSecs: number) {
  const periodMins = Math.floor(periodSecs / 60);
  const periodHours = Math.floor(periodMins / 60);
  const periodDays = Math.floor(periodHours / 24);
  let periodStr = '';
  if (periodDays) {
    periodStr += `${periodDays}d `;
  }
  if (periodHours) {
    periodStr += `${periodHours - periodDays * 24}h:`;
  }
  periodStr += `${periodMins - periodHours * 60}m`;
  if (!periodDays && !periodHours) {
    if (periodMins) {
      periodStr += ':';
    }
    periodStr += `${periodSecs - periodMins * 60}s`;
  }
  return periodStr;
}

async function utilizationRate(
  strategy: UniswapV3ConverterStrategy,
  signer: SignerWithAddress,
  uniswapV3Helper: UniswapV3Lib,
) {
  const state = await strategy.getState();
  const tokenA = IERC20Metadata__factory.connect(state.tokenA, signer);
  const tokenB = IERC20Metadata__factory.connect(state.tokenB, signer);
  const price = await uniswapV3Helper.getPrice(state.pool, tokenB.address);
  const total = await strategy.totalAssets();
  const used = total.sub((await tokenA.balanceOf(strategy.address)).add((await tokenB.balanceOf(strategy.address)).mul(
    price).div(parseUnits('1', await tokenB.decimals()))));
  const rate = used.mul(10000).div(total);
  return `${formatUnits(rate, 2)}%`;
}

async function deployAndInitVaultAndUniswapV3Strategy<T>(
  asset: string,
  vaultName: string,
  controller: ControllerV2,
  gauge: MultiGauge,
  vaultFactory: VaultFactory,
  converterAddress: string,
  signer: SignerWithAddress,
  uniswapV3PoolAddress: string,
  range: number,
  rebalanceRange: number,
  buffer = 0,
  depositFee = 0,
  withdrawFee = 0,
  wait = false,
): Promise<IVaultUniswapV3StrategyInfo> {
  console.log('deployAndInitVaultAndUniswapV3Strategy', vaultName);

  await RunHelper.runAndWait(() => vaultFactory.createVault(
    asset,
    vaultName,
    vaultName,
    gauge.address,
    buffer,
  ), true, wait);
  const l = (await vaultFactory.deployedVaultsLength()).toNumber();
  const vaultAddress = await vaultFactory.deployedVaults(l - 1);
  console.log(l, 'VAULT: ', vaultAddress);
  const vault = TetuVaultV2__factory.connect(vaultAddress, signer);

  console.log('setFees', depositFee, withdrawFee);
  await RunHelper.runAndWait(() =>
      vault.setFees(depositFee, withdrawFee),
    true, wait,
  );

  console.log('registerVault');
  await RunHelper.runAndWait(() =>
      controller.registerVault(vaultAddress),
    true, wait,
  );

  console.log('addStakingToken');
  await RunHelper.runAndWait(() =>
      gauge.addStakingToken(vaultAddress),
    true, wait,
  );

  console.log('+Vault Deployed');

  const splitterAddress = await vault.splitter();
  const splitter = StrategySplitterV2__factory.connect(splitterAddress, signer);

  // await gauge.addStakingToken(vault.address);

  // ADD STRATEGY
  const strategy = UniswapV3ConverterStrategy__factory.connect(
    await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
    signer, // gov
  );
  await strategy.init(
    controller.address,
    splitterAddress,
    converterAddress,
    uniswapV3PoolAddress,
    range,
    rebalanceRange,
  );

  await splitter.addStrategies([strategy.address], [0]);

  return { vault, strategy };
}

async function strategyBacktest(
  signer: SignerWithAddress,
  vault: TetuVaultV2,
  strategy: UniswapV3ConverterStrategy,
  uniswapV3Calee: UniswapV3Callee,
  uniswapV3Helper: UniswapV3Lib,
  liquiditySnapshot: IPoolLiquiditySnapshot,
  investAmountUnits: string,
  backtestStartBlock: number,
  backtestEndBlock: number,
  uniswapV3RealPoolAddress: string,
  txLimit: number = 0,
  disableBurns: boolean = true,
  disableMints: boolean = false,
): Promise<IBacktestResult> {
  const state = await strategy.getState();
  const startTimestampLocal = Math.floor(Date.now() / 1000);
  const tokenA = IERC20Metadata__factory.connect(state.tokenA, signer);
  const tokenADecimals = await tokenA.decimals();
  const tokenB = IERC20Metadata__factory.connect(state.tokenB, signer);
  const pool = IUniswapV3Pool__factory.connect(state.pool, signer);
  const token0 = IERC20Metadata__factory.connect(await pool.token0(), signer);
  const token1 = IERC20Metadata__factory.connect(await pool.token1(), signer);
  const token0Decimals = await token0.decimals();
  const token1Decimals = await token1.decimals();
  const token0Symbol = await token0.symbol();
  const token1Symbol = await token1.symbol();
  const tickSpacing = UniswapV3Utils.getTickSpacing(await pool.fee());
  const investAmount = parseUnits(investAmountUnits, tokenADecimals)

  console.log(`Starting backtest of ${await vault.name()}`);
  console.log(`Filling pool with initial liquidity from snapshot (${liquiditySnapshot.ticks.length} ticks)..`);
  for (const tick of liquiditySnapshot.ticks) {
    if (BigNumber.from(tick.liquidityActive).gt(0)) {
      await uniswapV3Calee.mint(
        pool.address,
        signer.address,
        tick.tickIdx,
        tick.tickIdx + tickSpacing,
        tick.liquidityActive,
      );
    }
  }

  console.log(`Deposit ${await tokenA.symbol()} to vault...`);
  await tokenA.approve(vault.address, Misc.MAX_UINT);
  await vault.deposit(investAmount, signer.address);
  const totalAssetsinStrategyBefore = await strategy.totalAssets();

  const initialState = await strategy.getState()
  expect(initialState.totalLiquidity).gt(0)

  const liquidityTickLower = liquiditySnapshot.ticks[0].tickIdx;
  const liquidityTickUpper = liquiditySnapshot.ticks[liquiditySnapshot.ticks.length - 1].tickIdx;
  const startPrice = await uniswapV3Helper.getPrice(pool.address, tokenB.address);
  let endPrice = startPrice;
  let minPrice = startPrice;
  let maxPrice = startPrice;
  let i = 0;
  let rebalances = 0;
  const poolTxs = await UniswapV3Utils.getPoolTransactions(
    getAddress(uniswapV3RealPoolAddress),
    backtestStartBlock,
    backtestEndBlock,
  );
  const startTimestamp = poolTxs[0].timestamp;
  const txsTotal = txLimit === 0 || txLimit > poolTxs.length ? poolTxs.length : txLimit;
  let endTimestamp = startTimestamp;
  let previousTimestamp = startTimestamp;
  for (const poolTx of poolTxs) {
    i++;
    endTimestamp = poolTx.timestamp;

    if (!disableMints && poolTx.type === TransactionType.MINT && poolTx.tickUpper !== undefined && poolTx.tickLower !==
      undefined) {
      await uniswapV3Calee.mint(
        pool.address,
        signer.address,
        poolTx.tickLower,
        poolTx.tickUpper,
        BigNumber.from(poolTx.amount),
      );

      console.log(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] MINT`);
    }

    if (!disableBurns && poolTx.type === TransactionType.BURN && poolTx.tickUpper !== undefined && poolTx.tickLower !==
      undefined) {
      if (poolTx.tickUpper < liquidityTickLower || poolTx.tickLower > liquidityTickUpper) {
        // burn liquidity not in pool range
        continue;
      }

      if (BigNumber.from(poolTx.amount).eq(0)) {
        // zero burn == collect fees
        continue;
      }

      process.stdout.write(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] BURN`);
      if (poolTx.tickLower < liquidityTickLower || poolTx.tickUpper > liquidityTickUpper) {
        const rangeOrigin = BigNumber.from(poolTx.tickUpper - poolTx.tickLower);
        const newTickUpper = poolTx.tickUpper > liquidityTickUpper ? liquidityTickUpper : poolTx.tickUpper;
        const newTickLower = poolTx.tickLower < liquidityTickLower ? liquidityTickLower : poolTx.tickLower;
        const newRange = BigNumber.from(newTickUpper - newTickLower);
        const newAmount = BigNumber.from(poolTx.amount).mul(newRange).div(rangeOrigin);
        const parts = (newTickUpper - newTickLower) / tickSpacing;
        for (let t = newTickLower; t < newTickUpper - tickSpacing; t += tickSpacing) {
          await pool.burn(t, t + tickSpacing, BigNumber.from(newAmount).div(parts));
          process.stdout.write(`.`);
        }
      } else {
        const parts = (poolTx.tickUpper - poolTx.tickLower) / tickSpacing;
        for (let t = poolTx.tickLower; t < poolTx.tickUpper - tickSpacing; t += tickSpacing) {
          await pool.burn(t, t + tickSpacing, BigNumber.from(poolTx.amount).div(parts));
          process.stdout.write(`.`);
        }
      }
      console.log('');
    }

    if (poolTx.type === TransactionType.SWAP) {
      const swap0to1 = parseUnits(poolTx.amount1, token1Decimals).lt(0);
      const tokenIn = swap0to1 ? token0.address : token1.address;
      const amountIn = swap0to1 ? parseUnits(poolTx.amount0, token0Decimals) : parseUnits(
        poolTx.amount1,
        token1Decimals,
      );
      if (amountIn.eq(0)) {
        console.log(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] Swap zero amount. Skipped.`);
        continue;
      }
      const priceBefore = await uniswapV3Helper.getPrice(pool.address, tokenB.address);
      await uniswapV3Calee.swap(pool.address, signer.address, tokenIn, amountIn);
      const priceAfter = await uniswapV3Helper.getPrice(pool.address, tokenB.address);

      const priceChangeVal = priceAfter.sub(priceBefore).mul(1e15).div(priceBefore).div(1e8);
      const priceChangeStr = priceChangeVal.eq(0) ? '' : ` (${priceAfter.gt(priceBefore) ? '+' : ''}${formatUnits(
        priceChangeVal,
        5,
      )}%)`;
      console.log(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] Swap ${swap0to1
        ? token0Symbol
        : token1Symbol} -> ${swap0to1 ? token1Symbol : token0Symbol}. Price: ${formatUnits(
        priceAfter,
        tokenADecimals,
      )}${priceChangeStr}.`);

      if (priceAfter.gt(maxPrice)) {
        maxPrice = priceAfter;
      }

      if (priceAfter.lt(minPrice)) {
        minPrice = priceAfter;
      }

      endPrice = priceAfter;
    }

    if (previousTimestamp !== poolTx.timestamp) {
      if (await strategy.needRebalance()) {
        rebalances++;
        process.stdout.write(`Rebalance ${rebalances}.. `);
        const tx = await strategy.rebalance();
        const txRes = await tx.wait();
        console.log(`done with ${txRes.gasUsed} gas.`);
      }

      if ((await strategy.getState()).isFuseTriggered) {
        console.log('Fuse enabled!');
        break;
      }
    }

    previousTimestamp = poolTx.timestamp;
    if (i >= txsTotal) {
      break;
    }
  }

  console.log('doHardWork...');
  const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter());
  await strategy.connect(splitterSigner).doHardWork();

  const totalAssetsinStrategyAfter = await strategy.totalAssets();
  const endTimestampLocal = Math.floor(Date.now() / 1000);
  const earned = totalAssetsinStrategyAfter.sub(totalAssetsinStrategyBefore);

  return {
    vaultName: await vault.name(),
    vaultAssetSymbol: await tokenA.symbol(),
    vaultAssetDecimals: tokenADecimals,
    tickRange: (state.upperTick - state.lowerTick) / 2,
    rebalanceTickRange: state.rebalanceTickRange,
    startTimestamp,
    endTimestamp,
    investAmount,
    earned,
    rebalances,
    startPrice,
    endPrice,
    maxPrice,
    minPrice,
    backtestLocalTimeSpent: endTimestampLocal - startTimestampLocal,
    tokenBSymbol: await tokenB.symbol(),
    disableBurns,
    disableMints,
  };
}
