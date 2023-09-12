import {ethers} from "hardhat";
import {expect} from "chai";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {Misc} from "../../scripts/utils/Misc";
import {
  BalancerBoostedStrategy,
  BalancerBoostedStrategy__factory, ControllerV2,
  ControllerV2__factory,
  StrategySplitterV2__factory, TetuVaultV2__factory
} from "../../typechain";
import {DForceChangePriceUtils} from "../baseUT/converter/DForceChangePriceUtils";
import {UniversalTestUtils} from "../baseUT/utils/UniversalTestUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../baseUT/utils/HardhatUtils';

/**
 * Test to check upgrade BalancerBoostedStrategy 1.0.0 to 1.0.1 (move to balancer gauges v2)
 */
describe.skip("UpdateBalancerBoostedStrategyTest @skip-on-coverage", () => {
  const strategyAddress = "0xa99478F79A82663f8A7f5D8DD4aD4A46e22Ea540";

  let snapshot: string;
  let snapshotForEach: string;
  let signer: SignerWithAddress;

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region Unit tests
  async function upgradeStrategy(): Promise<{strategyAsGov: BalancerBoostedStrategy, controllerAsGov: ControllerV2}> {
    const core = await DeployerUtilsLocal.getCoreAddresses();

    const strategyLogic = await DeployerUtils.deployContract(signer, "BalancerBoostedStrategy");
    const controller = ControllerV2__factory.connect(core.controller, signer);
    const governance = await controller.governance();
    const controllerAsGov = controller.connect(await Misc.impersonate(governance));

    await controllerAsGov.announceProxyUpgrade([strategyAddress], [strategyLogic.address]);
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerAsGov.upgradeProxy([strategyAddress]);

    const strategyAsGov = BalancerBoostedStrategy__factory.connect(
      strategyAddress,
      await Misc.impersonate(governance)
    );
    await strategyAsGov.setGauge(MaticAddresses.BALANCER_GAUGE_V2_T_USD);
    return {strategyAsGov, controllerAsGov};
  }

  it("deploy BalancerBoostedStrategy", async () => {
    const {strategyAsGov} = await upgradeStrategy();
    expect((await strategyAsGov.gauge()).toLowerCase()).eq(MaticAddresses.BALANCER_GAUGE_V2_T_USD.toLowerCase());
  });

  it("should upgrade all strategies and reinvest the money", async () => {
    await DForceChangePriceUtils.setupPriceOracleMock(signer);

    // deploy all new strategies
    const strategy = await BalancerBoostedStrategy__factory.connect(strategyAddress, signer);
    const strategyAsOperator = strategy.connect(
      await UniversalTestUtils.getAnOperator(strategy.address, signer)
    );
    const splitter = StrategySplitterV2__factory.connect(await strategy.splitter(), signer);
    const vault = TetuVaultV2__factory.connect(await splitter.vault(), signer);

    const stateBefore = await vault.totalAssets();
    console.log("stateBefore", stateBefore);
    const investedAssetsBefore = await strategyAsOperator.callStatic.calcInvestedAssets();
    console.log("investedAssetsBefore", investedAssetsBefore);

    await upgradeStrategy();
    // await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);

    const stateAfter = await vault.totalAssets();
    console.log("stateAfter", stateAfter);
    const investedAssetsAfter = await strategyAsOperator.callStatic.calcInvestedAssets();
    console.log("investedAssetsAfter", investedAssetsAfter);

    // invest amounts back from vaults to the strategies
    // await splitter.connect(await Misc.impersonate(vault.address)).doHardWork();

    // const stateFinal = await vault.totalAssets();
    // console.log("stateFinal", stateFinal);
  });
//endregion Unit tests
});
