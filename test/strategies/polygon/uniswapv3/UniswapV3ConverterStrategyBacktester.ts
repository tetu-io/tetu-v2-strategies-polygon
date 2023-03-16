/* tslint:disable:no-trailing-whitespace */
import chai from "chai";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {
  BorrowManager,
  CErc20Immutable,
  CompPriceOracleImitator,
  Comptroller,
  ControllerV2,
  ControllerV2__factory,
  ForwarderV3__factory,
  HfPlatformAdapter,
  HfPoolAdapter, IERC20Extended__factory,
  InvestFundV2__factory, IUniswapV3Pool__factory,
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
  TetuVoter__factory, Uni3Swapper,
  Uni3Swapper__factory,
  UniswapV3Callee,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
  UniswapV3Factory, UniswapV3Lib,
  UniswapV3Pool,
  UniswapV3Pool__factory,
  VaultFactory,
  VeDistributor,
  VeDistributor__factory,
  VeTetu,
  VeTetu__factory
} from "../../../../typechain";
import {formatUnits, getAddress, parseUnits} from "ethers/lib/utils";
import {Controller as LiquidatorController} from "../../../../typechain/@tetu_io/tetu-liquidator/contracts";
import {Controller as ConverterController} from "../../../../typechain/@tetu_io/tetu-converter/contracts/core";
import {ProxyControlled as ProxyControlled_1_0_0} from "../../../../typechain/@tetu_io/tetu-liquidator/contracts/proxy";
import {IPoolLiquiditySnapshot, TransactionType, UniswapV3Utils} from "../../../../scripts/utils/UniswapV3Utils";
import {BigNumber} from "ethers";
import {RunHelper} from "../../../../scripts/utils/RunHelper";
import {Misc} from "../../../../scripts/utils/Misc";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {config as dotEnvConfig} from "dotenv";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";

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


describe('UmiswapV3 converter strategy backtester', function() {
  // ==== backtest config ====
  // 38500000 - Jan-25-2023 07:13:46 AM +UTC
  // 39000000 - Feb-07-2023 01:57:19 AM +UTC
  // 39200000 - Feb-12-2023 06:53:45 AM +UTC
  // 39500000 - Feb-20-2023 06:42:10 AM +UTC
  // 39530000 - Feb-21-2023 01:02:34 AM +UTC
  // 39570000 - Feb-22-2023 01:40:46 AM +UTC
  // 40000000 - Mar-05-2023 05:00:45 PM +UTC
  // 40200000 - Mar-10-2023 11:13:15 PM +UTC (before USDC price drop start, need pool100LiquiditySnapshotSurroundingTickSpacings = 2000 - 20%, for other periods 200 - 2% is enough)
  // 40360000 - Mar-15-2023 03:54:49 AM +UTC (after USDC price drop end)
  // 40410000 - Mar-16-2023 11:34:58 AM +UTC
  const backtestStartBlock = 40360000
  const backtestEndBlock = 40410000
  const investAmount = parseUnits('1000', 6) // 1k USDC
  const txLimit = 0 // 0 - unlimited
  const disableBurns = false // backtest is 5x slower with enabled burns for volatile pools
  const disableMints = false
  const testStrategies = {
    usdcWeth005: false, // USDC_WETH_0.05%
    wmaticUsdc005: false, // WMATIC_USDC_0.05%
    usdcDai001: false, // USDC_DAI_0.01%
    usdcUsdt001: true, // USDC_USDT_0.01%
  }
  const pool500LiquiditySnapshotSurroundingTickSpacings = 200 // 200*10*0.01% == +-20% price
  const pool100LiquiditySnapshotSurroundingTickSpacings = 200 // 200*1*0.01% == +-2% price
  // =========================

  // ==== strategies config ====
  // 0.05% fee pools
  const strategy005TickRange = 1200 // +- 12% price
  const strategy005RebalanceTickRange = 40 // +- 0.4% price change
  // 0.01% fee pools
  const strategy001TickRange = 0 // 1 tick
  const strategy001RebalanceTickRange = 0 // 1 tick
  // ===========================

  const runNotBacktestingTests = false

  // liquidity snapshots
  let usdcWeth005PoolLiquiditySnapshot: IPoolLiquiditySnapshot
  let wmaticUsdc005PoolLiquiditySnapshot: IPoolLiquiditySnapshot
  let usdcDai001PoolLiquiditySnapshot: IPoolLiquiditySnapshot
  let usdcUsdt001PoolLiquiditySnapshot: IPoolLiquiditySnapshot

  // vaults and strategies
  let usdcWeth005Vault: TetuVaultV2
  let wmaticUsdc005Vault: TetuVaultV2
  let usdcDai001Vault: TetuVaultV2
  let usdcUsdt001Vault: TetuVaultV2
  let usdcWeth005Strategy: UniswapV3ConverterStrategy
  let wmaticUsdc005Strategy: UniswapV3ConverterStrategy
  let usdcDai001Strategy: UniswapV3ConverterStrategy
  let usdcUsdt001Strategy: UniswapV3ConverterStrategy

  // time snapshots
  let snapshot: string;
  let snapshotBefore: string;

  // signers
  let signer: SignerWithAddress;
  let user: SignerWithAddress;

  // tokens
  let USDC: MockToken
  let USDT: MockToken
  let DAI: MockToken
  let WETH: MockToken
  let WMATIC: MockToken

  // uniswap v3
  let uniswapV3Factory: UniswapV3Factory;
  let uniswapV3Calee: UniswapV3Callee
  let uniswapV3Helper: UniswapV3Lib
  let wmaticUsdc005Pool: UniswapV3Pool;
  let usdcWeth005Pool: UniswapV3Pool;
  let usdcDai001Pool: UniswapV3Pool;
  let usdcUsdt001Pool: UniswapV3Pool;

  // compound
  let compPriceOracleImitator: CompPriceOracleImitator
  let comptroller: Comptroller
  let compInterestRateModel: JumpRateModelV2
  let cUSDC: CErc20Immutable
  let cWETH: CErc20Immutable
  let cWMATIC: CErc20Immutable
  let cDAI: CErc20Immutable
  let cUSDT: CErc20Immutable

  // liquidator
  let liquidator: TetuLiquidator
  let uni3swapper: Uni3Swapper

  // price oracle for converter
  let priceOracleImitator: PriceOracleImitator;

  // converter
  let tetuConverter: TetuConverter;

  // tetu v2
  let controller: ControllerV2
  let gauge: MultiGauge
  let vaultFactory: VaultFactory

  const backtestResults: IBacktestResult[] = []

  if (argv.disableStrategyTests) {
    return;
  }

  if (argv.hardhatChainId !== 31337) {
    console.log('Backtester can only work in the local hardhat network (31337 chainId)')
    return;
  }

  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();
    let tx
    [signer,user] = await ethers.getSigners();

    // fetch liquidity snapshots
    usdcWeth005PoolLiquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(getAddress(MaticAddresses.UNISWAPV3_USDC_WETH_500), backtestStartBlock, pool500LiquiditySnapshotSurroundingTickSpacings);
    wmaticUsdc005PoolLiquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(getAddress(MaticAddresses.UNISWAPV3_WMATIC_USDC_500), backtestStartBlock, pool500LiquiditySnapshotSurroundingTickSpacings);
    usdcDai001PoolLiquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(getAddress(MaticAddresses.UNISWAPV3_USDC_DAI_100), backtestStartBlock, pool100LiquiditySnapshotSurroundingTickSpacings);
    usdcUsdt001PoolLiquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(getAddress(MaticAddresses.UNISWAPV3_USDC_USDT_100), backtestStartBlock, pool100LiquiditySnapshotSurroundingTickSpacings);

    // deploy tokens
    const mintAmount = '100000000000' // 100b
    USDC = await DeployerUtils.deployMockToken(signer, 'USDC', 6, mintAmount);
    WETH = await DeployerUtils.deployMockToken(signer, 'WETH', 18, mintAmount);
    WMATIC = await DeployerUtils.deployMockToken(signer, 'WMATIC', 18, mintAmount);
    DAI = await DeployerUtils.deployMockToken(signer, 'DAI', 18, mintAmount);
    USDT = await DeployerUtils.deployMockToken(signer, 'USDT', 6, mintAmount);
    const tetu = await DeployerUtils.deployMockToken(signer, 'TETU');

    // give 10k USDC to user
    await USDC.transfer(user.address, parseUnits('10000', 6))

    // deploy uniswap v3, pools, callee and init first prices
    uniswapV3Factory = await DeployerUtils.deployContract(signer, "UniswapV3Factory") as UniswapV3Factory;
    await (await uniswapV3Factory.createPool(WMATIC.address, USDC.address, 500)).wait()
    wmaticUsdc005Pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(WMATIC.address, USDC.address, 500), signer)
    await (await uniswapV3Factory.createPool(USDC.address, WETH.address, 500)).wait()
    usdcWeth005Pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(USDC.address, WETH.address, 500), signer)
    await (await uniswapV3Factory.createPool(USDC.address, DAI.address, 100)).wait()
    usdcDai001Pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(USDC.address, DAI.address, 100), signer)
    await (await uniswapV3Factory.createPool(USDC.address, USDT.address, 100)).wait()
    usdcUsdt001Pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(USDC.address, USDT.address, 100), signer)
    // tetuUsdc pool need for strategy testing with compoundRatio < 100%
    await (await uniswapV3Factory.createPool(tetu.address, USDC.address, 500)).wait()
    const tetuUsdc500Pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(tetu.address, USDC.address, 500), signer)
    uniswapV3Helper = await DeployerUtils.deployContract(signer, "UniswapV3Lib") as UniswapV3Lib
    uniswapV3Calee = await DeployerUtils.deployContract(signer, "UniswapV3Callee") as UniswapV3Callee
    await USDC.approve(uniswapV3Calee.address, parseUnits(mintAmount, 6))
    await WETH.approve(uniswapV3Calee.address, parseUnits(mintAmount))
    await WMATIC.approve(uniswapV3Calee.address, parseUnits(mintAmount))
    await DAI.approve(uniswapV3Calee.address, parseUnits(mintAmount))
    await USDT.approve(uniswapV3Calee.address, parseUnits(mintAmount, 6))
    await tetu.approve(uniswapV3Calee.address, parseUnits(mintAmount))
    await usdcWeth005Pool.initialize(usdcWeth005PoolLiquiditySnapshot.currentSqrtPriceX96)
    await wmaticUsdc005Pool.initialize(wmaticUsdc005PoolLiquiditySnapshot.currentSqrtPriceX96)
    await usdcDai001Pool.initialize(usdcDai001PoolLiquiditySnapshot.currentSqrtPriceX96)
    await usdcUsdt001Pool.initialize(usdcUsdt001PoolLiquiditySnapshot.currentSqrtPriceX96)
    await tetuUsdc500Pool.initialize('79224306130848112672356') // 1:1
    await uniswapV3Calee.mint(tetuUsdc500Pool.address, signer.address, -277280, -275370, '21446390278959920000')

    // deploy tetu liquidator and setup
    const liquidatorController = await DeployerUtils.deployContract(signer, "@tetu_io/tetu-liquidator/contracts/Controller.sol:Controller") as LiquidatorController
    const liquidatorLogic = await DeployerUtils.deployContract(signer, 'TetuLiquidator');
    const liquidatorProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-liquidator/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled_1_0_0;
    tx = await liquidatorProxy.initProxy(liquidatorLogic.address)
    await tx.wait()
    liquidator = TetuLiquidator__factory.connect(liquidatorProxy.address, signer)
    tx = await liquidator.init(liquidatorController.address)
    await tx.wait()
    const uni3swapperLogic = await DeployerUtils.deployContract(signer, 'Uni3Swapper');
    const uni3swapperProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-liquidator/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled_1_0_0;
    tx = await uni3swapperProxy.initProxy(uni3swapperLogic.address)
    await tx.wait()
    uni3swapper = Uni3Swapper__factory.connect(uni3swapperProxy.address, signer)
    tx = await uni3swapper.init(liquidatorController.address)
    await tx.wait()
    const liquidatorPools = [
      {
        pool: wmaticUsdc005Pool.address,
        swapper: uni3swapper.address,
        tokenIn: WMATIC.address,
        tokenOut: USDC.address,
      },
      {
        pool: wmaticUsdc005Pool.address,
        swapper: uni3swapper.address,
        tokenIn: USDC.address,
        tokenOut: WMATIC.address,
      },
      {
        pool: usdcWeth005Pool.address,
        swapper: uni3swapper.address,
        tokenIn: USDC.address,
        tokenOut: WETH.address,
      },
      {
        pool: usdcWeth005Pool.address,
        swapper: uni3swapper.address,
        tokenIn: WETH.address,
        tokenOut: USDC.address,
      },
      {
        pool: usdcDai001Pool.address,
        swapper: uni3swapper.address,
        tokenIn: USDC.address,
        tokenOut: DAI.address,
      },
      {
        pool: usdcDai001Pool.address,
        swapper: uni3swapper.address,
        tokenIn: DAI.address,
        tokenOut: USDC.address,
      },
      {
        pool: usdcUsdt001Pool.address,
        swapper: uni3swapper.address,
        tokenIn: USDC.address,
        tokenOut: USDT.address,
      },
      {
        pool: usdcUsdt001Pool.address,
        swapper: uni3swapper.address,
        tokenIn: USDT.address,
        tokenOut: USDC.address,
      },
      {
        pool: tetuUsdc500Pool.address,
        swapper: uni3swapper.address,
        tokenIn: tetu.address,
        tokenOut: USDC.address,
      },
    ];
    await liquidator.addLargestPools(liquidatorPools, true)

    // deploy Compound and put liquidity
    compPriceOracleImitator = await DeployerUtils.deployContract(signer, "CompPriceOracleImitator", USDC.address, liquidator.address) as CompPriceOracleImitator
    comptroller = await DeployerUtils.deployContract(signer, "Comptroller") as Comptroller
    await comptroller._setPriceOracle(compPriceOracleImitator.address)
    // baseRatePerYear, multiplierPerYear, jumpMultiplierPerYear, kink_, owner_
    compInterestRateModel = await DeployerUtils.deployContract(signer, "JumpRateModelV2", '1'/*'9512937595'*/, '1', '1', '1', signer.address) as JumpRateModelV2
    cUSDC = await DeployerUtils.deployContract(signer, "CErc20Immutable",USDC.address,comptroller.address,compInterestRateModel.address,parseUnits('1', 14),'Compound USDC','cUSDC',8,signer.address,) as CErc20Immutable
    cWETH = await DeployerUtils.deployContract(signer, "CErc20Immutable",WETH.address,comptroller.address,compInterestRateModel.address,parseUnits('1', 26),'Compound WETH','cWETH',8,signer.address,) as CErc20Immutable
    cWMATIC = await DeployerUtils.deployContract(signer, "CErc20Immutable",WMATIC.address,comptroller.address,compInterestRateModel.address,parseUnits('1', 26),'Compound WMATIC','cWMATIC',8,signer.address,) as CErc20Immutable
    cDAI = await DeployerUtils.deployContract(signer, "CErc20Immutable",DAI.address,comptroller.address,compInterestRateModel.address,parseUnits('1', 26),'Compound DAI','cDAI',8,signer.address,) as CErc20Immutable
    cUSDT = await DeployerUtils.deployContract(signer, "CErc20Immutable",USDT.address,comptroller.address,compInterestRateModel.address,parseUnits('1', 14),'Compound USDT','cUSDT',8,signer.address,) as CErc20Immutable

    await comptroller._supportMarket(cUSDC.address)
    await comptroller._supportMarket(cWETH.address)
    await comptroller._supportMarket(cWMATIC.address)
    await comptroller._supportMarket(cDAI.address)
    await comptroller._supportMarket(cUSDT.address)
    await comptroller._setCollateralFactor(cUSDC.address, parseUnits('0.9'))
    await comptroller._setCollateralFactor(cWETH.address, parseUnits('0.9'))
    await comptroller._setCollateralFactor(cWMATIC.address, parseUnits('0.9'))
    await comptroller._setCollateralFactor(cDAI.address, parseUnits('0.9'))
    await comptroller._setCollateralFactor(cUSDT.address, parseUnits('0.9'))
    // supply 500k
    await comptroller.enterMarkets([cUSDC.address, cWETH.address, cWMATIC.address, cDAI.address, cUSDT.address])
    await USDC.approve(cUSDC.address, parseUnits('500000', 6))
    await WETH.approve(cWETH.address, parseUnits('500000'))
    await WMATIC.approve(cWMATIC.address, parseUnits('500000'))
    await DAI.approve(cDAI.address, parseUnits('500000'))
    await USDT.approve(cUSDT.address, parseUnits('500000', 6))
    await cUSDC.mint(parseUnits('500000', 6))
    await cWETH.mint(parseUnits('500000'))
    await cWMATIC.mint(parseUnits('500000'))
    await cDAI.mint(parseUnits('500000'))
    await cUSDT.mint(parseUnits('500000', 6))

    // deploy price oracle for converter
    priceOracleImitator = await DeployerUtils.deployContract(signer, "PriceOracleImitator", USDC.address, liquidator.address) as PriceOracleImitator

    // deploy tetu converter and setup
    const converterController = await DeployerUtils.deployContract(signer, "@tetu_io/tetu-converter/contracts/core/Controller.sol:Controller", liquidator.address, priceOracleImitator.address) as ConverterController
    const borrowManager = await DeployerUtils.deployContract(signer, "BorrowManager", converterController.address, parseUnits("0.9")) as BorrowManager
    const debtMonitor = await DeployerUtils.deployContract(signer, "DebtMonitor", converterController.address, borrowManager.address)
    const swapManager = await DeployerUtils.deployContract(signer, "SwapManager", converterController.address, liquidator.address, priceOracleImitator.address)
    const keeperCaller = await DeployerUtils.deployContract(signer, "KeeperCaller")
    const keeper = await DeployerUtils.deployContract(signer, "Keeper", converterController.address, keeperCaller.address, 2 * 7 * 24 * 60 * 60)
    tetuConverter = await DeployerUtils.deployContract(signer, "TetuConverter", converterController.address, borrowManager.address, debtMonitor.address, swapManager.address, keeper.address, priceOracleImitator.address) as TetuConverter
    await converterController.initialize(signer.address, 41142, 101, 120, 400, tetuConverter.address, borrowManager.address, debtMonitor.address, keeper.address, swapManager.address)
    const poolAdapter = await DeployerUtils.deployContract(signer, "HfPoolAdapter") as HfPoolAdapter
    const platformAdapter = await DeployerUtils.deployContract(signer, "HfPlatformAdapter", converterController.address, borrowManager.address, comptroller.address, poolAdapter.address, [cUSDC.address, cWETH.address, cWMATIC.address, cDAI.address, cUSDT.address]) as HfPlatformAdapter
    const assetsPairs = generateAssetPairs([USDC.address, WETH.address, WMATIC.address, DAI.address, USDT.address])
    tx = await borrowManager.addAssetPairs(platformAdapter.address, assetsPairs.leftAssets, assetsPairs.rightAssets)
    await tx.wait()

    // deploy Tetu V2 system
    const controllerLogic = await DeployerUtils.deployContract(signer, "ControllerV2") as ControllerV2
    const controllerProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    tx = await controllerProxy.initProxy(controllerLogic.address)
    await tx.wait()
    controller = ControllerV2__factory.connect(controllerProxy.address, signer)
    tx = await controller.init(signer.address)
    await tx.wait()
    const veTetuLogic = await DeployerUtils.deployContract(signer, 'VeTetu') as VeTetu
    const veTetuProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    tx = await veTetuProxy.initProxy(veTetuLogic.address)
    await tx.wait()
    const veTetu = VeTetu__factory.connect(veTetuProxy.address, signer)
    tx = await veTetu.init(tetu.address, BigNumber.from(1000), controller.address)
    await tx.wait()
    const veDistLogic = await DeployerUtils.deployContract(signer, 'VeDistributor') as VeDistributor
    const veDistProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    tx = await veDistProxy.initProxy(veDistLogic.address)
    await tx.wait()
    const veDist = VeDistributor__factory.connect(veDistProxy.address, signer)
    tx = await veDist.init(controller.address, veTetu.address, tetu.address)
    await tx.wait()
    const gaugeLogic = await DeployerUtils.deployContract(signer, 'MultiGauge');
    const gaugeProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    tx = await gaugeProxy.initProxy(gaugeLogic.address)
    await tx.wait()
    gauge = MultiGauge__factory.connect(gaugeProxy.address, signer)
    tx = await gauge.init(controller.address, veTetu.address, tetu.address)
    await tx.wait()
    const bribeLogic = await DeployerUtils.deployContract(signer, 'MultiBribe');
    const bribeProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    tx = await bribeProxy.initProxy(bribeLogic.address)
    await tx.wait()
    const bribe = MultiBribe__factory.connect(bribeProxy.address, signer)
    tx = await bribe.init(controller.address, veTetu.address, tetu.address)
    await tx.wait()
    const tetuVoterLogic = await DeployerUtils.deployContract(signer, 'TetuVoter');
    const tetuVoterProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    tx = await tetuVoterProxy.initProxy(tetuVoterLogic.address)
    await tx.wait()
    const tetuVoter = TetuVoter__factory.connect(tetuVoterProxy.address, signer)
    tx = await tetuVoter.init(controller.address, veTetu.address, tetu.address, gauge.address, bribe.address)
    await tx.wait()
    const platformVoterLogic = await DeployerUtils.deployContract(signer, 'PlatformVoter');
    const platformVoterProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    tx = await platformVoterProxy.initProxy(platformVoterLogic.address)
    await tx.wait()
    const platformVoter = PlatformVoter__factory.connect(platformVoterProxy.address, signer)
    tx = await platformVoter.init(controller.address, veTetu.address)
    await tx.wait()
    const forwarderLogic = await DeployerUtils.deployContract(signer, 'ForwarderV3');
    const forwarderProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    tx = await forwarderProxy.initProxy(forwarderLogic.address)
    await tx.wait()
    const forwarder = ForwarderV3__factory.connect(forwarderProxy.address, signer)
    tx = await forwarder.init(controller.address, tetu.address, bribe.address)
    await tx.wait()
    const investFundLogic = await DeployerUtils.deployContract(signer, 'InvestFundV2')
    const investFundProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    tx = await investFundProxy.initProxy(investFundLogic.address)
    await tx.wait()
    const investFund = InvestFundV2__factory.connect(investFundProxy.address, signer)
    tx = await investFund.init(controller.address)
    await tx.wait()
    const vaultImpl = await DeployerUtils.deployContract(signer, 'TetuVaultV2');
    const vaultInsuranceImpl = await DeployerUtils.deployContract(signer, 'VaultInsurance');
    const splitterImpl = await DeployerUtils.deployContract(signer, 'StrategySplitterV2');
    vaultFactory = await DeployerUtils.deployContract(signer, 'VaultFactory', controller.address, vaultImpl.address, vaultInsuranceImpl.address, splitterImpl.address) as VaultFactory
    tx = await controller.announceAddressChange(2, tetuVoter.address)
    await tx.wait()
    tx = await controller.announceAddressChange(3, platformVoter.address)
    await tx.wait()
    tx = await controller.announceAddressChange(4, liquidator.address)
    await tx.wait()
    tx = await controller.announceAddressChange(5, forwarder.address)
    await tx.wait()
    tx = await controller.announceAddressChange(6, investFund.address)
    await tx.wait()
    tx = await controller.announceAddressChange(7, veDist.address)
    await tx.wait()
    tx = await controller.changeAddress(2)
    await tx.wait()
    tx = await controller.changeAddress(3)
    await tx.wait()
    tx = await controller.changeAddress(4)
    await tx.wait()
    tx = await controller.changeAddress(5)
    await tx.wait()
    tx = await controller.changeAddress(6)
    await tx.wait()
    tx = await controller.changeAddress(7)
    await tx.wait()

    // deploy strategies
    let vaultStrategyInfo: IVaultUniswapV3StrategyInfo
    vaultStrategyInfo = await deployAndInitVaultAndUniswapV3Strategy(
      USDC.address,
      'TetuV2_UniswapV3_USDC-WETH-0.05%',
      controller,
      gauge,
      vaultFactory,
      tetuConverter.address,
      signer,
      usdcWeth005Pool.address,
      strategy005TickRange,
      strategy005RebalanceTickRange,
    )
    usdcWeth005Vault = vaultStrategyInfo.vault
    usdcWeth005Strategy = vaultStrategyInfo.strategy
    vaultStrategyInfo = await deployAndInitVaultAndUniswapV3Strategy(
      USDC.address,
      'TetuV2_UniswapV3_WMATIC_USDC-0.05%',
      controller,
      gauge,
      vaultFactory,
      tetuConverter.address,
      signer,
      wmaticUsdc005Pool.address,
      strategy005TickRange,
      strategy005RebalanceTickRange,
    )
    wmaticUsdc005Vault = vaultStrategyInfo.vault
    wmaticUsdc005Strategy = vaultStrategyInfo.strategy
    vaultStrategyInfo = await deployAndInitVaultAndUniswapV3Strategy(
      USDC.address,
      'TetuV2_UniswapV3_USDC-DAI-0.01%',
      controller,
      gauge,
      vaultFactory,
      tetuConverter.address,
      signer,
      usdcDai001Pool.address,
      strategy001TickRange,
      strategy001RebalanceTickRange,
    )
    usdcDai001Vault = vaultStrategyInfo.vault
    usdcDai001Strategy = vaultStrategyInfo.strategy
    vaultStrategyInfo = await deployAndInitVaultAndUniswapV3Strategy(
      USDC.address,
      'TetuV2_UniswapV3_USDC-USDT-0.01%',
      controller,
      gauge,
      vaultFactory,
      tetuConverter.address,
      signer,
      usdcUsdt001Pool.address,
      strategy001TickRange,
      strategy001RebalanceTickRange,
    )
    usdcUsdt001Vault = vaultStrategyInfo.vault
    usdcUsdt001Strategy = vaultStrategyInfo.strategy

    const platformVoterSigner = await DeployerUtilsLocal.impersonate(await controller.platformVoter())
    await usdcWeth005Strategy.connect(platformVoterSigner).setCompoundRatio(100000) // 100%
    await wmaticUsdc005Strategy.connect(platformVoterSigner).setCompoundRatio(100000) // 100%
    await usdcDai001Strategy.connect(platformVoterSigner).setCompoundRatio(100000) // 100%
    await usdcUsdt001Strategy.connect(platformVoterSigner).setCompoundRatio(100000) // 100%
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
    if (backtestResults.length > 0) {
      console.log('')
      console.log('')
      console.log(`=== Uniswap V3 delta-neutral strategy backtester ===`)
      console.log('')
      for (const r of backtestResults) {
        showBacktestResult(r)
      }
    }
  });

  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });

  it("USDC_WETH_0.05% test", async function () {
    if (testStrategies.usdcWeth005) {
      backtestResults.push(await strategyBacktest(
        signer,
        usdcWeth005Vault,
        usdcWeth005Strategy,
        uniswapV3Calee,
        uniswapV3Helper,
        usdcWeth005PoolLiquiditySnapshot,
        investAmount,
        backtestStartBlock,
        backtestEndBlock,
        MaticAddresses.UNISWAPV3_USDC_WETH_500,
        txLimit,
        disableBurns,
        disableMints
      ))
    }
  })

  it("WMATIC_USDC_0.05% test", async function () {
    if (testStrategies.wmaticUsdc005) {
      backtestResults.push(await strategyBacktest(
        signer,
        wmaticUsdc005Vault,
        wmaticUsdc005Strategy,
        uniswapV3Calee,
        uniswapV3Helper,
        wmaticUsdc005PoolLiquiditySnapshot,
        investAmount,
        backtestStartBlock,
        backtestEndBlock,
        MaticAddresses.UNISWAPV3_WMATIC_USDC_500,
        txLimit,
        disableBurns,
        disableMints
      ))
    }
  })

  it("USDC_DAI_0.01% test", async function () {
    if (testStrategies.usdcDai001) {
      backtestResults.push(await strategyBacktest(
        signer,
        usdcDai001Vault,
        usdcDai001Strategy,
        uniswapV3Calee,
        uniswapV3Helper,
        usdcDai001PoolLiquiditySnapshot,
        investAmount,
        backtestStartBlock,
        backtestEndBlock,
        MaticAddresses.UNISWAPV3_USDC_DAI_100,
        txLimit,
        disableBurns,
        disableMints
      ))
    }
  })

  it("USDC_USDT_0.01% test", async function () {
    if (testStrategies.usdcUsdt001) {
      backtestResults.push(await strategyBacktest(
        signer,
        usdcUsdt001Vault,
        usdcUsdt001Strategy,
        uniswapV3Calee,
        uniswapV3Helper,
        usdcUsdt001PoolLiquiditySnapshot,
        investAmount,
        backtestStartBlock,
        backtestEndBlock,
        MaticAddresses.UNISWAPV3_USDC_USDT_100,
        txLimit,
        disableBurns,
        disableMints
      ))
    }
  })

  it("Env test", async function () {
    if (runNotBacktestingTests) {
      // test price oracles
      const compPriceOracleUSDCPrice = await compPriceOracleImitator.getUnderlyingPrice(cUSDC.address)
      expect(compPriceOracleUSDCPrice).eq(parseUnits('1', 30))
      expect(await priceOracleImitator.getAssetPrice(USDC.address)).eq(parseUnits('1', 18))

      const liquidatorWethPrice = await liquidator.getPrice(WETH.address, USDC.address, parseUnits('1'))
      const liquidatorWmaticPrice = await liquidator.getPrice(WMATIC.address, USDC.address, parseUnits('1'))
      const liquidatorDaiPrice = await liquidator.getPrice(DAI.address, USDC.address, parseUnits('1'))
      const liquidatorUsdtPrice = await liquidator.getPrice(USDT.address, USDC.address, parseUnits('1', 6))
      expect(liquidatorWethPrice).gt(0)
      expect(liquidatorWmaticPrice).gt(0)
      expect(liquidatorDaiPrice).gt(0)
      expect(liquidatorUsdtPrice).gt(0)
      expect(await compPriceOracleImitator.getUnderlyingPrice(cWETH.address)).eq(liquidatorWethPrice.mul(parseUnits('1', 12)))
      expect(await compPriceOracleImitator.getUnderlyingPrice(cWMATIC.address)).eq(liquidatorWmaticPrice.mul(parseUnits('1', 12)))
      expect(await compPriceOracleImitator.getUnderlyingPrice(cDAI.address)).eq(liquidatorDaiPrice.mul(parseUnits('1', 12)))
      expect(await compPriceOracleImitator.getUnderlyingPrice(cUSDT.address)).eq(liquidatorUsdtPrice.mul(parseUnits('1', 24)))
      expect(await priceOracleImitator.getAssetPrice(WETH.address)).eq(liquidatorWethPrice.mul(parseUnits('1', 12)))
      expect(await priceOracleImitator.getAssetPrice(WMATIC.address)).eq(liquidatorWmaticPrice.mul(parseUnits('1', 12)))
      expect(await priceOracleImitator.getAssetPrice(DAI.address)).eq(liquidatorDaiPrice.mul(parseUnits('1', 12)))
      expect(await priceOracleImitator.getAssetPrice(USDT.address)).eq(liquidatorUsdtPrice.mul(parseUnits('1', 12)))
    }
  })

  it("Rebalance on stable pool with fuse test", async function () {
    if (runNotBacktestingTests) {
      // create DAI_USDT pool for test
      await (await uniswapV3Factory.createPool(DAI.address, USDT.address, 100)).wait()
      const pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(DAI.address, USDT.address, 100), signer)
      // 1 USDT for 1 DAI
      await pool.initialize('79225627830299477844530')
      await liquidator.removeLargestPool(USDC.address)
      await liquidator.removeLargestPool(WETH.address)
      await liquidator.removeLargestPool(WMATIC.address)
      await liquidator.addLargestPools([
        {
          pool: pool.address,
          swapper: uni3swapper.address,
          tokenIn: DAI.address,
          tokenOut: USDT.address,
        },
        {
          pool: pool.address,
          swapper: uni3swapper.address,
          tokenIn: USDT.address,
          tokenOut: DAI.address,
        }
      ], true)
      await priceOracleImitator.setUsdc(USDT.address)

      const slot0 = await pool.slot0()
      const vaultStrategyInfo = await deployAndInitVaultAndUniswapV3Strategy(
        USDT.address,
        'TetuV2_UniswapV3_DAI_USDT-0.01%',
        controller,
        gauge,
        vaultFactory,
        tetuConverter.address,
        signer,
        pool.address,
        0,
        0,
      )
      const vault = vaultStrategyInfo.vault
      const strategy = vaultStrategyInfo.strategy

      // add liquidity for +-3% of current price
      const liquidityTickLower = slot0.tick - 300
      const liquidityTickUpper = slot0.tick + 300
      const liquidityPreview = await uniswapV3Helper.addLiquidityPreview(pool.address, liquidityTickLower, liquidityTickUpper, parseUnits('100000'), parseUnits('100000', 6))
      await uniswapV3Calee.mint(pool.address, signer.address, liquidityTickLower, liquidityTickUpper, liquidityPreview.liquidityOut)

      await USDT.approve(vault.address, Misc.MAX_UINT);
      await vault.deposit(parseUnits('100', 6), signer.address);

      console.log('Utilization rate', await utilizationRate(strategy, signer, uniswapV3Helper))

      const assetsBefore = await strategy.totalAssets()

      let priceBefore
      let priceAfter
      let priceChangeVal
      let swapAmount

      // swap DAI to USDT N times
      swapAmount = parseUnits('500')
      for (let i = 0; i < 5; i++) {
        priceBefore = await uniswapV3Helper.getPrice(pool.address, DAI.address)
        await uniswapV3Calee.swap(pool.address, signer.address, DAI.address, swapAmount)
        priceAfter = await uniswapV3Helper.getPrice(pool.address, DAI.address)
        priceChangeVal = priceAfter.sub(priceBefore).mul(1e15).div(priceBefore).div(1e8)
        console.log(`Price change: ${priceAfter.gt(priceBefore) ? '+' : ''}${formatUnits(priceChangeVal, 5)}%`)
        if (await strategy.needRebalance()) {
          console.log('Rebalance...')
          await strategy.rebalance()
          console.log('Utilization rate', await utilizationRate(strategy, signer, uniswapV3Helper))
        }
      }

      swapAmount = parseUnits('25000')
      priceBefore = await uniswapV3Helper.getPrice(pool.address, DAI.address)
      await uniswapV3Calee.swap(pool.address, signer.address, DAI.address, swapAmount)
      priceAfter = await uniswapV3Helper.getPrice(pool.address, DAI.address)
      priceChangeVal = priceAfter.sub(priceBefore).mul(1e15).div(priceBefore).div(1e8)
      console.log(`Price change: ${priceAfter.gt(priceBefore) ? '+' : ''}${formatUnits(priceChangeVal, 5)}%`)
      // Price change: -0.73819%
      console.log('Rebalance...')
      await strategy.rebalance()
      expect(await strategy.isFuseTriggered()).eq(true)
      console.log('Fuse was enabled')
      await vault.deposit(parseUnits('1', 6), signer.address);
      await vault.withdraw(parseUnits('1', 6), signer.address, signer.address);
      const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
      await strategy.connect(operator).disableFuse();
      await strategy.connect(operator).setFuseThreshold(1000000);

      const assetsAfter = await strategy.totalAssets()
      console.log('Assets before', assetsBefore.toString())
      console.log('Assets after', assetsAfter.toString())
      console.log(`Total assets loss: ${formatUnits(assetsAfter.sub(assetsBefore).mul(1e15).div(assetsBefore).div(1e8), 5)}%`)
    }
  })

  it("Full debt rebalance on volatile pool test", async function () {
    if (runNotBacktestingTests) {
      // create WMATIC_USDT pool for test
      await (await uniswapV3Factory.createPool(WMATIC.address, USDT.address, 500)).wait()
      const pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(WMATIC.address, USDT.address, 500), signer)
      // 1.125977 USDT for 1 WMATIC
      await pool.initialize('84070669539408257617288')
      await liquidator.addLargestPools([{
        pool: pool.address,
        swapper: uni3swapper.address,
        tokenIn: WMATIC.address,
        tokenOut: USDT.address,
      }], true)
      const slot0 = await pool.slot0()
      const vaultStrategyInfo = await deployAndInitVaultAndUniswapV3Strategy(
        USDT.address,
        'TetuV2_UniswapV3_WMATIC_USDT-0.05%',
        controller,
        gauge,
        vaultFactory,
        tetuConverter.address,
        signer,
        pool.address,
        1200,
        30,
      )
      const vault = vaultStrategyInfo.vault
      const strategy = vaultStrategyInfo.strategy

      // add liquidity for +-70% of current price
      const liquidityTickLower = Math.round((slot0.tick - 7000) / 10) * 10
      const liquidityTickUpper = Math.round((slot0.tick + 7000) / 10) * 10
      const liquidityPreview = await uniswapV3Helper.addLiquidityPreview(pool.address, liquidityTickLower, liquidityTickUpper, parseUnits('10000'), parseUnits('10000', 6))
      await uniswapV3Calee.mint(pool.address, signer.address, liquidityTickLower, liquidityTickUpper, liquidityPreview.liquidityOut)

      await USDT.approve(vault.address, Misc.MAX_UINT);
      await vault.deposit(parseUnits('100', 6), signer.address);
      const assetsBefore = await strategy.totalAssets()

      let priceBefore
      let priceAfter
      let priceChangeVal
      let swapAmount

      // swap USDT to WMATIC N times
      swapAmount = parseUnits('500', 6)
      for (let i = 0; i < 2; i++) {
        priceBefore = await uniswapV3Helper.getPrice(pool.address, WMATIC.address)
        await uniswapV3Calee.swap(pool.address, signer.address, USDT.address, swapAmount)
        priceAfter = await uniswapV3Helper.getPrice(pool.address, WMATIC.address)
        priceChangeVal = priceAfter.sub(priceBefore).mul(1e15).div(priceBefore).div(1e8)
        console.log(`Price change: ${priceAfter.gt(priceBefore) ? '+' : ''}${formatUnits(priceChangeVal, 5)}%`)
        console.log('Rebalance...')
        await strategy.rebalance()
      }

      await strategy.doHardWork()

      // swap WMATIC to USDT N times
      swapAmount = parseUnits('500')
      for (let i = 0; i < 2; i++) {
        priceBefore = await uniswapV3Helper.getPrice(pool.address, WMATIC.address)
        await uniswapV3Calee.swap(pool.address, signer.address, WMATIC.address, swapAmount)
        priceAfter = await uniswapV3Helper.getPrice(pool.address, WMATIC.address)
        priceChangeVal = priceAfter.sub(priceBefore).mul(1e15).div(priceBefore).div(1e8)
        console.log(`Price change: ${priceAfter.gt(priceBefore) ? '+' : ''}${formatUnits(priceChangeVal, 5)}%`)
        console.log('Rebalance...')
        await strategy.rebalance()
      }

      await strategy.doHardWork()

      const assetsAfter = await strategy.totalAssets()
      console.log('Assets before', assetsBefore.toString())
      console.log('Assets after', assetsAfter.toString())
      console.log(`Total assets loss: ${formatUnits(assetsAfter.sub(assetsBefore).mul(1e15).div(assetsBefore).div(1e8), 5)}%`)
    }
  })
})

function generateAssetPairs(tokens: string[]) : IPlatformAdapterAssets {
  const leftAssets: string[] = [];
  const rightAssets: string[] = [];
  for (let i = 0; i < tokens.length; ++i) {
    for (let j = i + 1; j < tokens.length; ++j) {
      leftAssets.push(tokens[i]);
      rightAssets.push(tokens[j]);
    }
  }
  return {leftAssets, rightAssets};
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
  vaultName: string
  tickRange: number
  rebalanceTickRange: number
  startTimestamp: number
  endTimestamp: number
  investAmount: BigNumber
  earned: BigNumber
  rebalances: number
  startPrice: BigNumber
  endPrice: BigNumber
  maxPrice: BigNumber
  minPrice: BigNumber
  backtestLocalTimeSpent: number
  tokenBSymbol: string
  disableBurns: boolean
  disableMints: boolean
}

function showBacktestResult(r: IBacktestResult) {
  console.log(`Strategy ${r.vaultName}. Tick range: ${r.tickRange} (+-${r.tickRange / 100}% price). Rebalance tick range: ${r.rebalanceTickRange} (+-${r.rebalanceTickRange / 100}% price).`)
  const earnedPerSec1e10 = r.earned.mul(parseUnits('1', 10)).div(r.endTimestamp - r.startTimestamp)
  const earnedPerDay = earnedPerSec1e10.mul(86400).div(parseUnits('1', 10))
  const apr = earnedPerDay.mul(365).mul(100000000).div(r.investAmount).div(1000)
  console.log(`APR: ${formatUnits(apr, 3)}%. Invest amount: ${formatUnits(r.investAmount, 6)} USDC. Earned: ${formatUnits(r.earned, 6)} USDC. Rebalances: ${r.rebalances}.`)
  console.log(`Period: ${periodHuman(r.endTimestamp - r.startTimestamp)}. Start: ${new Date(r.startTimestamp*1000).toLocaleDateString("en-US")} ${new Date(r.startTimestamp*1000).toLocaleTimeString("en-US")}. Finish: ${new Date(r.endTimestamp*1000).toLocaleDateString("en-US")} ${new Date(r.endTimestamp*1000).toLocaleTimeString("en-US")}.`)
  console.log(`Start price of ${r.tokenBSymbol}: ${formatUnits(r.startPrice, 6)}. End price: ${formatUnits(r.endPrice, 6)}. Min price: ${formatUnits(r.minPrice, 6)}. Max price: ${formatUnits(r.maxPrice, 6)}.`)
  console.log(`Mints: ${!r.disableMints ? 'enabled' : 'disabled'}. Burns: ${!r.disableBurns ? 'enabled' : 'disabled'}.`)
  console.log(`Time spent for backtest: ${periodHuman(r.backtestLocalTimeSpent)}.`)
  console.log('')
}

function periodHuman(periodSecs: number) {
  const periodMins = Math.floor(periodSecs / 60)
  const periodHours = Math.floor(periodMins / 60)
  const periodDays = Math.floor(periodHours / 24)
  let periodStr = ''
  if (periodDays) {
    periodStr += `${periodDays}d `
  }
  if (periodHours) {
    periodStr += `${periodHours - periodDays*24}h:`
  }
  periodStr += `${periodMins - periodHours*60}m`
  if (!periodDays && !periodHours) {
    if (periodMins) {
      periodStr += ':'
    }
    periodStr += `${periodSecs - periodMins*60}s`
  }
  return periodStr
}

async function utilizationRate(strategy: UniswapV3ConverterStrategy, signer: SignerWithAddress, uniswapV3Helper: UniswapV3Lib) {
  const tokenA = IERC20Extended__factory.connect(await strategy.tokenA(), signer)
  const tokenB = IERC20Extended__factory.connect(await strategy.tokenB(), signer)
  const price = await uniswapV3Helper.getPrice(await strategy.pool(), tokenB.address)
  const total = await strategy.totalAssets()
  const used = total.sub((await tokenA.balanceOf(strategy.address)).add((await tokenB.balanceOf(strategy.address)).mul(price).div(parseUnits('1', await tokenB.decimals()))))
  const rate = used.mul(10000).div(total)
  return `${formatUnits(rate, 2)}%`
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
  investAmount: BigNumber,
  backtestStartBlock: number,
  backtestEndBlock: number,
  uniswapV3RealPoolAddress: string,
  txLimit: number = 0,
  disableBurns: boolean = true,
  disableMints: boolean = false,
): Promise<IBacktestResult> {
  const startTimestampLocal = Math.floor(Date.now() / 1000)
  const tokenA = IERC20Extended__factory.connect(await strategy.tokenA(), signer)
  const tokenB = IERC20Extended__factory.connect(await strategy.tokenB(), signer)
  const pool = IUniswapV3Pool__factory.connect(await strategy.pool(), signer)
  const token0 = IERC20Extended__factory.connect(await pool.token0(), signer)
  const token1 = IERC20Extended__factory.connect(await pool.token1(), signer)
  const token0Decimals = await token0.decimals()
  const token1Decimals = await token1.decimals()
  const token0Symbol = await token0.symbol()
  const token1Symbol = await token1.symbol()
  const tickSpacing = UniswapV3Utils.getTickSpacing(await pool.fee())

  console.log(`Starting backtest of ${await vault.name()}`)
  console.log(`Filling pool with initial liquidity from snapshot (${liquiditySnapshot.ticks.length} ticks)..`)
  for (const tick of liquiditySnapshot.ticks) {
    await uniswapV3Calee.mint(pool.address, signer.address, tick.tickIdx, tick.tickIdx + tickSpacing, tick.liquidityActive)
  }

  console.log('Deposit USDC to vault...')
  await tokenA.approve(vault.address, Misc.MAX_UINT);
  await vault.deposit(investAmount, signer.address);
  const totalAssetsinStrategyBefore = await strategy.totalAssets()

  const liquidityTickLower = liquiditySnapshot.ticks[0].tickIdx
  const liquidityTickUpper = liquiditySnapshot.ticks[liquiditySnapshot.ticks.length - 1].tickIdx
  const startPrice = await uniswapV3Helper.getPrice(pool.address, tokenB.address)
  let endPrice = startPrice
  let minPrice = startPrice
  let maxPrice = startPrice
  let i = 0
  let rebalances = 0
  const poolTxs = await UniswapV3Utils.getPoolTransactions(getAddress(uniswapV3RealPoolAddress), backtestStartBlock, backtestEndBlock)
  const startTimestamp = poolTxs[0].timestamp
  const txsTotal = txLimit === 0 || txLimit > poolTxs.length ? poolTxs.length : txLimit
  let endTimestamp = startTimestamp
  for (const poolTx of poolTxs) {
    i++
    endTimestamp = poolTx.timestamp
    if (!disableBurns && poolTx.type === TransactionType.BURN && poolTx.tickUpper !== undefined && poolTx.tickLower !== undefined) {
      if (poolTx.tickUpper < liquidityTickLower || poolTx.tickLower > liquidityTickUpper) {
        // burn liquidity not in pool range
        continue
      }

      if (BigNumber.from(poolTx.amount).eq(0)) {
        // zero burn == collect fees
        continue
      }

      process.stdout.write(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] BURN`)

      if (poolTx.tickLower < liquidityTickLower || poolTx.tickUpper > liquidityTickUpper) {
        const rangeOrigin = BigNumber.from(poolTx.tickUpper - poolTx.tickLower)
        const newTickUpper = poolTx.tickUpper > liquidityTickUpper ? liquidityTickUpper : poolTx.tickUpper
        const newTickLower = poolTx.tickLower < liquidityTickLower ? liquidityTickLower : poolTx.tickLower
        const newRange = BigNumber.from(newTickUpper - newTickLower)
        const newAmount = BigNumber.from(poolTx.amount).mul(newRange).div(rangeOrigin)
        const parts = (newTickUpper - newTickLower) / tickSpacing
        for (let t = newTickLower; t < newTickUpper - tickSpacing; t+=tickSpacing) {
          await pool.burn(t, t + tickSpacing, BigNumber.from(newAmount).div(parts))
          process.stdout.write(`.`)
        }
      } else {
        const parts = (poolTx.tickUpper - poolTx.tickLower) / tickSpacing
        for (let t = poolTx.tickLower; t < poolTx.tickUpper - tickSpacing; t+=tickSpacing) {
          await pool.burn(t, t + tickSpacing, BigNumber.from(poolTx.amount).div(parts))
          process.stdout.write(`.`)
        }
      }
      console.log('')
    }

    if (!disableMints && poolTx.type === TransactionType.MINT && poolTx.tickUpper !== undefined && poolTx.tickLower !== undefined) {
      await uniswapV3Calee.mint(pool.address, signer.address, poolTx.tickLower, poolTx.tickUpper, BigNumber.from(poolTx.amount))

      console.log(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] MINT`)
    }

    if (poolTx.type === TransactionType.SWAP) {
      const swap0to1 = parseUnits(poolTx.amount1, token1Decimals).lt(0)
      const tokenIn = swap0to1 ? token0.address : token1.address
      const amountIn = swap0to1 ? parseUnits(poolTx.amount0, token0Decimals) : parseUnits(poolTx.amount1, token1Decimals)
      if (amountIn.eq(0)) {
        console.log(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] Swap zero amount. Skipped.`)
        continue
      }
      const priceBefore = await uniswapV3Helper.getPrice(pool.address, tokenB.address)
      await uniswapV3Calee.swap(pool.address, signer.address, tokenIn, amountIn)
      const priceAfter = await uniswapV3Helper.getPrice(pool.address, tokenB.address)

      const priceChangeVal = priceAfter.sub(priceBefore).mul(1e15).div(priceBefore).div(1e8)
      const priceChangeStr = priceChangeVal.eq(0) ? '' : ` (${priceAfter.gt(priceBefore) ? '+' : ''}${formatUnits(priceChangeVal, 5)}%)`
      console.log(`[tx ${i} of ${txsTotal} ${poolTx.timestamp}] Swap ${swap0to1 ? token0Symbol : token1Symbol} -> ${swap0to1 ? token1Symbol : token0Symbol}. Price: ${formatUnits(priceAfter, 6)}${priceChangeStr}.`)

      if (priceAfter.gt(maxPrice)) {
        maxPrice = priceAfter
      }

      if (priceAfter.lt(minPrice)) {
        minPrice = priceAfter
      }

      endPrice = priceAfter
    }

    if (await strategy.needRebalance()) {
      await strategy.rebalance()
      rebalances++
    }

    if (await strategy.isFuseTriggered()) {
      console.log('Fuse enabled!')
      break;
    }

    if (i >= txsTotal) {
      break
    }
  }

  console.log('doHardWork...')
  const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter())
  await strategy.connect(splitterSigner).doHardWork()

  const totalAssetsinStrategyAfter = await strategy.totalAssets()
  const endTimestampLocal = Math.floor(Date.now() / 1000)
  const earned = totalAssetsinStrategyAfter.sub(totalAssetsinStrategyBefore)

  return {
    vaultName: await vault.name(),
    tickRange: (await strategy.upperTick() - await strategy.lowerTick()) / 2,
    rebalanceTickRange: await strategy.rebalanceTickRange(),
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
  }
}
