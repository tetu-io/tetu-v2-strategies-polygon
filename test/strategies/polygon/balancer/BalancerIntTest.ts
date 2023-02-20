import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployInfo} from "../../../baseUT/utils/DeployInfo";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  getConverterAddress,
  getDForcePlatformAdapter,
  getHundredFinancePlatformAdapter
} from "../../../../scripts/utils/Misc";
import {BalancerIntTestUtils} from "./utils/BalancerIntTestUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {IERC20__factory, IStrategyV2, ITetuLiquidator, TetuVaultV2} from "../../../../typechain";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {ICoreContractsWrapper} from "../../../CoreContractsWrapper";
import {IToolsContractsWrapper} from "../../../ToolsContractsWrapper";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {BigNumber} from "ethers";
import {VaultUtils} from "../../../VaultUtils";
chai.use(chaiAsPromised);

//region Utils
interface IPutInitialAmountsoBalancesResults {
  balanceUser: BigNumber;
  balanceSigner: BigNumber;
}

/**
 *  put DEPOSIT_AMOUNT => user, DEPOSIT_AMOUNT/2 => signer, DEPOSIT_AMOUNT/2 => liquidator
 */
async function putInitialAmountsToBalances(
  asset: string,
  user: SignerWithAddress,
  signer: SignerWithAddress,
  liquidator: ITetuLiquidator,
  amount: number
) : Promise<IPutInitialAmountsoBalancesResults>{
  const userBalance = await StrategyTestUtils.getUnderlying(user, asset, amount, liquidator, [signer.address]);

  // put half of signer's balance to liquidator
  const signerBalance = userBalance;
  await IERC20__factory.connect(asset, signer).transfer(liquidator.address, signerBalance.div(2));
  return {
    balanceSigner: await IERC20__factory.connect(asset, signer).balanceOf(signer.address),
    balanceUser: await IERC20__factory.connect(asset, signer).balanceOf(user.address),
  }
}

//endregion Utils

describe('BalancerIntTest', function() {
//region Constants and variables
  const MAIN_ASSET: string = PolygonAddresses.USDC_TOKEN;

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let addresses: CoreAddresses;
  let tetuConverterAddress: string;
  let user: SignerWithAddress;

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

    // Disable DForce (as it reverts on repay after block advance)
    await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());

    // Disable Hundred Finance (no liquidity)
    await ConverterUtils.disablePlatformAdapter(signer, getHundredFinancePlatformAdapter());
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
  describe("Strategy with fees", () => {
    const COMPOUND_RATIO = 50_000;
    const REINVEST_THRESHOLD_PERCENT = 1_000;
    const DEPOSIT_AMOUNT = 100_000;

    let localSnapshotBefore: string;
    let localSnapshot: string;
    let core: ICoreContractsWrapper;
    let tools: IToolsContractsWrapper;
    let vault: TetuVaultV2;
    let strategy: IStrategyV2;
    let asset: string;
    before(async function () {
      [signer] = await ethers.getSigners();
      localSnapshotBefore = await TimeUtils.snapshot();

      core = await DeployerUtilsLocal.getCoreAddressesWrapper(signer);
      tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);

      const strategyDeployer = await UniversalTestUtils.makeStrategyDeployer(addresses, MAIN_ASSET, tetuConverterAddress);
      const data = await strategyDeployer(signer);

      asset = await vault.asset();
      vault = data.vault;
      strategy = data.strategy;

      await UniversalTestUtils.setCompoundRatio(this.strategy, this.user, COMPOUND_RATIO);
      await BalancerIntTestUtils.setThresholds(
        this.strategy,
        this.user,
        {reinvestThresholdPercent: REINVEST_THRESHOLD_PERCENT}
      );

      // DEPOSIT_AMOUNT => user, DEPOSIT_AMOUNT/2 => signer, DEPOSIT_AMOUNT/2 => liquidator
      const initialBalances = await putInitialAmountsToBalances(
        asset,
        user,
        signer,
        tools.liquidator as ITetuLiquidator,
        DEPOSIT_AMOUNT,
      );

      // Enter to vault
      await VaultUtils.deposit(this.signer, this.vault, initialBalances.balanceSigner);
      await VaultUtils.deposit(this.user, this.vault, initialBalances.balanceUser);
      await UniversalTestUtils.removeExcessTokens(this.underlying, this.user, this.tools.liquidator.address);
      await UniversalTestUtils.removeExcessTokens(this.underlying, this.signer, this.tools.liquidator.address);
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
  });

  describe("Withdraw", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {

      });
    });
    describe("Bad paths", () => {

    });
    describe("Gas estimation @skip-on-coverage", () => {

    });
  });

  describe("Withdraw all TODO", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {

      });
    });
    describe("Bad paths", () => {

    });
    describe("Gas estimation @skip-on-coverage", () => {

    });
  });

  describe("Emergency exit TODO", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {

      });
    });
    describe("Bad paths", () => {

    });
    describe("Gas estimation @skip-on-coverage", () => {

    });
  });

//endregion Integration tests
});