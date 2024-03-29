/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  IERC20,
  IERC20__factory, IStrategyV2,
  ISwapper,
  ISwapper__factory, KyberConverterStrategy, KyberConverterStrategy__factory, KyberLib, TetuVaultV2,
} from "../../../../typechain";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {KyberLiquidityUtils} from "../../../baseUT/strategies/kyber/KyberLiquidityUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {AggregatorUtils} from "../../../baseUT/utils/AggregatorUtils";
import {PLAN_REPAY_SWAP_REPAY_1} from "../../../baseUT/AppConstants";
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";
import {buildEntryData1} from "../../../baseUT/utils/EntryDataUtils";

/// Kyber is not used after security incident nov-2023
describe.skip('KyberConverterStrategy reduce debt by agg test', function() {

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let swapper: ISwapper;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: KyberConverterStrategy;
  let lib: KyberLib;

  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID, -1);
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.switchToMostCurrentBlock();

    [signer] = await ethers.getSigners();
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);
    await InjectUtils.injectTetuConverterBeforeAnyTest(signer);

    const core = Addresses.getCore();
    const controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    const converterAddress = getConverterAddress();
    swapper = ISwapper__factory.connect(MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, signer);

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
          21,
            [0, 0, Misc.MAX_UINT, 0],
        );

        return _strategy as unknown as IStrategyV2;
      },
      controller,
      gov,
      1_000,
      300,
      300,
      false,
    );
    strategy = data.strategy as KyberConverterStrategy
    vault = data.vault.connect(signer)

    await ConverterUtils.whitelist([strategy.address]);
    await vault.connect(gov).setWithdrawRequestBlocks(0)

    await ConverterUtils.disableAaveV2(signer)

    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
    await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, parseUnits('0.001', 6));

    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.KNC_TOKEN,])
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

    lib = await DeployerUtils.deployContract(signer, 'KyberLib') as KyberLib
  })

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

  it('Reduce debt after rebalanceNoSwaps', async() => {
    const s = strategy

    console.log('deposit...');
    await asset.approve(vault.address, Misc.MAX_UINT);
    await TokenUtils.getToken(asset.address, signer.address, parseUnits('1000', 6));
    await vault.deposit(parseUnits('1000', 6), signer.address);

    const state = await PackedData.getDefaultState(strategy);
    for (let i = 0; i < 3; i++) {
      console.log(`Swap and rebalance. Step ${i}`)
      const amounts = await KyberLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib, MaticAddresses.KYBER_USDC_USDT)

      const priceB = await lib.getPrice(MaticAddresses.KYBER_USDC_USDT, MaticAddresses.USDT_TOKEN)
      let swapAmount = amounts[1].mul(priceB).div(parseUnits('1', 6))
      swapAmount = swapAmount.add(swapAmount.div(100))

      await UniversalUtils.movePoolPriceUp(signer, state, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, swapAmount);

      if (!(await strategy.needRebalance())) {
        console.log('Not need rebalance. Something wrong')
        process.exit(-1)
      }

      await strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
    }

    expect(await s.needRebalance()).eq(false)

    const planEntryData = buildEntryData1();

    const quote = await strategy.callStatic.quoteWithdrawByAgg(planEntryData);

    console.log('Quote', quote);

    const swapData = await AggregatorUtils.buildSwapTransactionDataForOneInch(
      POLYGON_NETWORK_ID,
      quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
      quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
      quote.amountToSwap,
      s.address,
    );

    await strategy.withdrawByAggStep(
      quote.tokenToSwap,
        MaticAddresses.AGG_ONEINCH_V5,
      quote.amountToSwap,
      swapData,
      planEntryData,
      1
    );

    expect(await s.needRebalance()).eq(false)
  })
})
