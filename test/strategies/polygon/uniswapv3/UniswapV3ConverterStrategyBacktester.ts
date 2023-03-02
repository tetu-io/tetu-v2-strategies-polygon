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
  TetuVoter__factory,
  Uni3Swapper__factory,
  UniswapV3Callee,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
  UniswapV3Factory,
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
import {MaticAddresses} from "../../../../scripts/MaticAddresses";

const { expect } = chai;

describe('UmiswapV3 converter strategy backtester', function() {
  // backtest config
  const backtestStartBlock = 39530000 // Feb-21-2023 01:02:34 AM +UTC
  const backtestEndBlock = 39570000 // Feb-22-2023 01:40:46 AM +UTC
  const investAmount = parseUnits('1000', 6) // 1k USDC
  const strategyTickRange = 1200 // +- 12% price
  const strategyRebalanceTickRange = 40 // +- 0.4% price change
  const txLimit = 100 // 0 - unlimited
  const disableBurns = true // backtest is 10x slower with enabled burns

  // liquidity snapshots
  let usdcWeth005PoolLiquiditySnapshot: IPoolLiquiditySnapshot
  let wmaticUsdc005PoolLiquiditySnapshot: IPoolLiquiditySnapshot

  // vaults and strategies
  let usdcWeth005Vault: TetuVaultV2
  let usdcWeth005Strategy: UniswapV3ConverterStrategy
  let wmaticUsdc005Vault: TetuVaultV2
  let wmaticUsdc005Strategy: UniswapV3ConverterStrategy

  // time snapshots
  let snapshot: string;
  let snapshotBefore: string;

  // signers
  let signer: SignerWithAddress;
  let user: SignerWithAddress;

  // tokens
  let USDC: MockToken
  let WETH: MockToken
  let WMATIC: MockToken

  // uniswap v3
  let uniswapV3Factory: UniswapV3Factory;
  let wmaticUsdc005Pool: UniswapV3Pool;
  let usdcWeth005Pool: UniswapV3Pool;
  let uniswapV3Calee: UniswapV3Callee

  // compound
  let compPriceOracleImitator: CompPriceOracleImitator
  let comptroller: Comptroller
  let compInterestRateModel: JumpRateModelV2
  let cUSDC: CErc20Immutable
  let cWETH: CErc20Immutable
  let cWMATIC: CErc20Immutable

  // liquidator
  let liquidator: TetuLiquidator

  // price oracle for converter
  let priceOracleImitator: PriceOracleImitator;

  // converter
  let tetuConverter: TetuConverter;

  const backtestResults: IBacktestResult[] = []

  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();
    let tx
    [signer,user] = await ethers.getSigners();

    // fetch liquidity snapshots
    usdcWeth005PoolLiquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(getAddress(MaticAddresses.UNISWAPV3_USDC_WETH_500), backtestStartBlock, 200);
    wmaticUsdc005PoolLiquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(getAddress(MaticAddresses.UNISWAPV3_WMATIC_USDC_500), backtestStartBlock, 200);

    // deploy tokens
    USDC = await DeployerUtils.deployMockToken(signer, 'USDC', 6, '100000000'); // mint 100m
    WETH = await DeployerUtils.deployMockToken(signer, 'WETH', 18, '2000000'); // mint 2m
    WMATIC = await DeployerUtils.deployMockToken(signer, 'WMATIC', 18, '100000000'); // mint 100m
    const tetu = await DeployerUtils.deployMockToken(signer, 'TETU');

    // give 10k USDC to user
    await USDC.transfer(user.address, parseUnits('10000', 6))

    // deploy uniswap v3, pools, callee and init first price
    uniswapV3Factory = await DeployerUtils.deployContract(signer, "UniswapV3Factory") as UniswapV3Factory;
    tx = await uniswapV3Factory.createPool(WMATIC.address, USDC.address, 500)
    await tx.wait()
    wmaticUsdc005Pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(WMATIC.address, USDC.address, 500), signer)
    tx = await uniswapV3Factory.createPool(USDC.address, WETH.address, 500)
    await tx.wait()
    usdcWeth005Pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(USDC.address, WETH.address, 500), signer)
    tx = await uniswapV3Factory.createPool(tetu.address, USDC.address, 500)
    await tx.wait()
    // tetuUsdc pool need for strategy testing with compoundRatio < 100%
    const tetuUsdc500Pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(tetu.address, USDC.address, 500), signer)
    uniswapV3Calee = await DeployerUtils.deployContract(signer, "UniswapV3Callee") as UniswapV3Callee
    await USDC.approve(uniswapV3Calee.address, parseUnits('90000000', 6))
    await WETH.approve(uniswapV3Calee.address, parseUnits('900000'))
    await WMATIC.approve(uniswapV3Calee.address, parseUnits('90000000'))
    await tetu.approve(uniswapV3Calee.address, parseUnits('10000000'))
    await usdcWeth005Pool.initialize(usdcWeth005PoolLiquiditySnapshot.currentSqrtPriceX96)
    await wmaticUsdc005Pool.initialize(wmaticUsdc005PoolLiquiditySnapshot.currentSqrtPriceX96)
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
    const uni3swapper = Uni3Swapper__factory.connect(uni3swapperProxy.address, signer)
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
        pool: usdcWeth005Pool.address,
        swapper: uni3swapper.address,
        tokenIn: USDC.address,
        tokenOut: WETH.address,
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
        tokenIn: WETH.address,
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
    await comptroller._supportMarket(cUSDC.address)
    await comptroller._supportMarket(cWETH.address)
    await comptroller._supportMarket(cWMATIC.address)
    await comptroller._setCollateralFactor(cUSDC.address, parseUnits('0.9'))
    await comptroller._setCollateralFactor(cWETH.address, parseUnits('0.9'))
    await comptroller._setCollateralFactor(cWMATIC.address, parseUnits('0.9'))
    // supply 500k USDC, WMATIC, WETH
    await comptroller.enterMarkets([cUSDC.address, cWETH.address, cWMATIC.address])
    await USDC.approve(cUSDC.address, parseUnits('500000', 6))
    await WETH.approve(cWETH.address, parseUnits('500000'))
    await WMATIC.approve(cWMATIC.address, parseUnits('500000'))
    await cUSDC.mint(parseUnits('500000', 6))
    await cWETH.mint(parseUnits('500000'))
    await cWMATIC.mint(parseUnits('500000'))

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
    const platformAdapter = await DeployerUtils.deployContract(signer, "HfPlatformAdapter", converterController.address, borrowManager.address, comptroller.address, poolAdapter.address, [cUSDC.address, cWETH.address, cWMATIC.address]) as HfPlatformAdapter
    const assetsPairs = generateAssetPairs([USDC.address, WETH.address, WMATIC.address])
    tx = await borrowManager.addAssetPairs(platformAdapter.address, assetsPairs.leftAssets, assetsPairs.rightAssets)
    await tx.wait()

    // deploy Tetu V2 system
    const controllerLogic = await DeployerUtils.deployContract(signer, "ControllerV2") as ControllerV2
    const controllerProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    tx = await controllerProxy.initProxy(controllerLogic.address)
    await tx.wait()
    const controller = ControllerV2__factory.connect(controllerProxy.address, signer)
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
    const gauge = MultiGauge__factory.connect(gaugeProxy.address, signer)
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
    const vaultFactory = await DeployerUtils.deployContract(signer, 'VaultFactory', controller.address, vaultImpl.address, vaultInsuranceImpl.address, splitterImpl.address) as VaultFactory
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
      strategyTickRange,
      strategyRebalanceTickRange,
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
      strategyTickRange,
      strategyRebalanceTickRange,
    )
    wmaticUsdc005Vault = vaultStrategyInfo.vault
    wmaticUsdc005Strategy = vaultStrategyInfo.strategy

    const platformVoterSigner = await DeployerUtilsLocal.impersonate(await controller.platformVoter())
    await usdcWeth005Strategy.connect(platformVoterSigner).setCompoundRatio(100000) // 100%
    await wmaticUsdc005Strategy.connect(platformVoterSigner).setCompoundRatio(100000) // 100%
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

  it("Env test", async function () {
    // test price oracles
    const liquidatorWethPrice = await liquidator.getPrice(WETH.address, USDC.address, parseUnits('1'))
    const liquidatorWmaticPrice = await liquidator.getPrice(WMATIC.address, USDC.address, parseUnits('1'))
    expect(liquidatorWethPrice).gt(0)
    expect(liquidatorWmaticPrice).gt(0)
    const compPriceOracleUSDCPrice = await compPriceOracleImitator.getUnderlyingPrice(cUSDC.address)
    expect(compPriceOracleUSDCPrice).eq(parseUnits('1', 30))
    const compPriceOracleWethPrice = await compPriceOracleImitator.getUnderlyingPrice(cWETH.address)
    const compPriceOracleWmaticPrice = await compPriceOracleImitator.getUnderlyingPrice(cWMATIC.address)
    expect(compPriceOracleWethPrice).eq(liquidatorWethPrice.mul(parseUnits('1', 12)))
    expect(compPriceOracleWmaticPrice).eq(liquidatorWmaticPrice.mul(parseUnits('1', 12)))
    const priceOracleUSDCPrice = await priceOracleImitator.getAssetPrice(USDC.address)
    expect(priceOracleUSDCPrice).eq(parseUnits('1', 18))
    const priceOracleWethPrice = await priceOracleImitator.getAssetPrice(WETH.address)
    const priceOracleWmaticPrice = await priceOracleImitator.getAssetPrice(WMATIC.address)
    expect(priceOracleWethPrice).eq(liquidatorWethPrice.mul(parseUnits('1', 12)))
    expect(priceOracleWmaticPrice).eq(liquidatorWmaticPrice.mul(parseUnits('1', 12)))
  })

  it("USDC_WETH_0.05% test", async function () {
    backtestResults.push(await strategyBacktest(
      signer,
      usdcWeth005Vault,
      usdcWeth005Strategy,
      uniswapV3Calee,
      usdcWeth005PoolLiquiditySnapshot,
      investAmount,
      backtestStartBlock,
      backtestEndBlock,
      MaticAddresses.UNISWAPV3_USDC_WETH_500,
      txLimit,
      disableBurns
    ))
  })

  it("WMATIC_USDC_0.05% test", async function () {
    backtestResults.push(await strategyBacktest(
      signer,
      wmaticUsdc005Vault,
      wmaticUsdc005Strategy,
      uniswapV3Calee,
      wmaticUsdc005PoolLiquiditySnapshot,
      investAmount,
      backtestStartBlock,
      backtestEndBlock,
      MaticAddresses.UNISWAPV3_WMATIC_USDC_500,
      txLimit,
      disableBurns
    ))
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
}

function showBacktestResult(r: IBacktestResult) {
  console.log(`Strategy ${r.vaultName}. Tick range: ${r.tickRange} (+-${r.tickRange / 100}% price). Rebalance tick range: ${r.rebalanceTickRange} (+-${r.rebalanceTickRange / 100}% price).`)
  const earnedPerSec1e10 = r.earned.mul(parseUnits('1', 10)).div(r.endTimestamp - r.startTimestamp)
  const earnedPerDay = earnedPerSec1e10.mul(86400).div(parseUnits('1', 10))
  const apr = earnedPerDay.mul(365).mul(100000000).div(r.investAmount).div(1000)
  console.log(`APR: ${formatUnits(apr, 3)}%. Invest amount: ${formatUnits(r.investAmount, 6)} USDC. Earned: ${formatUnits(r.earned, 6)} USDC. Rebalances: ${r.rebalances}.`)
  console.log(`Period: ${periodHuman(r.endTimestamp - r.startTimestamp)}. Start: ${new Date(r.startTimestamp*1000).toLocaleDateString("en-US")} ${new Date(r.startTimestamp*1000).toLocaleTimeString("en-US")}. Finish: ${new Date(r.endTimestamp*1000).toLocaleDateString("en-US")} ${new Date(r.endTimestamp*1000).toLocaleTimeString("en-US")}.`)
  console.log(`Start price of ${r.tokenBSymbol}: ${formatUnits(r.startPrice, 6)}. End price: ${formatUnits(r.endPrice, 6)}. Min price: ${formatUnits(r.minPrice, 6)}. Max price: ${formatUnits(r.maxPrice, 6)}.`)
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
  periodStr += `${periodMins - (periodHours - periodDays*24)*60}m`
  if (!periodDays && !periodHours) {
    if (periodMins) {
      periodStr += ':'
    }
    periodStr += `${periodSecs - periodMins*60}s`
  }
  return periodStr
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
  liquiditySnapshot: IPoolLiquiditySnapshot,
  investAmount: BigNumber,
  backtestStartBlock: number,
  backtestEndBlock: number,
  uniswapV3RealPoolAddress: string,
  txLimit: number = 0,
  disableBurns: boolean = true
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

  console.log(`Starting backtest of ${await vault.name()}`)
  console.log(`Filling pool with initial liquidity from snapshot (${liquiditySnapshot.ticks.length} ticks)..`)
  for (const tick of liquiditySnapshot.ticks) {
    await uniswapV3Calee.mint(pool.address, signer.address, tick.tickIdx, tick.tickIdx + 10, tick.liquidityActive)
  }

  console.log('Deposit USDC to vault...')
  await tokenA.approve(vault.address, Misc.MAX_UINT);
  await vault.deposit(investAmount, signer.address);
  const totalAssetsinStrategyBefore = await strategy.totalAssets()

  const liquidityTickLower = liquiditySnapshot.ticks[0].tickIdx
  const liquidityTickUpper = liquiditySnapshot.ticks[liquiditySnapshot.ticks.length - 1].tickIdx
  const startPrice = await strategy.getPrice(tokenB.address)
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

      process.stdout.write(`[tx ${i} of ${txsTotal}] BURN`)

      if (poolTx.tickLower < liquidityTickLower || poolTx.tickUpper > liquidityTickUpper) {
        const rangeOrigin = BigNumber.from(poolTx.tickUpper - poolTx.tickLower)
        const newTickUpper = poolTx.tickUpper > liquidityTickUpper ? liquidityTickUpper : poolTx.tickUpper
        const newTickLower = poolTx.tickLower < liquidityTickLower ? liquidityTickLower : poolTx.tickLower
        const newRange = BigNumber.from(newTickUpper - newTickLower)
        const newAmount = BigNumber.from(poolTx.amount).mul(newRange).div(rangeOrigin)
        const parts = (newTickUpper - newTickLower) / 10
        for (let t = newTickLower; t < newTickUpper - 10; t+=10) {
          await pool.burn(t, t + 10, BigNumber.from(newAmount).div(parts))
          process.stdout.write(`.`)
        }
      } else {
        const parts = (poolTx.tickUpper - poolTx.tickLower) / 10
        for (let t = poolTx.tickLower; t < poolTx.tickUpper - 10; t+=10) {
          await pool.burn(t, t + 10, BigNumber.from(poolTx.amount).div(parts))
          process.stdout.write(`.`)
        }
      }
      console.log('')
    }

    if (poolTx.type === TransactionType.MINT && poolTx.tickUpper !== undefined && poolTx.tickLower !== undefined) {
      await uniswapV3Calee.mint(pool.address, signer.address, poolTx.tickLower, poolTx.tickUpper, BigNumber.from(poolTx.amount))

      console.log(`[tx ${i} of ${txsTotal}] MINT`)
    }

    if (poolTx.type === TransactionType.SWAP) {
      const swap0to1 = parseUnits(poolTx.amount1, token1Decimals).lt(0)
      const tokenIn = swap0to1 ? token0.address : token1.address
      const amountIn = swap0to1 ? parseUnits(poolTx.amount0, token0Decimals) : parseUnits(poolTx.amount1, token1Decimals)
      const priceBefore = await strategy.getPrice(tokenB.address)
      await uniswapV3Calee.swap(pool.address, signer.address, tokenIn, amountIn)
      const priceAfter = await strategy.getPrice(tokenB.address)

      const priceChangeVal = priceAfter.sub(priceBefore).mul(1e15).div(priceBefore).div(1e8)
      const priceChangeStr = priceChangeVal.eq(0) ? '' : ` (${priceAfter.gt(priceBefore) ? '+' : ''}${formatUnits(priceChangeVal, 5)}%)`
      console.log(`[tx ${i} of ${txsTotal}] Swap ${swap0to1 ? token0Symbol : token1Symbol} -> ${swap0to1 ? token1Symbol : token0Symbol}. Price: ${formatUnits(priceAfter, 6)}${priceChangeStr}.`)

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

    if (i >= txsTotal) {
      break
    }
  }

  console.log('doHardWork...')
  await strategy.doHardWork()

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
  }
}