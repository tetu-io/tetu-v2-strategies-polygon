import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  getAaveTwoPlatformAdapter,
  getConverterAddress,
  getDForcePlatformAdapter,
  getHundredFinancePlatformAdapter, Misc
} from "../../../../scripts/utils/Misc";
import {BalancerIntTestUtils, IPutInitialAmountsBalancesResults, IState} from "./utils/BalancerIntTestUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {
  Aave3AggregatorInterfaceMock,
  BalancerComposableStableStrategy,
  BalancerComposableStableStrategy__factory,
  ControllerV2__factory,
  IAave3PriceOracle,
  IAave3PriceOracle__factory, IBalancerBoostedAavePool__factory,
  IBalancerBoostedAaveStablePool__factory,
  IBVault__factory,
  IConverterController__factory,
  IERC20__factory,
  IPriceOracle,
  IPriceOracle__factory,
  ISplitter,
  ISplitter__factory,
  IStrategyV2,
  ITetuConverter__factory,
  ITetuLiquidator,
  TetuVaultV2
} from "../../../../typechain";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {ICoreContractsWrapper} from "../../../CoreContractsWrapper";
import {IToolsContractsWrapper} from "../../../ToolsContractsWrapper";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {BigNumber} from "ethers";
import {VaultUtils} from "../../../VaultUtils";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {controlGasLimitsEx} from "../../../../scripts/utils/GasLimitUtils";
import {
  GAS_DEPOSIT_SIGNER, GAS_EMERGENCY_EXIT,
  GAS_FIRST_HARDWORK, GAS_HARDWORK_WITH_REWARDS,
  GAS_WITHDRAW_ALL_TO_SPLITTER
} from "../../../baseUT/GasLimits";
import {areAlmostEqual} from "../../../baseUT/utils/MathUtils";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {MaticHolders} from "../../../../scripts/MaticHolders";
import {BalancerDaiUsdcUsdtPoolUtils} from "./utils/BalancerDaiUsdcUsdtPoolUtils";
chai.use(chaiAsPromised);

/**
 * Price of borrowed asset is significantly changed.
 * Disable all lending platforms except AAVE3,
 * Set mocked price-source to AAVE3's price oracle for DAI, USDC and USDT to be able to control the prices.
 */
describe('BalancerIntPriceChangeTest', function() {
//region Constants and variables
  const MAIN_ASSET: string = PolygonAddresses.USDC_TOKEN;

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let addresses: CoreAddresses;
  let tetuConverterAddress: string;
  let user: SignerWithAddress;

  let daiPriceSource: Aave3AggregatorInterfaceMock;
  let usdcPriceSource: Aave3AggregatorInterfaceMock;
  let usdtPriceSource: Aave3AggregatorInterfaceMock;

  let priceOracleAave3: IAave3PriceOracle;
  let priceOracleInTetuConverter: IPriceOracle;

//endregion Constants and variables

//region before, after
  before(async function () {
    signer = await DeployerUtilsLocal.impersonate(); // governance by default
    user = (await ethers.getSigners())[1];

    snapshotBefore = await TimeUtils.snapshot();

    addresses = Addresses.getCore();
    tetuConverterAddress = getConverterAddress();

    await BalancerIntTestUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);
    await BalancerIntTestUtils.deployAndSetCustomSplitter(signer, addresses);

    // Disable all lending platforms except AAVE3
    await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());
    await ConverterUtils.disablePlatformAdapter(signer, getHundredFinancePlatformAdapter());
    await ConverterUtils.disablePlatformAdapter(signer, getAaveTwoPlatformAdapter());

    //  See first event for of ACLManager (AAVE_V3_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD")
    //  https://polygonscan.com/address/0xa72636cbcaa8f5ff95b2cc47f3cdee83f3294a0b#readContract
    const AAVE_V3_POOL_OWNER = "0xdc9a35b16db4e126cfedc41322b3a36454b1f772";
    const poolOwner = await Misc.impersonate(AAVE_V3_POOL_OWNER);

    // Set up mocked price-source to AAVE3's price oracle
    // Tetu converter uses same price oracle internally
    const AAVE_V3_PRICE_ORACLE = "0xb023e699F5a33916Ea823A16485e259257cA8Bd1";
    const priceOracleAsPoolOwner: IAave3PriceOracle = IAave3PriceOracle__factory.connect(AAVE_V3_PRICE_ORACLE, poolOwner);

    const priceDai = await priceOracleAsPoolOwner.getAssetPrice(MaticAddresses.DAI_TOKEN);
    const priceUsdc = await priceOracleAsPoolOwner.getAssetPrice(MaticAddresses.USDC_TOKEN);
    const priceUsdt = await priceOracleAsPoolOwner.getAssetPrice(MaticAddresses.USDT_TOKEN);

    daiPriceSource = await MockHelper.createAave3AggregatorInterfaceMock(signer, priceDai);
    usdcPriceSource = await MockHelper.createAave3AggregatorInterfaceMock(signer, priceUsdc);
    usdtPriceSource = await MockHelper.createAave3AggregatorInterfaceMock(signer, priceUsdt);

    await priceOracleAsPoolOwner.setAssetSources([MaticAddresses.DAI_TOKEN], [daiPriceSource.address]);
    await priceOracleAsPoolOwner.setAssetSources([MaticAddresses.USDC_TOKEN], [usdcPriceSource.address]);
    await priceOracleAsPoolOwner.setAssetSources([MaticAddresses.USDT_TOKEN], [usdtPriceSource.address]);

    priceOracleAave3 = priceOracleAsPoolOwner.connect(signer);

    priceOracleInTetuConverter = await IPriceOracle__factory.connect(
      await IConverterController__factory.connect(
        await ITetuConverter__factory.connect(tetuConverterAddress, signer).controller(),
        signer
      ).priceOracle(),
      signer
    );
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Integration tests
  describe("Single strategy with fees", () => {
    const COMPOUND_RATIO = 50_000;
    const REINVEST_THRESHOLD_PERCENT = 1_000;
    const DEPOSIT_AMOUNT = 100_000;
    const DEPOSIT_FEE = 2_00; // 100_000
    const BUFFER = 1_00; // 100_000
    const WITHDRAW_FEE = 5_00; // 100_000
    const DENOMINATOR = 100_000;

    let localSnapshotBefore: string;
    let localSnapshot: string;
    let core: ICoreContractsWrapper;
    let tools: IToolsContractsWrapper;
    let vault: TetuVaultV2;
    let strategy: BalancerComposableStableStrategy;
    let asset: string;
    let splitter: ISplitter;
    let stateBeforeDeposit: IState;
    let initialBalances: IPutInitialAmountsBalancesResults;
    let forwarder: string;

    /**
     * DEPOSIT_AMOUNT => user, DEPOSIT_AMOUNT/2 => signer, DEPOSIT_AMOUNT/2 => liquidator
     */
    async function enterToVault() : Promise<IState> {
      await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner);
      await VaultUtils.deposit(user, vault, initialBalances.balanceUser);
      await UniversalTestUtils.removeExcessTokens(asset, user, tools.liquidator.address);
      await UniversalTestUtils.removeExcessTokens(asset, signer, tools.liquidator.address);
      return BalancerIntTestUtils.getState(signer, user, strategy, vault);
    }

    before(async function () {
      [signer] = await ethers.getSigners();
      localSnapshotBefore = await TimeUtils.snapshot();

      core = await DeployerUtilsLocal.getCoreAddressesWrapper(signer);
      tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);

      const data = await UniversalTestUtils.makeStrategyDeployer(
        signer,
        addresses,
        MAIN_ASSET,
        tetuConverterAddress,
        "BalancerComposableStableStrategy",
        {
          depositFee: DEPOSIT_FEE,
          buffer: BUFFER,
          withdrawFee: WITHDRAW_FEE
        }
      );

      vault = data.vault;
      asset = await data.vault.asset();
      strategy = data.strategy as unknown as BalancerComposableStableStrategy;
      splitter = ISplitter__factory.connect(await vault.splitter(), signer);
      forwarder = await ControllerV2__factory.connect(await vault.controller(), signer).forwarder();
      console.log("vault", vault.address);
      console.log("strategy", strategy.address);
      console.log("splitter", splitter.address);
      console.log("forwarder", forwarder);

      await UniversalTestUtils.setCompoundRatio(strategy as unknown as IStrategyV2, user, COMPOUND_RATIO);
      await BalancerIntTestUtils.setThresholds(
        strategy as unknown as IStrategyV2,
        user,
        {reinvestThresholdPercent: REINVEST_THRESHOLD_PERCENT}
      );

      initialBalances = await BalancerIntTestUtils.putInitialAmountsToBalances(
        asset,
        user,
        signer,
        tools.liquidator as ITetuLiquidator,
        DEPOSIT_AMOUNT,
      );

      stateBeforeDeposit = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
    });

    after(async function () {
      await TimeUtils.rollback(localSnapshotBefore);
    });

    beforeEach(async function () {
      localSnapshot = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(localSnapshot);
    });

    /**
     * We change both DAI and USDT
     * because after deposit we have either DAI or USDT not-zero amount on strategy balance
     * (but not both)
     */
    describe("DAI and USDT price are reduced on 10%", () => {
      it("should change prices in AAVE3 and TC oracles", async () => {
        // prices before
        const daiPriceAave3 = await priceOracleAave3.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceAave3 = await priceOracleAave3.getAssetPrice(MaticAddresses.USDT_TOKEN);

        const daiPriceTC = await priceOracleInTetuConverter.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceTC = await priceOracleInTetuConverter.getAssetPrice(MaticAddresses.USDT_TOKEN);

        // reduce prices
        const daiPrice = await daiPriceSource.price();
        const daiNewPrice = daiPrice.mul(90).div(100);
        await daiPriceSource.setPrice(daiNewPrice);
        const daiPrice18 = daiPrice.mul(parseUnits("1", 10)); // see PriceOracle impl in TC
        const daiNewPrice18 = daiNewPrice.mul(parseUnits("1", 10)); // see PriceOracle impl in TC

        const usdtPrice = await usdtPriceSource.price();
        const usdtNewPrice = usdtPrice.mul(90).div(100);
        await usdtPriceSource.setPrice(usdtNewPrice);
        const usdtPrice18 = usdtPrice.mul(parseUnits("1", 10)); // see PriceOracle impl in TC
        const usdtNewPrice18 = usdtNewPrice.mul(parseUnits("1", 10)); // see PriceOracle impl in TC

        // prices after
        const daiPriceAave31 = await priceOracleAave3.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceAave31 = await priceOracleAave3.getAssetPrice(MaticAddresses.USDT_TOKEN);

        const daiPriceTC1 = await priceOracleInTetuConverter.getAssetPrice(MaticAddresses.DAI_TOKEN);
        const usdtPriceTC1 = await priceOracleInTetuConverter.getAssetPrice(MaticAddresses.USDT_TOKEN);

        // compare
        const ret = [
          daiPriceAave3, daiPriceTC, usdtPriceAave3, usdtPriceTC,
          daiPriceAave31, daiPriceTC1, usdtPriceAave31, usdtPriceTC1
        ].map(x => BalanceUtils.toString(x)).join("\n");
        const expected = [
          daiPrice, daiPrice18, usdtPrice, usdtPrice18,
          daiNewPrice, daiNewPrice18, usdtNewPrice, usdtNewPrice18
        ].map(x => BalanceUtils.toString(x)).join("\n");

        expect(ret).eq(expected);
      });
      it("should change prices in Balancer pool", async () => {
        const r = await BalancerDaiUsdcUsdtPoolUtils.swapDaiToUsdt(
          signer,
          parseUnits("100000", 18),
          2
        );
        const ret = [
          r.priceRatioSourceAsset18.gt(Misc.ONE18),
          r.pricesRatioTargetAsset18.gt(Misc.ONE18),
          // r.pricesRatioTargetAsset18.mul(r.priceRatioSourceAsset18).mul(100).div(Misc.ONE18).div(Misc.ONE18)
        ].join();
        const expected = [
          false,
          true,
          // 100 // 100.678 ~ 100
        ].join();

        expect(ret).eq(expected);
      });
      describe("Deposit, reduce price, check state", () => {
        it("should return expected values", async () => {
          // const stateAfterDeposit = await enterToVault();

          // let's put additional amounts on strategy balance to enable swap in calcInvestedAssets
          const holderDAI = MaticHolders.HOLDER_DAI;
          const holderUSDT = MaticHolders.HOLDER_USDT;

          await IERC20__factory.connect(
            MaticAddresses.DAI_TOKEN,
            await Misc.impersonate(holderDAI)
          ).transfer(strategy.address, parseUnits("10000", 18));

          await IERC20__factory.connect(
            MaticAddresses.USDT_TOKEN,
            await Misc.impersonate(holderUSDT)
          ).transfer(strategy.address, parseUnits("10000", 6));

          await strategy.calcInvestedAssets();
          const stateBefore = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

          // reduce prices
          const daiPrice = await daiPriceSource.price();
          const daiNewPrice = daiPrice.mul(90).div(100);
          await daiPriceSource.setPrice(daiNewPrice);

          const usdtPrice = await usdtPriceSource.price();
          const usdtNewPrice = usdtPrice.mul(90).div(100);
          await usdtPriceSource.setPrice(usdtNewPrice);

          // let's update _investedAssets
          await strategy.calcInvestedAssets();

          const stateAfter = await BalancerIntTestUtils.getState(signer, user, strategy, vault);

          // console.log("stateAfterDeposit", stateAfterDeposit);
          console.log("stateBefore", stateBefore);
          console.log("stateAfter", stateAfter);
        });
      });
    });
  });

//endregion Integration tests
});