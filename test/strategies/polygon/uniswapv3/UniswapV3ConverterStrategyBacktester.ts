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
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Controller as LiquidatorController} from "../../../../typechain/@tetu_io/tetu-liquidator/contracts";
import {Controller as ConverterController} from "../../../../typechain/@tetu_io/tetu-converter/contracts/core";
import {ProxyControlled as ProxyControlled_1_0_0} from "../../../../typechain/@tetu_io/tetu-liquidator/contracts/proxy";
import {IPoolLiquiditySnapshot, TransactionType, UniswapV3Utils} from "../../../../scripts/utils/UniswapV3Utils";
import {BigNumber} from "ethers";
import {RunHelper} from "../../../../scripts/utils/RunHelper";
import {Misc} from "../../../../scripts/utils/Misc";

const { expect } = chai;

describe('UmiswapV3 converter strategy local backtester', function() {
  // backtest config
  const backtestStartBlock = 39530000 // Feb-21-2023 01:02:34 AM +UTC
  const backtestEndBlock = 39570000 // Feb-22-2023 01:40:46 AM +UTC
  const investAmount = parseUnits('1000', 6) // 1k USDC
  const strategyTickRange = 1200 // +- 12% price
  const strategyRebalanceTickRange = 40 // +- 0.4% price change

  // polygon addresses of pools for data extraction
  const usdcWeth005PoolReal = '0x45dDa9cb7c25131DF268515131f647d726f50608'
  const wmaticUsdc005PoolReal = '0xA374094527e1673A86dE625aa59517c5dE346d32'

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

  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();
    let tx
    [signer,user] = await ethers.getSigners();

    // fetch liquidity snapshots
    usdcWeth005PoolLiquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(usdcWeth005PoolReal, backtestStartBlock, 200);
    wmaticUsdc005PoolLiquiditySnapshot = await UniswapV3Utils.getPoolLiquiditySnapshot(wmaticUsdc005PoolReal, backtestStartBlock, 200);

    // deploy tokens
    USDC = await DeployerUtils.deployMockToken(signer, 'USDC', 6, '100000000'); // mint 100m
    WETH = await DeployerUtils.deployMockToken(signer, 'WETH', 18, '2000000'); // mint 2m
    WMATIC = await DeployerUtils.deployMockToken(signer, 'WMATIC', 18, '100000000'); // mint 100m

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
    uniswapV3Calee = await DeployerUtils.deployContract(signer, "UniswapV3Callee") as UniswapV3Callee
    await USDC.approve(uniswapV3Calee.address, parseUnits('90000000', 6))
    await WETH.approve(uniswapV3Calee.address, parseUnits('900000'))
    await WMATIC.approve(uniswapV3Calee.address, parseUnits('90000000'))
    await usdcWeth005Pool.initialize(usdcWeth005PoolLiquiditySnapshot.currentSqrtPriceX96)
    await wmaticUsdc005Pool.initialize(wmaticUsdc005PoolLiquiditySnapshot.currentSqrtPriceX96)

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
    ];
    await liquidator.addLargestPools(liquidatorPools, true)

    // deploy Compound and put liquidity
    compPriceOracleImitator = await DeployerUtils.deployContract(signer, "CompPriceOracleImitator", USDC.address, liquidator.address) as CompPriceOracleImitator
    comptroller = await DeployerUtils.deployContract(signer, "Comptroller") as Comptroller
    await comptroller._setPriceOracle(compPriceOracleImitator.address)
    // baseRatePerYear, multiplierPerYear, jumpMultiplierPerYear, kink_, owner_
    compInterestRateModel = await DeployerUtils.deployContract(signer, "JumpRateModelV2", '9512937595', '1', '1', '1', signer.address) as JumpRateModelV2
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
    const tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
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
      // 500,
      // 100,
      // 100
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
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
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
    expect(liquidatorWethPrice).gt(0)
    const compPriceOracleUSDCPrice = await compPriceOracleImitator.getUnderlyingPrice(cUSDC.address)
    expect(compPriceOracleUSDCPrice).eq(parseUnits('1', 30))
    const compPriceOracleWethPrice = await compPriceOracleImitator.getUnderlyingPrice(cWETH.address)
    expect(compPriceOracleWethPrice).eq(liquidatorWethPrice.mul(parseUnits('1', 12)))
    const priceOracleUSDCPrice = await priceOracleImitator.getAssetPrice(USDC.address)
    expect(priceOracleUSDCPrice).eq(parseUnits('1', 18))
    const priceOracleWethPrice = await priceOracleImitator.getAssetPrice(WETH.address)
    expect(priceOracleWethPrice).eq(liquidatorWethPrice.mul(parseUnits('1', 12)))
  })

  it("USDC_WETH_0.05% test", async function () {
    const vault = usdcWeth005Vault
    const strategy = usdcWeth005Strategy

    const tokenBAddr = await strategy.tokenB()
    const pool = IUniswapV3Pool__factory.connect(await strategy.pool(), signer)
    const poolAddr = pool.address
    const poolToken0Addr = await pool.token0()
    const poolToken1Addr = await pool.token1()
    const token0 = IERC20Extended__factory.connect(poolToken0Addr, signer)
    const token1 = IERC20Extended__factory.connect(poolToken1Addr, signer)
    const token0Decimals = await token0.decimals()
    const token1Decimals = await token1.decimals()
    const token0Symbol = await token0.symbol()
    const token1Symbol = await token1.symbol()

    console.log(`Starting backtest of ${await vault.name()}`)
    console.log(`Filling pool with initial liquidity from snapshot (${usdcWeth005PoolLiquiditySnapshot.ticks.length} ticks)..`)
    for (const tick of usdcWeth005PoolLiquiditySnapshot.ticks) {
      await uniswapV3Calee.mint(poolAddr, signer.address, tick.tickIdx, tick.tickIdx + 10, tick.liquidityActive)
    }

    console.log('Deposit USDC to vault...');
    await USDC.approve(vault.address, Misc.MAX_UINT);
    await vault.deposit(investAmount, signer.address);
    // const totalAssetsinVaultBefore = await vault.totalAssets()
    const totalAssetsinStrategyBefore = await strategy.totalAssets()

    let i = 0
    const poolTxs = await UniswapV3Utils.getPoolTransactions(usdcWeth005PoolReal, backtestStartBlock, backtestEndBlock)
    const startTimestamp = poolTxs[0].timestamp
    let endTimestamp = startTimestamp
    for (const poolTx of poolTxs) {
      if (poolTx.type === TransactionType.SWAP) {
        const swap0to1 = parseUnits(poolTx.amount1, token1Decimals).lt(0)
        const tokenIn = swap0to1 ? poolToken0Addr : poolToken1Addr
        const amountIn = swap0to1 ? parseUnits(poolTx.amount0, token0Decimals) : parseUnits(poolTx.amount1, token1Decimals)
        const priceBefore = await strategy.getPrice(tokenBAddr)
        await uniswapV3Calee.swap(poolAddr, signer.address, tokenIn, amountIn)
        const priceAfter = await strategy.getPrice(tokenBAddr)

        const priceChangeVal = priceAfter.sub(priceBefore).mul(1e15).div(priceBefore).div(1e8)
        const priceChangeStr = priceChangeVal.eq(0) ? '' : ` (${priceAfter.gt(priceBefore) ? '+' : ''}${formatUnits(priceChangeVal, 5)}%)`
        console.log(`Swap ${swap0to1 ? token0Symbol : token1Symbol} -> ${swap0to1 ? token1Symbol : token0Symbol}. Price: ${formatUnits(priceAfter, 6)}${priceChangeStr}.`)
        endTimestamp = poolTx.timestamp
        i++
      }

      if (await strategy.needRebalance()) {
        await strategy.rebalance()
      }

      if (i > 1000) {
        break
      }
    }

    // const totalAssetsinVaultAfter = await vault.totalAssets()
    const totalAssetsinStrategyAfter = await strategy.totalAssets()

    console.log('Strategy totalAssets before', totalAssetsinStrategyBefore.toString())
    console.log('Strategy totalAssets after', totalAssetsinStrategyAfter.toString())

    // await strategy.doHardWork()
    // console.log('Strategy totalAssets after hardwork', await strategy.totalAssets())

    const periodSecs = endTimestamp - startTimestamp
    const periodMins = Math.floor(periodSecs / 60)
    const periodHours = Math.floor(periodMins / 60)
    let periodStr = ''
    if (periodHours) {
      periodStr += `${periodHours}h:`
    }
    periodStr += `${periodMins - periodHours*60}m`
    console.log('Period', periodStr)

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
