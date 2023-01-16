import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {BalancerLogicLibFacade, MockToken, MockToken__factory} from "../../../../typechain";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {parseUnits} from "ethers/lib/utils";

const { expect } = chai;
chai.use(chaiAsPromised);

const balanceOf = TokenUtils.balanceOf;

describe('BalancerLogicLibTest', function() {
//region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;
  let facade: BalancerLogicLibFacade;
//endregion Variables

//region before, after
  before(async function () {
    [signer, signer1, signer2] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    facade = await MockHelper.createBalancerLogicLibFacade(signer);
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
  describe("getAmountsToDeposit", () => {
    let usdc: MockToken;
    let dai: MockToken;
    let wbtc: MockToken;
    let bbAmUSD: MockToken;
    let snapshotBeforeLocal: string;
    beforeEach(async function () {
      snapshotBeforeLocal = await TimeUtils.snapshot();
      usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
      dai = await DeployerUtils.deployMockToken(signer, 'DAI');
      wbtc = await DeployerUtils.deployMockToken(signer, 'WBTC', 8);
      bbAmUSD = await DeployerUtils.deployMockToken(signer, 'BB-AM_USD', 27);
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotBeforeLocal);
    });
    describe("Good paths", () => {
      describe("Equal balances", () => {
        it("should return expected values", async () => {
          const desiredAmounts = [
            parseUnits("10", 6),
            parseUnits("10", 18),
            parseUnits("0", 27),
            parseUnits("10", 8),
          ];

          const r = await facade.getAmountsToDeposit(
            desiredAmounts,
            [dai.address, usdc.address, bbAmUSD.address, wbtc.address],
            [1, 1, 0, 1],
            bbAmUSD.address
          );

          const ret = r.map(x => x.toString()).join();
          const expected = desiredAmounts.map(x => x.toString()).join();
          expect(ret).eq(expected);
        });
      });
      describe("Different balances", () => {
        it("should return expected values, 1-2-4", async () => {
          const desiredAmounts = [
            parseUnits("0", 27),
            parseUnits("100", 6),
            parseUnits("100", 18),
            parseUnits("100", 8),
          ];

          const r = await facade.getAmountsToDeposit(
            desiredAmounts,
            [bbAmUSD.address, dai.address, usdc.address, wbtc.address],
            [100, 1, 2, 4],
            bbAmUSD.address
          );

          const ret = r.map(x => x.toString()).join();
          const expected = [
            parseUnits("0", 27),
            parseUnits("25", 6),
            parseUnits("50", 18),
            parseUnits("100", 8),
          ].map(x => x.toString()).join();
          expect(ret).eq(expected);
        });
        it("should return expected values, 1-4-2", async () => {
          const desiredAmounts = [
            parseUnits("100", 6),
            parseUnits("100", 18),
            parseUnits("100", 8),
            parseUnits("0", 27),
          ];

          const r = await facade.getAmountsToDeposit(
            desiredAmounts,
            [dai.address, usdc.address, wbtc.address, bbAmUSD.address],
            [1, 4, 2, 100],
            bbAmUSD.address
          );

          const ret = r.map(x => x.toString()).join();
          const expected = [
            parseUnits("25", 6),
            parseUnits("100", 18),
            parseUnits("50", 8),
            parseUnits("0", 27),
          ].map(x => x.toString()).join();
          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {
      // zero balance
      // wrong lengths
    });
  });
//endregion Unit tests
});
