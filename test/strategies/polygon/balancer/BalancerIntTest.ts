import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployInfo} from "../../../baseUT/utils/DeployInfo";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {IState} from "../../../baseUT/utils/UniversalTestUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  getConverterAddress,
  getDForcePlatformAdapter,
  getHundredFinancePlatformAdapter
} from "../../../../scripts/utils/Misc";
import {BalancerIntTestUtils} from "./utils/BalancerIntTestUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";

const { expect } = chai;
chai.use(chaiAsPromised);

describe('BalancerLogicLibTest', function() {
//region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let deployInfo: DeployInfo
  let core: CoreAddresses;
  let tetuConverterAddress: string;
//endregion Variables

//region before, after
  before(async function () {
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();

    deployInfo = new DeployInfo();
    core = Addresses.getCore();
    tetuConverterAddress = getConverterAddress();

    await BalancerIntTestUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);
    await BalancerIntTestUtils.deployAndSetCustomSplitter(signer, core);

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

//region Utils
  async function deployStrategy() {

  }
//endregion Utils

//region Integration tests
  describe("Withdraw all", () => {
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