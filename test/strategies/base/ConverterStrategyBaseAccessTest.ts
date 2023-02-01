import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  ControllerV2,
  ConverterStrategyBaseLibFacade,
  DystopiaConverterStrategy__factory,
  IController,
  IStrategyV2,
  ITetuConverter,
  ITetuConverter__factory,
  MockConverterStrategy,
  MockConverterStrategy__factory, MockTetuConverterSingleCall,
  MockToken, PriceOracleMock,
  StrategySplitterV2,
  StrategySplitterV2__factory,
  TetuVaultV2
} from "../../../typechain";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress} from "../../../scripts/utils/Misc";

/**
 * Test of ConverterStrategyBase
 * using direct access to internal functions
 * through MockConverterStrategy
 */
describe("ConverterStrategyBaseAccessTest", () => {
//region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let strategy: MockConverterStrategy;
  let controller: IController;
  let vault: TetuVaultV2;
  let splitter: StrategySplitterV2;
  let tetuConverter: MockTetuConverterSingleCall;
  let depositorTokens: string[];
  let depositorWeights: number[];
  let depositorReserves: BigNumber[];
//endregion Variables

//region before, after
  before(async function () {
    [signer] = await ethers.getSigners();

    const governance = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 8);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);

    depositorTokens = [dai.address, usdc.address, usdt.address];
    depositorWeights = [1, 1, 1];
    depositorReserves = [
      parseUnits("1000", 18),
      parseUnits("1000", 6),
      parseUnits("1000", 6)
    ];

    controller = await DeployerUtilsLocal.getController(signer);
    strategy = await MockHelper.createMockConverterStrategy(signer);

    const strategyDeployer = async (_splitterAddress: string) => {
      const strategyLocal = MockConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'MockConverterStrategy'), governance);

      await strategyLocal.init(
        controller.address,
        splitter.address,
        tetuConverter.address,
        depositorTokens,
        depositorWeights,
        depositorReserves
      );

      return strategyLocal as unknown as IStrategyV2;
    }

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      usdc.address,
      "test",
      strategyDeployer,
      controller,
      governance,
      0, 100, 100,
      false
    );

    vault = data.vault.connect(signer);
    const splitterAddress = await vault.splitter();
    splitter = await StrategySplitterV2__factory.connect(splitterAddress, signer);

    tetuConverter = await MockHelper.createMockTetuConverterSingleCall(signer)
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

//region Unit tests
  describe("_beforeDeposit", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        await strategy._beforeDepositAccess(
          tetuConverter.address,
          amount,
          tokens,
          indexAsset
        )
      });
    });
    describe("Bad paths", () => {

    });
    describe("Gas estimation @skip-on-coverage", () => {

    });
  });
//endregion Unit tests
});