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
import {generateAssetPairs} from "../../../../scripts/utils/ConverterUtils";
import {
  deployAndInitVaultAndUniswapV3Strategy,
} from "../../../../scripts/uniswapV3Backtester/deployBacktestSystem";
import {IBacktestResult, IVaultUniswapV3StrategyInfo} from "../../../../scripts/uniswapV3Backtester/types";
import {showBacktestResult, strategyBacktest} from "../../../../scripts/uniswapV3Backtester/strategyBacktest";

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
  const investAmountUnits: string = '1' // 1k USDC, 1k WMATIC etc
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
    /*{
      vaultAsset: MaticAddresses.USDC_TOKEN,
      pool: MaticAddresses.UNISWAPV3_USDC_USDT_100, // USDC_USDT_0.01%
      token0: MaticAddresses.USDC_TOKEN,
      token1: MaticAddresses.USDT_TOKEN,
      poolFee: 100, // 0.01%
      liquiditySnapshotSurroundingTickSpacings: 200, // 200*1*0.01% == +-2% price
      tickRange: 0, // 1 tick
      rebalanceTickRange: 0, // 1 tick
    },*/
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
      rebalanceTickRange: 320, // 0.6% price change
    },*/
    // WBTC vault
    {
      vaultAsset: MaticAddresses.WETH_TOKEN,
      pool: MaticAddresses.UNISWAPV3_WBTC_WETH_500,
      token0: MaticAddresses.WBTC_TOKEN,
      token1: MaticAddresses.WETH_TOKEN,
      poolFee: 500, // 0.05%
      liquiditySnapshotSurroundingTickSpacings: 200, // 200*10*0.01% == +-20% price
      tickRange: 1200, // +- 12% price
      rebalanceTickRange: 120, // 0.6% price change
    },
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
    tokens[MaticAddresses.WBTC_TOKEN] = await DeployerUtils.deployMockToken(signer, 'WBTC', 8, mintAmount);
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

    // return
    // deploy price oracle for converter
    priceOracleImitator = await DeployerUtils.deployContract(
      signer,
      'PriceOracleImitator',
      tokens[vaultAsset].address,
      liquidator.address,
    ) as PriceOracleImitator;

    // console.log('Coverter oracle WBTC price', await priceOracleImitator.getAssetPrice(tokens[MaticAddresses.WBTC_TOKEN].address))
    // console.log('Coverter oracle WETH price', await priceOracleImitator.getAssetPrice(tokens[MaticAddresses.WETH_TOKEN].address))

    // deploy tetu converter and setup
    const converterController = await DeployerUtils.deployContract(
      signer,
      'ConverterController',
      liquidator.address,
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
    ) as TetuConverter;
    await converterController.initialize(
      signer.address,
      41142,
      101,
      120,
      tetuConverter.address,
      borrowManager.address,
      debtMonitor.address,
      keeper.address,
      swapManager.address,
      1000,
      priceOracleImitator.address
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



