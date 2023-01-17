import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {BalancerLogicLibFacade, MockToken} from "../../../../typechain";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {areAlmostEqual} from "../../../baseUT/utils/MathUtils";

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

  let usdc: MockToken;
  let dai: MockToken;
  let wbtc: MockToken;
  let usdt: MockToken;
  let bbAmUSD: MockToken;

//endregion Variables

//region before, after
  before(async function () {
    [signer, signer1, signer2] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    facade = await MockHelper.createBalancerLogicLibFacade(signer);

    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    wbtc = await DeployerUtils.deployMockToken(signer, 'WBTC', 8);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);
    bbAmUSD = await DeployerUtils.deployMockToken(signer, 'BB-AM_USD', 27);
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
    describe("Good paths", () => {
      describe("Equal balances", () => {
        it("should return expected values", async () => {
          const desiredAmounts = [
            parseUnits("10", 6),
            parseUnits("10", 18),
            parseUnits("10", 8),
          ];

          const r = await facade.getAmountsToDeposit(
            desiredAmounts,
            [usdc.address, dai.address, bbAmUSD.address, wbtc.address],
            [1, 1, 0, 1],
            bbAmUSD.address
          );

          const ret = [
            r.amountsToDepositOut.map(x => x.toString()).join(),
            r.userDataAmountsOut.map(x => x.toString()).join()
          ].join();
          const expected = [
            parseUnits("10", 6),
            parseUnits("10", 18),
            parseUnits("0", 27),
            parseUnits("10", 8),

            parseUnits("10", 6),
            parseUnits("10", 18),
            parseUnits("10", 8),
          ].map(x => x.toString()).join();
          expect(ret).eq(expected);
        });
      });
      describe("Different balances", () => {
        it("should return expected values, 1-2-4", async () => {
          const desiredAmounts = [
            parseUnits("100", 6),
            parseUnits("100", 18),
            parseUnits("100", 8),
          ];

          const r = await facade.getAmountsToDeposit(
            desiredAmounts,
            [bbAmUSD.address, usdc.address, dai.address, wbtc.address],
            [100, 1, 2, 4],
            bbAmUSD.address
          );

          const ret = [
            r.amountsToDepositOut.map(x => x.toString()).join(),
            r.userDataAmountsOut.map(x => x.toString()).join()
          ].join();
          const expected = [
            parseUnits("0", 27),
            parseUnits("25", 6),
            parseUnits("50", 18),
            parseUnits("100", 8),

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
          ];

          const r = await facade.getAmountsToDeposit(
            desiredAmounts,
            [usdc.address, dai.address, wbtc.address, bbAmUSD.address],
            [1, 4, 2, 100],
            bbAmUSD.address
          );

          const ret = [
            r.amountsToDepositOut.map(x => x.toString()).join(),
            r.userDataAmountsOut.map(x => x.toString()).join()
          ].join();
          const expected = [
            parseUnits("25", 6),
            parseUnits("100", 18),
            parseUnits("50", 8),
            parseUnits("0", 27),

            parseUnits("25", 6),
            parseUnits("100", 18),
            parseUnits("50", 8),
          ].map(x => x.toString()).join();
          expect(ret).eq(expected);
        });
      });
      describe("Amounts near to real", () => {
        describe("Desired amounts are in required proportions ", () => {
          it("should return desired amounts without changes", async () => {
            const balanceDai = BigNumber.from("5372145387028495219437932");
            const balanceUSDC = BigNumber.from("6027657899829781959978705");
            const balanceUSDT = BigNumber.from("6051057251727129911185863");

            const amountDai = parseUnits("1", 18);
            const amountUSDC = parseUnits("1", 6).mul(balanceUSDC).div(balanceDai);
            const amountUSDT = parseUnits("1", 6).mul(balanceUSDT).div(balanceDai);
            console.log("balanceDai", balanceDai);
            console.log("balanceUSDC", balanceUSDC);
            console.log("balanceUSDT", balanceUSDT);

            const desiredAmounts = [
              amountDai,
              amountUSDC,
              amountUSDT
            ];

            const r = await facade.getAmountsToDeposit(
              desiredAmounts,
              [dai.address, bbAmUSD.address, usdc.address, usdt.address],
              [
                balanceDai,
                BigNumber.from("2596148417831512044017929463269193"),
                balanceUSDC,
                balanceUSDT,
              ],
              bbAmUSD.address
            );

            const ret = [
              r.amountsToDepositOut.map(x => x.toString()).join(),
              r.userDataAmountsOut.map(x => x.toString()).join()
            ].join();

            const expected = [
              amountDai,
              BigNumber.from("0"),
              amountUSDC,
              amountUSDT,

              amountDai,
              amountUSDC,
              amountUSDT,
            ].map(x => x.toString()).join();

            console.log("ret", ret);
            expect(ret).eq(expected);
          });
        });
        describe("Too much USDC", () => {
          it("should return expected amounts", async () => {
            const balanceDai = BigNumber.from("5372145387028495219437932");
            const balanceUSDC = BigNumber.from("6027657899829781959978705");
            const balanceUSDT = BigNumber.from("6051057251727129911185863");

            const amountDai = parseUnits("1", 18);
            const amountUSDC = parseUnits("1", 6).mul(balanceUSDC).div(balanceDai);
            const amountUSDT = parseUnits("1", 6).mul(balanceUSDT).div(balanceDai);
            console.log("balanceDai", balanceDai);
            console.log("balanceUSDC", balanceUSDC);
            console.log("balanceUSDT", balanceUSDT);

            const desiredAmounts = [
              amountDai,
              amountUSDC.mul(100), // (!) too much
              amountUSDT
            ];

            const r = await facade.getAmountsToDeposit(
              desiredAmounts,
              [dai.address, bbAmUSD.address, usdc.address, usdt.address],
              [
                balanceDai,
                BigNumber.from("2596148417831512044017929463269193"),
                balanceUSDC,
                balanceUSDT,
              ],
              bbAmUSD.address
            );

            const ret = [
              r.amountsToDepositOut.map(x => x.toString()).join(),
              r.userDataAmountsOut.map(x => x.toString()).join()
            ].join();

            const expected = [
              amountDai,
              BigNumber.from("0"),
              amountUSDC,
              amountUSDT,

              amountDai,
              amountUSDC,
              amountUSDT,
            ].map(x => x.toString()).join();

            console.log("ret", ret);
            expect(ret).eq(expected);
          });
        });
        describe("Too much USDT", () => {
          it("should return expected amounts", async () => {
            const balanceDai = BigNumber.from("5372145387028495219437932");
            const balanceUSDC = BigNumber.from("6027657899829781959978705");
            const balanceUSDT = BigNumber.from("6051057251727129911185863");

            const amountDai = parseUnits("1", 18);
            const amountUSDC = parseUnits("1", 6).mul(balanceUSDC).div(balanceDai);
            const amountUSDT = parseUnits("1", 6).mul(balanceUSDT).div(balanceDai);
            console.log("balanceDai", balanceDai);
            console.log("balanceUSDC", balanceUSDC);
            console.log("balanceUSDT", balanceUSDT);

            const desiredAmounts = [
              amountDai,
              amountUSDC,
              amountUSDT.mul(100), // (!) too much,
            ];

            const r = await facade.getAmountsToDeposit(
              desiredAmounts,
              [dai.address, bbAmUSD.address, usdc.address, usdt.address],
              [
                balanceDai,
                BigNumber.from("2596148417831512044017929463269193"),
                balanceUSDC,
                balanceUSDT,
              ],
              bbAmUSD.address
            );

            const ret = [
              r.amountsToDepositOut.map(x => x.toString()).join(),
              r.userDataAmountsOut.map(x => x.toString()).join()
            ].join();
            const expected = [
              amountDai,
              BigNumber.from("0"),
              amountUSDC,
              amountUSDT,

              amountDai,
              amountUSDC,
              amountUSDT,
            ].map(x => x.toString()).join();

            console.log("ret", ret);
            expect(ret).eq(expected);
          });
        });
        describe("Too much DAI and USDT", () => {
          it("should return rounded amounts", async () => {
            const balanceDai = BigNumber.from("5372145387028495219437932");
            const balanceUSDC = BigNumber.from("6027657899829781959978705");
            const balanceUSDT = BigNumber.from("6051057251727129911185863");

            const amountDai = parseUnits("1", 18);
            const amountUSDC = parseUnits("1", 6).mul(balanceUSDC).div(balanceDai);
            const amountUSDT = parseUnits("1", 6).mul(balanceUSDT).div(balanceDai);
            console.log("balanceDai", balanceDai);
            console.log("balanceUSDC", balanceUSDC);
            console.log("balanceUSDT", balanceUSDT);

            const desiredAmounts = [
              amountDai.mul(100), // (!) too much,
              amountUSDC,
              amountUSDT.mul(100), // (!) too much,
            ];

            const r = await facade.getAmountsToDeposit(
              desiredAmounts,
              [dai.address, bbAmUSD.address, usdc.address, usdt.address],
              [
                balanceDai,
                BigNumber.from("2596148417831512044017929463269193"),
                balanceUSDC,
                balanceUSDT,
              ],
              bbAmUSD.address
            );

            const ret = [
              areAlmostEqual(r.amountsToDepositOut[0], amountDai, 6),
              r.amountsToDepositOut[1].toString(),
              r.amountsToDepositOut[2].toString(),
              areAlmostEqual(r.amountsToDepositOut[3], amountUSDT, 6)
            ].join();

            const expected = [
              true,
              BigNumber.from("0"),
              amountUSDC,
              true,
            ].map(x => x.toString()).join();

            console.log("ret", ret, "expected", expected);
            expect(ret).eq(expected);
          });
        });
      });
    });
    describe("Bad paths", () => {
      it("wrong token lengths", async () => {
        const desiredAmounts = [
          parseUnits("100", 6),
          parseUnits("100", 18),
          parseUnits("100", 8),
        ];

        await expect(facade.getAmountsToDeposit(
          desiredAmounts,
          [bbAmUSD.address, usdc.address, dai.address], // (!) tokens and balances
          [100, 1, 2, 4],                             // (!)  have different lengths
          bbAmUSD.address
        )).revertedWith("TS-4 wrong lengths");
      });
      it("desired amounts is too long", async () => {
        const desiredAmounts = [
          parseUnits("100", 6),
          parseUnits("100", 18),
          parseUnits("100", 8),
          parseUnits("100", 8),
          parseUnits("100", 8),   // (!) too long
        ];

        await expect(facade.getAmountsToDeposit(
          desiredAmounts,
          [bbAmUSD.address, usdc.address, dai.address, usdt.address],
          [100, 1, 2, 4],
          bbAmUSD.address
        )).revertedWith("TS-4 wrong lengths");
      });
      it("desired amounts is too short", async () => {
        const desiredAmounts = [
          parseUnits("100", 6),
          parseUnits("100", 18),
          // (!) too short
        ];

        await expect(facade.getAmountsToDeposit(
          desiredAmounts,
          [bbAmUSD.address, usdc.address, dai.address, usdt.address],
          [100, 1, 2, 4],
          bbAmUSD.address
        )).revertedWith("TS-4 wrong lengths");
      });
      it("zero balance 1", async () => {
        await expect(facade.getAmountsToDeposit(
          [parseUnits("100", 6), parseUnits("100"), parseUnits("100", 8)],
          [bbAmUSD.address, usdc.address, dai.address, usdt.address],
          [1, 0, 2, 4],
          bbAmUSD.address
        )).revertedWith("TS-5 zero balance");
      });
      it("zero balance 2", async () => {
        await expect(facade.getAmountsToDeposit(
          [parseUnits("100", 6), parseUnits("100"), parseUnits("100", 8)],
          [bbAmUSD.address, usdc.address, dai.address, usdt.address],
          [1, 2, 0, 4],
          bbAmUSD.address
        )).revertedWith("TS-5 zero balance");
      });
      it("zero balance 3", async () => {
        await expect(facade.getAmountsToDeposit(
          [parseUnits("100", 6), parseUnits("100"), parseUnits("100", 8)],
          [bbAmUSD.address, usdc.address, dai.address, usdt.address],
          [1, 2, 2, 0],
          bbAmUSD.address
        )).revertedWith("TS-5 zero balance");
      });
    });
  });

  describe("getAssetIndex", () => {
    describe("Good paths", () => {
      async function makeGetAssetIndexTest(startIndex0: number, asset: MockToken) : Promise<number> {
        const tokens = [dai, bbAmUSD, usdc, usdt];
        return (
          await facade.getAssetIndex(startIndex0, tokens.map(x => x.address), asset.address, 4)
        ).toNumber();
      }
      describe("predicted position is correct", () => {
        it("should return correct position of DAI", async () => {
          const ret = await makeGetAssetIndexTest(0, dai);
          expect(ret).eq(0);
        });
        it("should return correct position of USDC", async () => {
          const ret = await makeGetAssetIndexTest(2, usdc);
          expect(ret).eq(2);
        });
        it("should return correct position of USDT", async () => {
          const ret = await makeGetAssetIndexTest(3, usdt);
          expect(ret).eq(3);
        });
      });
      describe("predicted position is less then actual one", () => {
        it("should return correct position of USDC", async () => {
          const ret = await makeGetAssetIndexTest(0, usdc);
          expect(ret).eq(2);
        });
        it("should return correct position of USDT", async () => {
          const ret = await makeGetAssetIndexTest(2, usdt);
          expect(ret).eq(3);
        });
      });
      describe("predicted position is greater then actual one", () => {
        it("should return correct position of DAI", async () => {
          const ret = await makeGetAssetIndexTest(1, dai);
          expect(ret).eq(0);
        });
        it("should return correct position of USDC", async () => {
          const ret = await makeGetAssetIndexTest(3, usdc);
          expect(ret).eq(2);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Tokens don't include the given asset", () => {
        it("should revert", async () => {
          const tokens = [dai, bbAmUSD, usdc, usdt];
          await expect(
            facade.getAssetIndex(
              0,
              tokens.map(x => x.address),
              wbtc.address, // (!) there is no such asset in the {tokens}
              4
            )
          ).revertedWith("TS-6 not found");
        });
      });
    });

  });
//endregion Unit tests
});
