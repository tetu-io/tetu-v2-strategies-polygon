import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {parseUnits} from "ethers/lib/utils";
import {MockToken, PriceOracleMock} from "../../../typechain";
import {expect} from "chai";
import {MockHelper} from "../../baseUT/helpers/MockHelper";

describe("ConverterStrategyBaseTest", () => {
//region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
//endregion Variables

//region before, after
  before(async function () {
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();

    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
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
  describe("getExpectedWithdrawnAmountUSD", () => {
    describe("Good paths", () => {
      describe("The asset is first in _depositorPoolAssets", async () => {
        it("should return expected values for USDC", async () => {
          const facade = await MockHelper.createConverterStrategyBaseFacade(signer);
          const priceOracle = (await DeployerUtils.deployContract(
            signer,
            'PriceOracleMock',
            [usdc.address, dai.address],
            [parseUnits("4", 18), parseUnits("2", 18)]
          )) as PriceOracleMock;

          const ret = await facade.getExpectedWithdrawnAmountUSD(
            [usdc.address, dai.address],
            [
              parseUnits("200000", 6),
              parseUnits("100000", 18),
            ],
            usdc.address, // first asset in the list
            parseUnits("1000", 33), // decimals of the values don't matter here
            parseUnits("50000", 33), // only values ratio is important
            priceOracle.address
          );

          const expectedInvestedAssetsUSDNum = 200_000 * 4 * 1000 / 50_000  +  100_000 * 2 * 1000 / 50_000;

          const sret = [
            ret.investedAssetsUSD.toString(),
            ret.assetPrice.toString()
          ].join();
          const sexpected = [
            parseUnits(expectedInvestedAssetsUSDNum.toString(), 6),
            parseUnits("4", 18).toString()
          ].join();

          expect(sret).eq(sexpected);
        });
        it("should return expected values for DAI", async () => {
          const facade = await MockHelper.createConverterStrategyBaseFacade(signer);

          const priceOracle = (await DeployerUtils.deployContract(
            signer,
            'PriceOracleMock',
            [usdc.address, dai.address],
            [parseUnits("2", 18), parseUnits("4", 18)]
          )) as PriceOracleMock;

          const ret = await facade.getExpectedWithdrawnAmountUSD(
            [dai.address, usdc.address],
            [
              parseUnits("100000", 18),
              parseUnits("200000", 6),
            ],
            dai.address, // first asset in the list
            parseUnits("1000", 33), // decimals of the values don't matter here
            parseUnits("50000", 33), // only values ratio is important
            priceOracle.address
          );

          const expectedInvestedAssetsUSDNum = 100_000 * 4 * 1000 / 50_000  +  200_000 * 2 * 1000 / 50_000;

          const sret = [
            ret.investedAssetsUSD.toString(),
            ret.assetPrice.toString()
          ].join();
          const sexpected = [
            parseUnits(expectedInvestedAssetsUSDNum.toString(), 18),
            parseUnits("4", 18).toString()
          ].join();

          expect(sret).eq(sexpected);
        });
      });
      describe("The asset is second in _depositorPoolAssets", async () => {
        it("should return expected values for USDC", async () => {
          const facade = await MockHelper.createConverterStrategyBaseFacade(signer);
          const priceOracle = (await DeployerUtils.deployContract(
            signer,
            'PriceOracleMock',
            [usdc.address, dai.address],
            [parseUnits("4", 18), parseUnits("2", 18)]
          )) as PriceOracleMock;

          const ret = await facade.getExpectedWithdrawnAmountUSD(
            [dai.address, usdc.address],
            [
              parseUnits("100000", 18),
              parseUnits("200000", 6),
            ],
            usdc.address, // (!) second asset in the list
            parseUnits("1000", 33), // decimals of the values don't matter here
            parseUnits("50000", 33), // only values ratio is important
            priceOracle.address
          );

          const expectedInvestedAssetsUSDNum = 200_000 * 4 * 1000 / 50_000  +  100_000 * 2 * 1000 / 50_000;

          const sret = [
            ret.investedAssetsUSD.toString(),
            ret.assetPrice.toString()
          ].join();
          const sexpected = [
            parseUnits(expectedInvestedAssetsUSDNum.toString(), 6),
            parseUnits("4", 18).toString()
          ].join();

          expect(sret).eq(sexpected);
        });
        it("should return expected values for DAI", async () => {
          const facade = await MockHelper.createConverterStrategyBaseFacade(signer);
          const priceOracle = (await DeployerUtils.deployContract(
            signer,
            'PriceOracleMock',
            [usdc.address, dai.address],
            [parseUnits("4", 18), parseUnits("2", 18)]
          )) as PriceOracleMock;

          const ret = await facade.getExpectedWithdrawnAmountUSD(
            [usdc.address, dai.address],
            [
              parseUnits("200000", 6),
              parseUnits("100000", 18),
            ],
            dai.address, // (!) second asset in the list
            parseUnits("1000", 33), // decimals of the values don't matter here
            parseUnits("50000", 33), // only values ratio is important
            priceOracle.address
          );

          const expectedInvestedAssetsUSDNum = 100_000 * 2 * 1000 / 50_000  +  200_000 * 4 * 1000 / 50_000;

          const sret = [
            ret.investedAssetsUSD.toString(),
            ret.assetPrice.toString()
          ].join();
          const sexpected = [
            parseUnits(expectedInvestedAssetsUSDNum.toString(), 18),
            parseUnits("2", 18).toString()
          ].join();

          expect(sret).eq(sexpected);
        });
      });
    });
    describe("Bad paths", () => {
      it("should return zero values if total supply is zero", async () => {
        const facade = await MockHelper.createConverterStrategyBaseFacade(signer);
        const priceOracle = (await DeployerUtils.deployContract(
          signer,
          'PriceOracleMock',
          [usdc.address, dai.address],
          [parseUnits("4", 18), parseUnits("2", 18)]
        )) as PriceOracleMock;

        const ret = await facade.getExpectedWithdrawnAmountUSD(
          [usdc.address, dai.address],
          [
            parseUnits("200000", 6),
            parseUnits("100000", 18),
          ],
          dai.address, // (!) second asset in the list
          parseUnits("1000", 33), // decimals of the values don't matter here
          parseUnits("0", 33), // (!) total supply is zero
          priceOracle.address
        );
        const sret = [
          ret.investedAssetsUSD.toString(),
          ret.assetPrice.toString()
        ].join();
        const sexpected = [
          parseUnits("0".toString(), 6),
          parseUnits("2", 18).toString()
        ].join();

        expect(sret).eq(sexpected);
      });
      it("should return zero values if main asset price is zero", async () => {
        const facade = await MockHelper.createConverterStrategyBaseFacade(signer);
        const priceOracle = await MockHelper.createPriceOracle(
          signer,
          [usdc.address, dai.address],
          [
            parseUnits("0", 18), // (!) usdc price is zero
            parseUnits("2", 18)
          ]
        );
        const ret = await facade.getExpectedWithdrawnAmountUSD(
          [usdc.address, dai.address],
          [
            parseUnits("200000", 6),
            parseUnits("100000", 18),
          ],
          usdc.address,
          parseUnits("1000", 33), // decimals of the values don't matter here
          parseUnits("5000", 33), // total supply
          priceOracle.address
        );

        const sret = [
          ret.investedAssetsUSD.toString(),
          ret.assetPrice.toString()
        ].join();
        const sexpected = [
          parseUnits("0".toString(), 6),
          parseUnits("0", 18).toString()
        ].join();

        expect(sret).eq(sexpected);
      });
      it("should return zero investedAssetsUSD if secondary asset price is zero", async () => {
        const facade = await MockHelper.createConverterStrategyBaseFacade(signer);
        const priceOracle = await MockHelper.createPriceOracle(
          signer,
          [usdc.address, dai.address],
          [
            parseUnits("2", 6),
            parseUnits("0", 18), // (!) dai price is zero
          ]
        );
        const ret = await facade.getExpectedWithdrawnAmountUSD(
          [usdc.address, dai.address],
          [
            parseUnits("200000", 6),
            parseUnits("100000", 18),
          ],
          usdc.address,
          parseUnits("1000", 33), // decimals of the values don't matter here
          parseUnits("5000", 33), // total supply
          priceOracle.address
        );

        const sret = [
          ret.investedAssetsUSD.toString(),
          ret.assetPrice.toString()
        ].join();
        const sexpected = [
          parseUnits("0".toString(), 6),
          parseUnits("2", 6).toString()
        ].join();

        expect(sret).eq(sexpected);
      });
      it("should use ratio 1 if liquidityAmount > totalSupply", async () => {
        const facade = await MockHelper.createConverterStrategyBaseFacade(signer);
        const priceOracle = (await DeployerUtils.deployContract(
          signer,
          'PriceOracleMock',
          [usdc.address, dai.address],
          [parseUnits("4", 18), parseUnits("2", 18)]
        )) as PriceOracleMock;

        const ret = await facade.getExpectedWithdrawnAmountUSD(
          [usdc.address, dai.address],
          [
            parseUnits("200000", 6),
            parseUnits("100000", 18),
          ],
          usdc.address,
          parseUnits("5000", 33), // (!) liquidity is greater than total supply
          parseUnits("1000", 33), // (!) total supply
          priceOracle.address
        );

        const expectedInvestedAssetsUSDNum = 200_000 * 4  +  100_000 * 2; // ratio is 1
        const sret = [
          ret.investedAssetsUSD.toString(),
          ret.assetPrice.toString()
        ].join();
        const sexpected = [
          parseUnits(expectedInvestedAssetsUSDNum.toString(), 6),
          parseUnits("4", 18).toString()
        ].join();

        expect(sret).eq(sexpected);
      });
    });
  });
//endregion Unit tests
});