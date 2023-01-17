import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {parseUnits} from "ethers/lib/utils";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";
import {MaticHolders} from "../../../../scripts/MaticHolders";
import {
  BalancerBoostedAaveStableDepositorFacade,
  IBalancerBoostedAaveStablePool__factory,
  IBVault__factory,
  IERC20__factory
} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {BigNumber} from "ethers";
import {expect} from "chai";
import {areAlmostEqual} from "../../../baseUT/utils/MathUtils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";

describe('BalancerLogicLibTest', function() {
//region Constants
  const balancerVault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  // Balancer Boosted Aave USD pool ID
  const poolBoostedId = "0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b";
  const BB_AM_USD = "0x48e6B98ef6329f8f0A30eBB8c7C960330d648085";
//endregion Constants

//region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;
//endregion Variables

//region before, after
  before(async function () {
    [signer, signer1, signer2] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
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
  interface IDepositorEnterTestResults {
    amountsConsumedOut: BigNumber[];
    liquidityOut: BigNumber;
    gasUsed: BigNumber;
    /** DAI, USDC, USDT */
    balancesBefore: BigNumber[];
    /** DAI, USDC, USDT */
    balancesAfter: BigNumber[];
  }
  async function makeDepositorEnterTest(
    facade: BalancerBoostedAaveStableDepositorFacade
  ) : Promise<IDepositorEnterTestResults> {
    const assets = [MaticAddresses.DAI_TOKEN, MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN];
    const holders = [MaticHolders.HOLDER_DAI, MaticHolders.HOLDER_USDC, MaticHolders.HOLDER_USDT];

    const amountsDesired = [
      parseUnits("1", 18), // dai
      parseUnits("1", 6),  // usdc
      parseUnits("1", 6)   // usdt
    ];

    const balancesBefore: BigNumber[] = [];
    for (let i = 0; i < 3; ++i) {
      await IERC20__factory.connect(
        assets[i],
        await Misc.impersonate(holders[i])
      ).transfer(facade.address, amountsDesired[i])
      balancesBefore.push(await IERC20__factory.connect(assets[i], signer).balanceOf(facade.address));
    }

    const gasUsed = await facade.estimateGas._depositorEnterAccess(amountsDesired);
    const ret = await facade.callStatic._depositorEnterAccess(amountsDesired);
    await facade._depositorEnterAccess(amountsDesired);

    const balancesAfter: BigNumber[] = [];
    for (let i = 0; i < 3; ++i) {
      balancesAfter.push(await IERC20__factory.connect(assets[i], signer).balanceOf(facade.address));
    }

    console.log("ret", ret);
    return {
      amountsConsumedOut: ret.amountsConsumedOut,
      liquidityOut: ret.liquidityOut,
      gasUsed,
      balancesBefore,
      balancesAfter
    }
  }
//endregion Utils

//region Unit tests
  describe("_depositorEnter", () => {
    describe("Good paths", () => {
      describe("Deposit to balanceR pool", () => {
        it("should return expected values", async () => {
          const facade = await MockHelper.createBalancerBoostedAaveStableDepositorFacade(signer);
          const r = await makeDepositorEnterTest(facade);

          const balanceAfter = await IERC20__factory.connect(BB_AM_USD, signer).balanceOf(facade.address);
          console.log("balanceAfter", BB_AM_USD, facade.address, balanceAfter);
          console.log("liquidityOut", r.liquidityOut);
          console.log("DAI", r.amountsConsumedOut[0], r.balancesAfter[0].sub(r.balancesBefore[0]));

          const ret = [
            // there is small difference in results (static call and call are different calls)
            areAlmostEqual(r.liquidityOut, balanceAfter),

            r.amountsConsumedOut.length,

            r.amountsConsumedOut[0].gt(0),
            r.amountsConsumedOut[1].gt(0),
            r.amountsConsumedOut[2].gt(0),

            // one of amounts exactly matches to the desired amount "1"
            r.amountsConsumedOut[0].eq(parseUnits("1", 18))
            || r.amountsConsumedOut[1].eq(parseUnits("1", 6))
            || r.amountsConsumedOut[2].eq(parseUnits("1", 6)),

            r.amountsConsumedOut[0].eq(r.balancesBefore[0].sub(r.balancesAfter[0])),
            r.amountsConsumedOut[1].eq(r.balancesBefore[1].sub(r.balancesAfter[1])),
            r.amountsConsumedOut[2].eq(r.balancesBefore[2].sub(r.balancesAfter[2]))
          ].map(x => BalanceUtils.toString(x)).join("\n");

          const expected = [
            true,

            3,

            true,
            true,
            true,

            true,

            true,
            true,
            true
          ].map(x => BalanceUtils.toString(x)).join("\n");

          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {

    });
    describe("Gas estimation @skip-on-coverage", () => {

    });
  });

//endregion Unit tests

});