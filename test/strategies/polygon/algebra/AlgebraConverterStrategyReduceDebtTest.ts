/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  AlgebraConverterStrategy, AlgebraConverterStrategy__factory, AlgebraLib,
  IERC20,
  IERC20__factory, IStrategyV2,
  ISwapper,
  ISwapper__factory, TetuVaultV2,
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
import {AlgebraLiquidityUtils} from "../../../baseUT/strategies/algebra/AlgebraLiquidityUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {AggregatorUtils} from "../../../baseUT/utils/AggregatorUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {PLAN_REPAY_SWAP_REPAY_1} from "../../../baseUT/AppConstants";
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";
import {buildEntryData1} from "../../../baseUT/utils/EntryDataUtils";

describe('AlgebraConverterStrategy reduce debt by agg test', function() {

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let swapper: ISwapper;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: AlgebraConverterStrategy;
  let lib: AlgebraLib;

  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID, -1);
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.switchToMostCurrentBlock(); // 1inch works on current block only

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
      'TetuV2_Algebra_USDC_USDT',
      async(_splitterAddress: string) => {
        const _strategy = AlgebraConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'AlgebraConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          converterAddress,
          MaticAddresses.ALGEBRA_USDC_USDT,
          0,
          0,
          true,
          {
            rewardToken: MaticAddresses.dQUICK_TOKEN,
            bonusRewardToken: MaticAddresses.WMATIC_TOKEN,
            pool: MaticAddresses.ALGEBRA_USDC_USDT,
            startTime: 1663631794,
            endTime: 4104559500
          },
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
    strategy = data.strategy as AlgebraConverterStrategy
    vault = data.vault.connect(signer)

    await ConverterUtils.whitelist([strategy.address]);
    await vault.connect(gov).setWithdrawRequestBlocks(0)

    await ConverterUtils.disableAaveV2(signer)

    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
    await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, parseUnits('0.001', 6));

    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.dQUICK_TOKEN, MaticAddresses.WMATIC_TOKEN,])
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

    lib = await DeployerUtils.deployContract(signer, 'AlgebraLib') as AlgebraLib
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
      const amounts = await AlgebraLiquidityUtils.getLiquidityAmountsInCurrentTickspacing(signer, lib, MaticAddresses.ALGEBRA_USDC_USDT)
      console.log('amounts', amounts)
      const priceB = await lib.getPrice(MaticAddresses.ALGEBRA_USDC_USDT, MaticAddresses.USDT_TOKEN)
      let swapAmount = amounts[1].mul(priceB).div(parseUnits('1', 6))
      swapAmount = swapAmount.add(swapAmount.div(100))

      await UniversalUtils.movePoolPriceUp(signer, state, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, swapAmount);

      if (!(await strategy.needRebalance())) {
        console.log('Not need rebalance. Something wrong')
        process.exit(-1)
      }

      await strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000})
    }

    expect(await s.needRebalance()).eq(false)

    const planEntryData = buildEntryData1();
    const quote = await strategy.callStatic.quoteWithdrawByAgg(planEntryData);

    console.log('Quote', quote)

    const swapData = AggregatorUtils.buildSwapTransactionData(
        quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
        quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
        quote.amountToSwap,
        s.address,
    );

    await strategy.withdrawByAggStep(
      quote.tokenToSwap,
      MaticAddresses.AGG_ONEINCH_V5,
      quote.amountToSwap,
      swapData, // swapTransaction.data,
      planEntryData,
      1
    );

    expect(await s.needRebalance()).eq(false)
  })
})
