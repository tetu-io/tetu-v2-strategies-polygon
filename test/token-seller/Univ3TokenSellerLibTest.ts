import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import { FacadeUniv3TokenSellerLib } from "../../typechain";
import {expect} from "chai";

describe('Univ3TokenSellerLibTest', () => {
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let facade: FacadeUniv3TokenSellerLib;

  before(async function () {
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    facade = (await DeployerUtils.deployContract(signer, "FacadeUniv3TokenSellerLib")) as FacadeUniv3TokenSellerLib;
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  describe("Calculate tick range", () => {
    describe("calcTickRangeSymmetrically", () => {
      it("should return expected values if tick > 0, tickSpacing = 5", async () => {
        const {lowerTick, upperTick} = await facade.calcTickRange(100, 20, 5);
        expect(lowerTick).eq(80);
        expect(upperTick).eq(120);
      });
      it("should return expected values if tick > 0, tickSpacing = 3", async () => {
        const {lowerTick, upperTick} = await facade.calcTickRange(100, 20, 3);
        expect(lowerTick).eq(26 * 3); // 80 / 3 = 26...
        expect(upperTick).eq(26 * 3 + 20 * 2);
      });
      it("should return expected values if tick < 0, tickSpacing = 5", async () => {
        const {lowerTick, upperTick} = await facade.calcTickRange(-100, 20, 5);
        expect(lowerTick).eq(-120);
        expect(upperTick).eq(-80);
      });
      it("should return expected values if tick < 0, tickSpacing = 3", async () => {
        const {lowerTick, upperTick} = await facade.calcTickRange(-100, 20, 3);
        // const expectedLowerTick = ((- 100 - 20) / 3 - 1) * 3; // -123
        expect(lowerTick).eq(-123);
        expect(upperTick).eq(-123 + 20 * 2);
      });
    });
    // describe("calcTickRangeRightHalf", () => {
    //   it("should return expected values if tick > 0, tickSpacing = 5", async () => {
    //     const {lowerTick, upperTick} = await facade.calcTickRangeRightHalf(100, 20, 5);
    //     expect(lowerTick).eq(100);
    //     expect(upperTick).eq(120);
    //   });
    //   it("should return expected values if tick > 0, tickSpacing = 3", async () => {
    //     const {lowerTick, upperTick} = await facade.calcTickRangeRightHalf(100, 20, 3);
    //     expect(lowerTick).eq(99);
    //     expect(upperTick).eq(119);
    //   });
    //   it("should return expected values if tick < 0, tickSpacing = 5", async () => {
    //     const {lowerTick, upperTick} = await facade.calcTickRangeRightHalf(-100, 20, 5);
    //     expect(lowerTick).eq(-100);
    //     expect(upperTick).eq(-80);
    //   });
    //   it("should return expected values if tick < 0, tickSpacing = 3", async () => {
    //     const {lowerTick, upperTick} = await facade.calcTickRangeRightHalf(-100, 20, 3);
    //     // const expectedLowerTick = ((- 100 - 20) / 3 - 1) * 3; // -123
    //     expect(lowerTick).eq(-102);
    //     expect(upperTick).eq(-82);
    //   });
    // });

    describe("calcNeedToRefreshRatio", () => {
      it("should return expected negative values", async () => {
        expect(await facade.calcNeedToRefreshRatio(15, 20, 30)).eq(-50_000);
      });
      it("should return expected positive values", async () => {
        expect(await facade.calcNeedToRefreshRatio(20, 20, 30)).eq(0);
        expect(await facade.calcNeedToRefreshRatio(22, 20, 30)).eq(20_000);
        expect(await facade.calcNeedToRefreshRatio(30, 20, 30)).eq(100_000);
        expect(await facade.calcNeedToRefreshRatio(40, 20, 30)).eq(200_000);
      });
    });
  });

  describe("Price calculations", () => {


  });
});