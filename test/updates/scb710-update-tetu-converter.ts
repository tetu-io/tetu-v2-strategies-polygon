import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {Misc} from "../../scripts/utils/Misc";
import {
  ControllerV2__factory, ConverterStrategyBase__factory,
  IRebalancingStrategy__factory, ISplitter__factory,
  TetuConverter__factory, TetuVaultV2__factory,
} from "../../typechain";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {DForceChangePriceUtils} from "../baseUT/integration/dforce/DForceChangePriceUtils";
import {StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {Uniswapv3StateUtils} from "../strategies/polygon/uniswapv3/utils/Uniswapv3StateUtils";

/**
 * Upgrade TetuConverter to fix SCB-710
 * Run rebalance() on univ3/algebra strategy
 * Try to make withdrawAll and deposit on the strategy
 */
describe("scb710-update-tetu-converter @skip-on-coverage", () => {
  const TETU_CONVERTER_PROXY = "0x5E1226f7e743cA56537B3fab0C1A9ea2FAe7BAb1";
  const UNIV3_USDC_USDT_STRATEGY = "0x05C7D307632a36D31D7eECbE4cC5Aa46D15fA752";
  const ALGEBRA_USDC_USDT_STRATEGY = "0x3019e52aCb4717cDF79323592f1F897d243278F4";

  let snapshot: string;
  let snapshotForEach: string;
  let signer: SignerWithAddress;

//region before, after
  before(async function () {
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

  async function upgradeConverter(core: CoreAddresses) {
    console.log("Converter version before", await TetuConverter__factory.connect(TETU_CONVERTER_PROXY, signer).TETU_CONVERTER_VERSION());

    // apply fix to TetuConverter
    const converterLogic = await DeployerUtils.deployContract(signer, "@tetu_io/tetu-converter/contracts/core/TetuConverter.sol:TetuConverter");
    console.log("Converter version of converterLogic", await TetuConverter__factory.connect(converterLogic.address, signer).TETU_CONVERTER_VERSION());

    const controller = ControllerV2__factory.connect(core.controller, signer);
    const governance = await controller.governance();
    const controllerAsGov = controller.connect(await Misc.impersonate(governance));

    await controllerAsGov.announceProxyUpgrade([TETU_CONVERTER_PROXY], [converterLogic.address]);
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerAsGov.upgradeProxy([TETU_CONVERTER_PROXY]);

    console.log("Converter version after", await TetuConverter__factory.connect(TETU_CONVERTER_PROXY, signer).TETU_CONVERTER_VERSION());

    return {governance, core};
  }

  it("rebalance univ3, shouldn't revert", async () => {
    const core = await DeployerUtilsLocal.getCoreAddresses();
    const controller = ControllerV2__factory.connect(core.controller, signer);
    const governance = await controller.governance();

    const strategy = ConverterStrategyBase__factory.connect(UNIV3_USDC_USDT_STRATEGY, signer);
    await DForceChangePriceUtils.setupPriceOracleMock(signer, true);

    await upgradeConverter(core);

    // try to make rebalance
    const strategyAsGov = IRebalancingStrategy__factory.connect(
      strategy.address,
      await Misc.impersonate(governance)
    );

    const state1 = await StateUtilsNum.getState(
      signer,
      signer,
      strategy,
      TetuVaultV2__factory.connect(await ISplitter__factory.connect(await strategy.splitter(), signer).vault(), signer),
      "s1"
    );
    console.log("state before", state1);
    await strategyAsGov.rebalance();
    const state2 = await StateUtilsNum.getState(
      signer,
      signer,
      strategy,
      TetuVaultV2__factory.connect(await ISplitter__factory.connect(await strategy.splitter(), signer).vault(), signer),
      "s2"
    );
    console.log("state after", state2);
  });

  it("rebalance algebra, shouldn't revert", async () => {
    const core = await DeployerUtilsLocal.getCoreAddresses();
    const controller = ControllerV2__factory.connect(core.controller, signer);
    const governance = await controller.governance();

    const strategy = ConverterStrategyBase__factory.connect(ALGEBRA_USDC_USDT_STRATEGY, signer);
    await DForceChangePriceUtils.setupPriceOracleMock(signer, true);

    await upgradeConverter(core);
    // try to make rebalance
    const strategyAsGov = IRebalancingStrategy__factory.connect(
      strategy.address,
      await Misc.impersonate(governance)
    );

    await strategyAsGov.rebalance();
  });

  it("withdraw all", async () => {
    const user = await DeployerUtilsLocal.impersonate("0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94");
    const core = await DeployerUtilsLocal.getCoreAddresses();
    const controller = ControllerV2__factory.connect(core.controller, signer);
    const governance = await controller.governance();

    const strategy = ConverterStrategyBase__factory.connect(UNIV3_USDC_USDT_STRATEGY, signer);
    await DForceChangePriceUtils.setupPriceOracleMock(signer, true);

    await upgradeConverter(core);

    // try to make rebalance
    const strategyAsGov = IRebalancingStrategy__factory.connect(
      strategy.address,
      await Misc.impersonate(governance)
    );

    const vault = TetuVaultV2__factory.connect(await ISplitter__factory.connect(await strategy.splitter(), signer).vault(), signer);
    const state1 = await StateUtilsNum.getState(signer, user, strategy, vault, "s1");
    console.log("state before", state1);
    await strategyAsGov.rebalance();
    const state2 = await StateUtilsNum.getState(signer, user, strategy, vault, "s2");
    console.log("state after rebalance", state2);

    await vault.connect(user).withdrawAll();
    const state3 = await StateUtilsNum.getState(signer, user, strategy, vault, "s3");
    console.log("state after withdra", state3);

    await StateUtilsNum.saveListStatesToCSVColumns("./tmp/withdraw-all.csv", [state1, state2, state3], {mainAssetSymbol: "usdc"});
  });
//endregion Unit tests
});