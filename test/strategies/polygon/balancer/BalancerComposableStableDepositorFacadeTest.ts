import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {parseUnits} from "ethers/lib/utils";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";
import {MaticHolders} from "../../../../scripts/MaticHolders";
import {
  BalancerComposableStableDepositorFacade,
  IBVault__factory,
  IERC20__factory
} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {BigNumber} from "ethers";
import {expect} from "chai";
import {areAlmostEqual} from "../../../baseUT/utils/MathUtils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";

describe('BalancerComposableStableDepositorFacadeTest', function() {
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
    poolTokensBefore: {
      tokens: string[];
      balances: BigNumber[];
      lastChangeBlock: BigNumber;
    };
    poolTokensAfter: {
      tokens: string[];
      balances: BigNumber[];
      lastChangeBlock: BigNumber;
    };
  }
  async function makeDepositorEnterTest(
    facade: BalancerComposableStableDepositorFacade,
    amount: string = "1"
  ) : Promise<IDepositorEnterTestResults> {
    const assets = [MaticAddresses.DAI_TOKEN, MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN];
    const holders = [MaticHolders.HOLDER_DAI, MaticHolders.HOLDER_USDC, MaticHolders.HOLDER_USDT];
    const vault = IBVault__factory.connect(balancerVault, signer);

    const amountsDesired = [
      parseUnits(amount, 18), // dai
      parseUnits(amount, 6),  // usdc
      parseUnits(amount, 6)   // usdt
    ];

    const balancesBefore: BigNumber[] = [];
    for (let i = 0; i < 3; ++i) {
      const holder = await Misc.impersonate(holders[i]);
      await IERC20__factory.connect(assets[i], holder).transfer(facade.address, amountsDesired[i]);
      balancesBefore.push(await IERC20__factory.connect(assets[i], signer).balanceOf(facade.address));
    }
    const poolTokensBefore = await vault.getPoolTokens(poolBoostedId);
    const tx = await facade._depositorEnterAccess(amountsDesired);
    const gasUsed = (await tx.wait()).gasUsed;
    const poolTokensAfter = await vault.getPoolTokens(poolBoostedId);
    const liquidityOut = await facade.lastLiquidityOut();
    const amountsConsumedOut: BigNumber[] = [];
    const amountsConsumedOutLength = (await facade.lastAmountsConsumedOutLength()).toNumber();
    for (let i = 0; i < amountsConsumedOutLength; ++i) {
      amountsConsumedOut.push(await facade.lastAmountsConsumedOut(i));
    }

    const balancesAfter: BigNumber[] = [];
    for (let i = 0; i < 3; ++i) {
      balancesAfter.push(await IERC20__factory.connect(assets[i], signer).balanceOf(facade.address));
    }

    console.log("liquidityOut", liquidityOut);
    console.log("amountsConsumedOut", amountsConsumedOut);
    return {
      amountsConsumedOut,
      liquidityOut,
      gasUsed,
      balancesBefore,
      balancesAfter,
      poolTokensBefore,
      poolTokensAfter
    }
  }
//endregion Utils

//region Unit tests
  describe("_depositorEnter", () => {
    describe("Good paths", () => {
      describe("Deposit to balanceR pool", () => {
        it("should return expected values", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          const r = await makeDepositorEnterTest(facade);
          console.log("r", r);

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
      describe("Ensure that deposit doesn't change proportions too much", () => {
        function getMaxPercentDelta(r: IDepositorEnterTestResults) : BigNumber {
          const totalTokensBefore = r.poolTokensBefore.balances[0]
            .add(r.poolTokensBefore.balances[2])
            .add(r.poolTokensBefore.balances[3]);
          const totalTokensAfter = r.poolTokensAfter.balances[0]
            .add(r.poolTokensAfter.balances[2])
            .add(r.poolTokensAfter.balances[3]);
          console.log("Before", r.poolTokensBefore, totalTokensBefore);
          console.log("After", r.poolTokensAfter, totalTokensAfter);

          const proportionsAfter = [
            r.poolTokensAfter.balances[0].mul(Misc.ONE18).div(totalTokensAfter),
            r.poolTokensAfter.balances[2].mul(Misc.ONE18).div(totalTokensAfter),
            r.poolTokensAfter.balances[3].mul(Misc.ONE18).div(totalTokensAfter),
          ];
          const proportionsBefore = [
            r.poolTokensBefore.balances[0].mul(Misc.ONE18).div(totalTokensBefore),
            r.poolTokensBefore.balances[2].mul(Misc.ONE18).div(totalTokensBefore),
            r.poolTokensBefore.balances[3].mul(Misc.ONE18).div(totalTokensBefore),
          ];
          const percentDeltas = [
            proportionsAfter[0].sub(proportionsBefore[0]).mul(Misc.ONE18).div(proportionsAfter[0]),
            proportionsAfter[1].sub(proportionsBefore[1]).mul(Misc.ONE18).div(proportionsAfter[1]),
            proportionsAfter[2].sub(proportionsBefore[2]).mul(Misc.ONE18).div(proportionsAfter[2]),
          ];

          const maxPercentDeltas = percentDeltas.reduce(
            (prev, current) => current.gt(prev) ? current : prev, percentDeltas[0]
          );

          console.log("proportionsAfter", proportionsAfter);
          console.log("proportionsBefore", proportionsBefore);
          console.log("percentDeltas", percentDeltas);
          console.log("maxPercentDeltas", maxPercentDeltas);

          return maxPercentDeltas;
        }
        it("$1", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          const r = await makeDepositorEnterTest(facade, "1");
          const maxPercentDeltas = getMaxPercentDelta(r);
          expect(maxPercentDeltas.abs().lt(1e5)).eq(true);
        });
        it("$10_000", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          const r = await makeDepositorEnterTest(facade, "10000");
          const maxPercentDeltas = getMaxPercentDelta(r);
          expect(maxPercentDeltas.abs().lt(1e9)).eq(true);
        });
        it("$1_000_000", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          const r = await makeDepositorEnterTest(facade, "1000000");
          const maxPercentDeltas = getMaxPercentDelta(r);
          expect(maxPercentDeltas.abs().lt(1e11)).eq(true);
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