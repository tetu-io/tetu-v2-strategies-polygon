import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Misc} from "../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {ConverterStrategyBaseIntUniv3} from "./utils/ConverterStrategyBaseIntUniv3";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {BigNumber} from "ethers";
import {parseUnits} from "ethers/lib/utils";
import {IERC20Metadata__factory} from "../../../typechain";

/**
 * Tests of ConverterStrategyBase on the base of real strategies
 */
describe("ConverterStrategyBaseInt", () => {
  let snapshotBefore: string;
  let gov: SignerWithAddress;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let core: CoreAddresses;

//region Before, after
  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2] = await ethers.getSigners();
    gov = await Misc.impersonate(MaticAddresses.GOV_ADDRESS);
    core = Addresses.getCore() as CoreAddresses;
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion Before, after

//region Fixtures
  async function prepareUniv3ConverterStrategyUsdcUsdt(): Promise<ConverterStrategyBaseIntUniv3> {
    return ConverterStrategyBaseIntUniv3.build(
      signer,
      signer2,
      core,
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.UNISWAPV3_USDC_USDT_100,
      gov
    );
  }

//endregion Fixtures

//region Unit tests
  describe("_emergencyExitFromPool", () => {
    describe("Deposit, no hardworks", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      it("should return expected values", async () => {
        const cc = await loadFixture(prepareUniv3ConverterStrategyUsdcUsdt);
        await cc.vault.setDoHardWorkOnInvest(false);

        await TokenUtils.getToken(cc.asset, signer2.address, BigNumber.from(10000));
        await cc.vault.connect(signer2).deposit(10000, signer2.address);

        const decimals = await IERC20Metadata__factory.connect(cc.asset, gov).decimals();
        const depositAmount1 = parseUnits('100000', decimals);
        await TokenUtils.getToken(cc.asset, signer.address, depositAmount1);

        console.log("emergencyExit");
        await cc.strategy.connect(signer).emergencyExit();
      });
    });
  });
//endregion Unit tests
});