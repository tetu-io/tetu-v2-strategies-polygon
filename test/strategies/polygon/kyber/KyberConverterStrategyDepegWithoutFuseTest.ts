/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  ConverterStrategyBase, IBorrowManager__factory, IConverterController__factory,
  IERC20,
  IERC20__factory,
  IPriceOracle__factory,
  IStrategyV2,
  ITetuConverter__factory, IPairBasedStrategyReaderAccess__factory,
  KyberConverterStrategy,
  KyberConverterStrategy__factory, KyberLib,
  TetuVaultV2,
  VaultFactory__factory,
} from "../../../../typechain";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {KyberLiquidityUtils} from "../../../baseUT/strategies/kyber/KyberLiquidityUtils";
import {writeFileSyncRestoreFolder} from "../../../baseUT/utils/FileUtils";
import {writeFileSync} from "fs";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {KYBER_PID} from "../../../baseUT/strategies/pair/PairBasedStrategyBuilder";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";

/// Kyber is not used after security incident nov-2023
describe.skip('KyberConverterStrategyDepegWithoutFuseTest', function() {

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let operator: SignerWithAddress;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: KyberConverterStrategy;
  let lib: KyberLib;
  const pId = KYBER_PID;

  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.switchToMostCurrentBlock();

    [signer] = await ethers.getSigners();
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);
    await InjectUtils.injectTetuConverterBeforeAnyTest(signer);

    const core = Addresses.getCore();
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    const controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    const converterAddress = getConverterAddress();

    // use the latest implementations
    const vaultLogic = await DeployerUtils.deployContract(signer, 'TetuVaultV2');
    const splitterLogic = await DeployerUtils.deployContract(signer, 'StrategySplitterV2');
    const vaultFactory = VaultFactory__factory.connect(core.vaultFactory, signer);
    await vaultFactory.connect(gov).setVaultImpl(vaultLogic.address);
    await vaultFactory.connect(gov).setSplitterImpl(splitterLogic.address);

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_Kyber_USDC_USDT',
      async(_splitterAddress: string) => {
        const _strategy = KyberConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'KyberConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          converterAddress,
          MaticAddresses.KYBER_USDC_USDT,
          0,
          0,
          true,
          pId,
            [0, 0, Misc.MAX_UINT, 0],
        );

        return _strategy as unknown as IStrategyV2;
      },
      controller,
      gov,
      0,
      0,
      300,
      false,
    );
    strategy = data.strategy as KyberConverterStrategy
    vault = data.vault.connect(signer)

    await ConverterUtils.whitelist([strategy.address]);
    await vault.connect(gov).setWithdrawRequestBlocks(0)

    operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)
    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.KNC_TOKEN,])
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

    const platformVoter = await DeployerUtilsLocal.impersonate(await controller.platformVoter());
    await strategy.connect(platformVoter).setCompoundRatio(50000);

    const pools = [
      {
        pool: MaticAddresses.KYBER_KNC_USDC,
        swapper: MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
        tokenIn: MaticAddresses.KNC_TOKEN,
        tokenOut: MaticAddresses.USDC_TOKEN,
      },
    ]
    await tools.liquidator.connect(operator).addLargestPools(pools, true);

    // prevent 'TC-4 zero price' because real oracles have a limited price lifetime
    // await PriceOracleImitatorUtils.uniswapV3(signer, MaticAddresses.UNISWAPV3_USDC_USDT_100, MaticAddresses.USDC_TOKEN)
    await PriceOracleImitatorUtils.kyber(signer, MaticAddresses.KYBER_USDC_USDT, MaticAddresses.USDC_TOKEN)

    lib = await DeployerUtils.deployContract(signer, 'KyberLib') as KyberLib
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
    await HardhatUtils.restoreBlockFromEnv();
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  it('Depeg USDT', async() => {
    const changeTicksPerStep = 1
    const steps = 30
    const rowsCaption = ['Step', 'USDT Price', 'Total assets', 'USDT Collateral', 'USDC Amount to repay', 'Locked underlying %', 'Locked underlying amount', 'Health Factor']
    const rows: [string, number, number, number, number, number, number, number][] = []
    const s = strategy
    const state = await PackedData.getDefaultState(s);

    console.log('deposit...');
    await asset.approve(vault.address, Misc.MAX_UINT);
    await TokenUtils.getToken(asset.address, signer.address, parseUnits('2000', 6));
    await vault.deposit(parseUnits('1000', 6), signer.address);

    let amounts
    let priceA
    let swapAmount
    let borrowInfo = await getBorrowInfo(s as unknown as ConverterStrategyBase, signer)
    const priceBStart = await lib.getPrice(MaticAddresses.KYBER_USDC_USDT, MaticAddresses.USDT_TOKEN)
    rows.push([
        '#0',
      +formatUnits(priceBStart, 6),
      +formatUnits(await s.totalAssets(), 6),
      borrowInfo[1].collaterals[0],
      borrowInfo[1].amountsToRepay[0],
      borrowInfo[1].totalLockedAmountInUnderlying / +formatUnits(await s.totalAssets(), 6) * 100,
      borrowInfo[1].totalLockedAmountInUnderlying,
      borrowInfo[0].healthFactors[0][0]]
    )

    for (let i = 1; i <= steps; i++) {
      console.log(``)
      console.log(`## STEP ${i}`)
      // console.log(`# changing price to ${changeTicksPerStep} ticks lower`)
      const priceBBefore = await lib.getPrice(MaticAddresses.KYBER_USDC_USDT, MaticAddresses.USDT_TOKEN)
      for (let k = 0; k < changeTicksPerStep; k++) {
        amounts = await KyberLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib, MaticAddresses.KYBER_USDC_USDT)
        // console.log(amounts)
        priceA = await lib.getPrice(MaticAddresses.KYBER_USDC_USDT, MaticAddresses.USDC_TOKEN)
        // console.log('priceA', priceA)
        swapAmount = amounts[0].mul(priceA).div(parseUnits('1', 6))
        if (k > 0) {
          swapAmount = swapAmount.add(swapAmount.div(100))
        } else {
          swapAmount = swapAmount.add(parseUnits('0.001', 6))
        }
        // console.log ('SwapAmount to change tick', swapAmount)
        // console.log(`Price down ${i}`)
        await UniversalUtils.movePoolPriceDown(signer, state, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, swapAmount, 40000, true);
      }

      // console.log(`# setting price to middle of tick`)
      amounts = await KyberLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib, MaticAddresses.KYBER_USDC_USDT)
      priceA = await lib.getPrice(MaticAddresses.KYBER_USDC_USDT, MaticAddresses.USDC_TOKEN)
      swapAmount = amounts[0].mul(priceA).div(parseUnits('1', 6)).div(2)
      // console.log ('swapAmount to set middle tick price', swapAmount)
      await UniversalUtils.movePoolPriceDown(signer, state, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, swapAmount, 40000, true);

      const priceBAfter = await lib.getPrice(MaticAddresses.KYBER_USDC_USDT, MaticAddresses.USDT_TOKEN)
      console.log(`# USDT price changed: ${formatUnits(priceBBefore, 6)} -> ${formatUnits(priceBAfter, 6)}`)

      if (await s.needRebalance()) {
        console.log(`# Rebalance..`)
        // expect(await s.needRebalance()).eq(true)
        await s.rebalanceNoSwaps(true, {gasLimit: 19_000_000,})
        expect(await s.needRebalance()).eq(false)

        borrowInfo = await getBorrowInfo(s as unknown as ConverterStrategyBase, signer)
        const row: [string, number, number, number, number, number, number, number] = [
            '#' + i,
          +formatUnits(priceBAfter, 6),
          +formatUnits(await s.totalAssets(), 6),
          borrowInfo[1].collaterals[0],
          borrowInfo[1].amountsToRepay[0],
          borrowInfo[1].totalLockedAmountInUnderlying / +formatUnits(await s.totalAssets(), 6) * 100,
          borrowInfo[1].totalLockedAmountInUnderlying,
          borrowInfo[1].healthFactors[0][0]
        ]
        console.log(row)
        rows.push(row)
      }
    }

    const pathOut = 'tmp/Kyber_depeg_USDT.csv'
    writeFileSyncRestoreFolder(pathOut, rowsCaption.join(';') + '\n', { encoding: 'utf8', flag: 'w'});
    for (const row of rows) {
      writeFileSync(
        pathOut,
        row.join(';') + '\n',
        { encoding: 'utf8', flag: 'a' },
      );
    }
  })
})

async function getBorrowInfo(
  strategy: ConverterStrategyBase,
  signer: SignerWithAddress
) {
  const converter = await ITetuConverter__factory.connect(await strategy.converter(), signer);
  const priceOracle = IPriceOracle__factory.connect(
    await IConverterController__factory.connect(await converter.controller(), signer).priceOracle(),
    signer
  );
  const borrowManager = await IBorrowManager__factory.connect(
    await IConverterController__factory.connect(await converter.controller(), signer).borrowManager(),
    signer
  );

  const strategyReaderReaderAccess = IPairBasedStrategyReaderAccess__factory.connect(strategy.address, signer)
  const state  = await PackedData.getDefaultState(strategyReaderReaderAccess);
  const tokenA = state.tokenA;
  const tokenB = state.tokenB;
  // console.log('tokenA', tokenA)
  // console.log('tokenB', tokenB)

  const directBorrows = await StateUtilsNum.getBorrowInfo(signer, converter, borrowManager, strategy, [tokenA], [tokenB], priceOracle, true);
  const reverseBorrows = await StateUtilsNum.getBorrowInfo(signer, converter, borrowManager, strategy, [tokenB], [tokenA], priceOracle, false);

  // console.log('directBorrows', directBorrows)
  // console.log('reverseBorrows', reverseBorrows)
  return [directBorrows, reverseBorrows]
}
