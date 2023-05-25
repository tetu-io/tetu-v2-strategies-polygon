/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager, BorrowManager__factory,
  CErc20Immutable,
  CompPriceOracleImitator,
  Comptroller,
  Controller as LiquidatorController,
  ControllerV2,
  ControllerV2__factory,
  ConverterController, ConverterController__factory, DebtMonitor__factory,
  ForwarderV3__factory,
  HfPlatformAdapter,
  HfPoolAdapter,
  IERC20Metadata__factory,
  InvestFundV2__factory,
  JumpRateModelV2, Keeper__factory,
  MockToken,
  MultiBribe__factory,
  MultiGauge,
  MultiGauge__factory,
  PlatformVoter__factory,
  PriceOracleImitator,
  ProxyControlled,
  StrategySplitterV2__factory, SwapManager__factory,
  TetuConverter, TetuConverter__factory,
  TetuLiquidator__factory,
  TetuVaultV2,
  TetuVaultV2__factory,
  TetuVoter__factory,
  Uni3Swapper__factory,
  UniswapV3Callee,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
  UniswapV3Factory,
  UniswapV3Lib,
  UniswapV3Pool__factory,
  VaultFactory,
  VeDistributor,
  VeDistributor__factory,
  VeTetu,
  VeTetu__factory
} from "../../typechain";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {DeployerUtils} from "../utils/DeployerUtils";
import {Misc} from "../utils/Misc";
import {ProxyControlled as ProxyControlled_1_0_0} from "../../typechain/@tetu_io/tetu-liquidator/contracts/proxy";
import {getAddress, parseUnits} from "ethers/lib/utils";
import {generateAssetPairs} from "../utils/ConverterUtils";
import {BigNumber, BigNumberish} from "ethers";
import {DeployerUtilsLocal} from "../utils/DeployerUtilsLocal";
import {RunHelper} from "../utils/RunHelper";
import {IContracts, IVaultUniswapV3StrategyInfo} from "./types";

export async function deployBacktestSystem(
  signer: SignerWithAddress,
  currentSqrtPriceX96: BigNumberish,
  vaultAsset: string,
  token0: string,
  token1: string,
  poolFee: number,
  tickRange: number,
  rebalanceTickRange: number
): Promise<IContracts> {
  // deploy tokens
  const tokens: {[realAddress: string]: MockToken} = {}
  const mintAmount = '100000000000'; // 100b
  tokens[getAddress(MaticAddresses.USDC_TOKEN)] = await DeployerUtils.deployMockToken(signer, 'USDC', 6, mintAmount);
  tokens[getAddress(MaticAddresses.WETH_TOKEN)] = await DeployerUtils.deployMockToken(signer, 'WETH', 18, mintAmount);
  tokens[getAddress(MaticAddresses.WMATIC_TOKEN)] = await DeployerUtils.deployMockToken(signer, 'WMATIC', 18, mintAmount);
  tokens[getAddress(MaticAddresses.DAI_TOKEN)] =  await DeployerUtils.deployMockToken(signer, 'DAI', 18, mintAmount);
  tokens[getAddress(MaticAddresses.USDT_TOKEN)] = await DeployerUtils.deployMockToken(signer, 'USDT', 6, mintAmount);
  tokens[getAddress(MaticAddresses.miMATIC_TOKEN)] = await DeployerUtils.deployMockToken(signer, 'miMATIC', 18, mintAmount);
  tokens[getAddress(MaticAddresses.WBTC_TOKEN)] = await DeployerUtils.deployMockToken(signer, 'WBTC', 8, mintAmount);
  tokens[getAddress(MaticAddresses.wstETH_TOKEN)] = await DeployerUtils.deployMockToken(signer, 'wstETH', 18, mintAmount);
  tokens[getAddress(MaticAddresses.MaticX_TOKEN)] = await DeployerUtils.deployMockToken(signer, 'MaticX', 18, mintAmount);
  const tetu = await DeployerUtils.deployMockToken(signer, 'TETU');

  // deploy uniswap v3 and periphery
  const uniswapV3Factory = await DeployerUtils.deployContract(signer, 'UniswapV3Factory') as UniswapV3Factory;
  const uniswapV3Helper = await DeployerUtils.deployContract(signer, 'UniswapV3Lib') as UniswapV3Lib;
  const uniswapV3Calee = await DeployerUtils.deployContract(signer, 'UniswapV3Callee') as UniswapV3Callee;
  for (const [, token] of Object.entries(tokens)) {
    await token.approve(uniswapV3Calee.address, Misc.MAX_UINT)
  }

  // deploy pool
  await (await uniswapV3Factory.createPool(tokens[token0].address, tokens[token1].address, poolFee)).wait();
  const pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.getPool(
    tokens[token0].address,
    tokens[token1].address,
    poolFee,
  ), signer)
  await pool.initialize(currentSqrtPriceX96);

  // deploy tetu liquidator and setup
  let tx
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
  const liquidator = TetuLiquidator__factory.connect(liquidatorProxy.address, signer);
  tx = await liquidator.init(liquidatorController.address);
  await tx.wait();
  const uni3swapperLogic = await DeployerUtils.deployContract(signer, 'Uni3Swapper');
  const uni3swapperProxy = await DeployerUtils.deployContract(
    signer,
    '@tetu_io/tetu-liquidator/contracts/proxy/ProxyControlled.sol:ProxyControlled',
  ) as ProxyControlled_1_0_0;
  tx = await uni3swapperProxy.initProxy(uni3swapperLogic.address);
  await tx.wait();
  const uni3swapper = Uni3Swapper__factory.connect(uni3swapperProxy.address, signer);
  tx = await uni3swapper.init(liquidatorController.address);
  await tx.wait();

  const liquidatorPools: {
    pool: string,
    swapper: string,
    tokenIn: string,
    tokenOut: string,
  }[] = []

  liquidatorPools.push({
    pool: pool.address,
    swapper: uni3swapper.address,
    tokenIn: await pool.token0(),
    tokenOut: await pool.token1(),
  })
  liquidatorPools.push({
    pool: pool.address,
    swapper: uni3swapper.address,
    tokenIn: await pool.token1(),
    tokenOut: await pool.token0(),
  })

  await liquidator.addLargestPools(liquidatorPools, true);

  // deploy Compound and put liquidity
  const compPriceOracleImitator = await DeployerUtils.deployContract(
    signer,
    'CompPriceOracleImitator',
    tokens[vaultAsset].address,
    liquidator.address,
  ) as CompPriceOracleImitator;
  const comptroller = await DeployerUtils.deployContract(signer, 'Comptroller') as Comptroller;
  await comptroller._setPriceOracle(compPriceOracleImitator.address);
  // baseRatePerYear, multiplierPerYear, jumpMultiplierPerYear, kink_, owner_
  const compInterestRateModel = await DeployerUtils.deployContract(
    signer,
    'JumpRateModelV2',
    '1'/*'9512937595'*/,
    '1',
    '1',
    '1',
    signer.address,
  ) as JumpRateModelV2;

  const cTokens: {[realUnderlyingAddress: string]: CErc20Immutable} = {}
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
  const priceOracleImitator = await DeployerUtils.deployContract(
    signer,
    'PriceOracleImitator',
    tokens[vaultAsset].address,
    liquidator.address,
  ) as PriceOracleImitator;


  // deploy tetu converter and setup
  const converterController = ConverterController__factory.connect(await deployConverterProxy(signer, "ConverterController"), signer)
  const borrowManager = BorrowManager__factory.connect(await deployConverterProxy(signer, 'BorrowManager'), signer)
  const keeper = Keeper__factory.connect(await deployConverterProxy(signer, 'Keeper'), signer)
  const swapManager = SwapManager__factory.connect(await deployConverterProxy(signer, 'SwapManager'), signer)
  const debtMonitor = DebtMonitor__factory.connect(await deployConverterProxy(signer, 'DebtMonitor'), signer)
  const tetuConverter = TetuConverter__factory.connect(await deployConverterProxy(signer, "TetuConverter"), signer)
  const keeperCaller = await DeployerUtils.deployContract(signer, 'KeeperCaller');
  await converterController.init(
    signer.address,
    signer.address,
    tetuConverter.address,
    borrowManager.address,
    debtMonitor.address,
    keeper.address,
    swapManager.address,
    priceOracleImitator.address,
    liquidator.address,
    41142
  );
  await converterController.setMinHealthFactor2(101)
  await converterController.setTargetHealthFactor2(120)
  await converterController.setDebtGap(1000)
  await borrowManager.init(converterController.address, parseUnits('0.9'))
  await keeper.init(converterController.address, keeperCaller.address, 2 * 7 * 24 * 60 * 60,)
  await tetuConverter.init(converterController.address)
  await debtMonitor.init(converterController.address)
  await swapManager.init(converterController.address)

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
  const controller = ControllerV2__factory.connect(controllerProxy.address, signer);
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
  const gauge = MultiGauge__factory.connect(gaugeProxy.address, signer);
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
  const vaultFactory = await DeployerUtils.deployContract(
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

  // deploy strategy
  const platformVoterSigner = await DeployerUtilsLocal.impersonate(await controller.platformVoter());
  const poolToken0 = IERC20Metadata__factory.connect(await pool.token0(), signer);
  const poolToken1 = IERC20Metadata__factory.connect(await pool.token1(), signer);
  const vaultAssetAddress = tokens[vaultAsset].address
  const vaultStrategyInfo = await deployAndInitVaultAndUniswapV3Strategy(
    vaultAssetAddress,
    `TetuV2_UniswapV3_${await poolToken0.symbol()}-${await poolToken1.symbol()}-${poolFee}`,
    controller,
    gauge,
    vaultFactory,
    tetuConverter.address,
    signer,
    pool.address,
    tickRange,
    rebalanceTickRange,
  );

  await vaultStrategyInfo.strategy.connect(platformVoterSigner).setCompoundRatio(100000); // 100%
  await converterController.setWhitelistValues([vaultStrategyInfo.strategy.address,], true)

  return {
    tokens,
    vault: vaultStrategyInfo.vault,
    strategy: vaultStrategyInfo.strategy,
    uniswapV3Factory,
    uniswapV3Calee,
    uniswapV3Helper,
    pool,
    compPriceOracleImitator,
    comptroller,
    compInterestRateModel,
    cTokens,
    liquidator,
    uni3swapper,
    tetuConverter,
    priceOracleImitator,
    controller,
    gauge,
    vaultFactory,
  }
}

export async function deployAndInitVaultAndUniswapV3Strategy<T>(
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

async function deployConverterProxy(signer: SignerWithAddress, contract: string) {
  const logic = await DeployerUtils.deployContract(signer, contract);
  const proxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-converter/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
  await RunHelper.runAndWait(() => proxy.initProxy(logic.address));
  return proxy.address;
}