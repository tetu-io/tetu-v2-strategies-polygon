import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  ControllerMinimal, MockConverterStrategy, MockGauge, MockGauge__factory,
  MockToken, PriceOracleMock, ProxyControlled,
  StrategySplitterV2, StrategySplitterV2__factory
} from "../../../../typechain";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../../scripts/utils/Misc";
import {expect} from "chai";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {BigNumber} from "ethers";

/**
 * Test internal functions of ConverterStrategyBase using mocks
 */
describe('ConverterStrategyBaseInternalTests', function() {
//region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;
  let controller: ControllerMinimal;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let splitterNotInitialized: StrategySplitterV2;
  let mockGauge: MockGauge;
//endregion Variables

//region before, after
  before(async function () {
    [signer, signer1, signer2] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();

    controller = await DeployerUtils.deployMockController(signer);
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    await usdc.transfer(signer2.address, parseUnits('1', 6));

    // set up a vault and a mocked gage
    const mockGaugeImp = await DeployerUtils.deployContract(signer, 'MockGauge') as MockGauge;
    const gProxy = await DeployerUtils.deployContract(signer, 'ProxyControlled',) as ProxyControlled;
    await gProxy.initProxy(mockGaugeImp.address);

    mockGauge = MockGauge__factory.connect(gProxy.address, signer);
    await mockGauge.init(controller.address);

    // set up NOT INITIALIZED splitter
    const sProxy = await DeployerUtils.deployContract(signer, 'ProxyControlled',) as ProxyControlled;
    const splitterImpl = await DeployerUtils.deployContract(signer, 'StrategySplitterV2') as StrategySplitterV2;
    await sProxy.initProxy(splitterImpl.address)
    splitterNotInitialized = StrategySplitterV2__factory.connect(sProxy.address, signer);
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
  /**
   * Set up a vault for the given asset.
   * Set up a strategy with given set of the tokens and given values of the resources.
   * Initialize the pre-created splitter by the given asset
   */
  async function setupMockedStrategy(
    asset: MockToken,
    depositorTokens: MockToken[],
    depositorReservesNum: number[],
    tetuConverterAddress?: string
  ) : Promise<MockConverterStrategy> {
    // create a vault
    const vault = await DeployerUtils.deployTetuVaultV2(
      signer,
      controller.address,
      asset.address,
      await asset.name(),
      await asset.name(),
      mockGauge.address,
      10,
    );
    await usdc.connect(signer2).approve(vault.address, Misc.MAX_UINT);
    await usdc.connect(signer1).approve(vault.address, Misc.MAX_UINT);
    await usdc.approve(vault.address, Misc.MAX_UINT);

    // initialize the splitter
    const splitter = splitterNotInitialized;
    await splitter.init(controller.address, asset.address, vault.address);
    await vault.setSplitter(splitter.address);

    const strategy: MockConverterStrategy = await MockHelper.createMockConverterStrategy(signer);
    const depositorReserves = await Promise.all(
      depositorTokens.map(
        async (token, index) => parseUnits(depositorReservesNum[index].toString(), await token.decimals())
      )
    );
    await strategy.init(
      controller.address,
      splitter.address,
      tetuConverterAddress || ethers.Wallet.createRandom().address,
      depositorTokens.map(x => x.address),
      [1, 1],
      depositorReserves
    );

    await splitterNotInitialized.addStrategies([strategy.address], [0]);
    return strategy;
  }
//endregion Utils

  describe("_getExpectedWithdrawnAmountUSD", () => {
    describe("Good paths", () => {
      describe("The asset is first in _depositorPoolAssets", async () => {
        it("should return expected values for USDC", async () => {
          const strategy = await setupMockedStrategy(
            usdc, // the asset is first in the list of depositor tokens
            [usdc, dai], // decimals 6, 18
            [100_000, 200_000]
          );
          const priceOracle = (await DeployerUtils.deployContract(
              signer,
              'PriceOracleMock',
              [usdc.address, dai.address],
              [parseUnits("4", 18), parseUnits("2", 18)]
          )) as PriceOracleMock;

          const ret = await strategy.getExpectedWithdrawnAmountUSDTestAccess(
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
            parseUnits(expectedInvestedAssetsUSDNum.toString(), 6),
            parseUnits("4", 18).toString()
          ].join();

          expect(sret).eq(sexpected);
        });
        it("should return expected values for DAI", async () => {
          const strategy = await setupMockedStrategy(
            dai, // the asset is first in the list of depositor tokens
            [dai, usdc], // decimals 6, 18
            [200_000, 100_000]
          );
          const priceOracle = (await DeployerUtils.deployContract(
            signer,
            'PriceOracleMock',
            [usdc.address, dai.address],
            [parseUnits("4", 18), parseUnits("2", 18)]
          )) as PriceOracleMock;

          const ret = await strategy.getExpectedWithdrawnAmountUSDTestAccess(
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
            parseUnits("2", 18).toString()
          ].join();

          expect(sret).eq(sexpected);
        });
      });
      describe("The asset is second in _depositorPoolAssets", async () => {
        it("should return expected values for USDC", async () => {
          const strategy = await setupMockedStrategy(
            usdc, // the asset is second in the list of depositor tokens
            [dai, usdc], // decimals 6, 18
            [200_000, 100_000]
          );
          const priceOracle = (await DeployerUtils.deployContract(
            signer,
            'PriceOracleMock',
            [usdc.address, dai.address],
            [parseUnits("4", 18), parseUnits("2", 18)]
          )) as PriceOracleMock;

          const ret = await strategy.getExpectedWithdrawnAmountUSDTestAccess(
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
            parseUnits(expectedInvestedAssetsUSDNum.toString(), 6),
            parseUnits("4", 18).toString()
          ].join();

          expect(sret).eq(sexpected);
        });
        it("should return expected values for DAI", async () => {
          const strategy = await setupMockedStrategy(
            dai, // the asset is second in the list of depositor tokens
            [usdc, dai], // decimals 6, 18
            [100_000, 200_000]
          );
          const priceOracle = (await DeployerUtils.deployContract(
            signer,
            'PriceOracleMock',
            [usdc.address, dai.address],
            [parseUnits("4", 18), parseUnits("2", 18)]
          )) as PriceOracleMock;

          const ret = await strategy.getExpectedWithdrawnAmountUSDTestAccess(
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
            parseUnits("2", 18).toString()
          ].join();

          expect(sret).eq(sexpected);
        });
      });
    });
    describe("Bad paths", () => {
      it("should return zero values if total supply is zero", async () => {
        const strategy = await setupMockedStrategy(usdc, [usdc, dai], [100_000, 200_000]);
        const priceOracle = (await DeployerUtils.deployContract(
          signer,
          'PriceOracleMock',
          [usdc.address, dai.address],
          [parseUnits("4", 18), parseUnits("2", 18)]
        )) as PriceOracleMock;

        const ret = await strategy.getExpectedWithdrawnAmountUSDTestAccess(
          parseUnits("1000", 33),
          parseUnits("0", 33), // (!) total supply is zero
          priceOracle.address
        );

        const sret = [
          ret.investedAssetsUSD.toString(),
          ret.assetPrice.toString()
        ].join();
        const sexpected = [
          parseUnits("0".toString(), 6),
          parseUnits("4", 18).toString()
        ].join();

        expect(sret).eq(sexpected);
      });
      it("should return zero values if main asset price is zero", async () => {
        const strategy = await setupMockedStrategy(usdc, [usdc, dai], [100_000, 200_000]);
        const priceOracle = await MockHelper.createPriceOracle(
          signer,
          [usdc.address, dai.address],
          [
            parseUnits("0", 18), // (!) usdc price is zero
            parseUnits("2", 18)
          ]
        );

        const ret = await strategy.getExpectedWithdrawnAmountUSDTestAccess(
          parseUnits("1000", 33),
          parseUnits("50000", 33),
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
        const strategy = await setupMockedStrategy(usdc, [usdc, dai], [100_000, 200_000]);
        const priceOracle = (await DeployerUtils.deployContract(
          signer,
          'PriceOracleMock',
          [usdc.address, dai.address],
          [
            parseUnits("4", 18),
            parseUnits("0", 18) // (!) dai price is zero
          ]
        )) as PriceOracleMock;

        const ret = await strategy.getExpectedWithdrawnAmountUSDTestAccess(
          parseUnits("1000", 33),
          parseUnits("50000", 33),
          priceOracle.address
        );

        const sret = [
          ret.investedAssetsUSD.toString(),
          ret.assetPrice.toString()
        ].join();
        const sexpected = [
          parseUnits("0".toString(), 6),
          parseUnits("4", 18).toString()
        ].join();

        expect(sret).eq(sexpected);
      });
      it("should user ratio 1 if liquidityAmount > totalSupply", async () => {
        const strategy = await setupMockedStrategy(usdc, [usdc, dai], [100_000, 200_000]);
        const priceOracle = (await DeployerUtils.deployContract(
          signer,
          'PriceOracleMock',
          [usdc.address, dai.address],
          [parseUnits("4", 18), parseUnits("2", 18)]
        )) as PriceOracleMock;

        const ret = await strategy.getExpectedWithdrawnAmountUSDTestAccess(
          parseUnits("50000", 33), // (!) liquidityAmount is greater than totalSupply
          parseUnits("1000", 33), // (!) total supply is less than liquidityAmount
          priceOracle.address
        );

        const expectedInvestedAssetsUSDNum = 100_000 * 4  +  200_000 * 2; // ratio is 1
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

  describe("_borrowPosition", () => {
    describe("Good paths", () => {
      it("should return expected value", async () => {
        const tetuConverter = await MockHelper.createMockTetuConverterSingleCall(signer);
        const strategy = await setupMockedStrategy(
          usdc,
          [usdc, dai],
          [100_000, 200_000],
          tetuConverter.address
        );
        const collateralAmount = parseUnits("1000", 6);
        const borrowAmount = parseUnits("500", 18);
        const converter = ethers.Wallet.createRandom().address;
        const user = ethers.Wallet.createRandom().address;

        // prepare tetu converter mock
        await tetuConverter.setFindBorrowStrategyOutputParams(
          converter,
          borrowAmount,
          0, // apr is not used
          usdc.address,
          collateralAmount,
          dai.address,
          1 // we can use any period for mock
        );
        await tetuConverter.setBorrowParams(
          converter,
          usdc.address,
          collateralAmount,
          dai.address,
          borrowAmount,
          user,
          borrowAmount
        );
        // put collateral on the balance of the strategy
        await usdc.transfer(strategy.address, collateralAmount);
        // provide the amount to be borrowed by the strategy
        await dai.transfer(tetuConverter.address, borrowAmount);

        const balanceUsdcBefore = await usdc.balanceOf(strategy.address);
        const balanceDaiBefore = await dai.balanceOf(strategy.address);
        const ret = await strategy.callStatic.borrowPositionTestAccess(usdc.address, collateralAmount, dai.address);
        await strategy.borrowPositionTestAccess(usdc.address, collateralAmount, dai.address);
        const balanceUsdcAfter = await usdc.balanceOf(strategy.address);
        const balanceDaiAfter = await dai.balanceOf(strategy.address);

        const sret = [
          // should return expected value
          ret.toString(),

          // should receive expected amount on balance
          balanceUsdcBefore.sub(balanceUsdcAfter).toString(),
          balanceDaiAfter.sub(balanceDaiBefore).toString(),
        ].join();
        const sexpected = [
          borrowAmount.toString(),
          collateralAmount.toString(),
          borrowAmount.toString()
        ].join();

        expect(sret).eq(sexpected);
      });
      it("should receive expected debt in tetuConverter", async () => {
// TODO
      });
    });
    describe("Bad paths", () => {
      it("should return 0 if a borrow strategy is not found", async () => {
        const tetuConverter = await MockHelper.createMockTetuConverterSingleCall(signer);
        const strategy = await setupMockedStrategy(
          usdc,
          [usdc, dai],
          [100_000, 200_000],
          tetuConverter.address
        );
        const collateralAmount = parseUnits("1000", 6);

        // prepare tetu converter mock
        await tetuConverter.setFindBorrowStrategyOutputParams(
          Misc.ZERO_ADDRESS, // (!) the borrow strategy not found
          0,
          0, // apr is not used
          usdc.address,
          collateralAmount,
          dai.address,
          1 // we can use any period for mock
        );
        // put collateral on the balance of the strategy
        await usdc.transfer(strategy.address, collateralAmount);

        const ret = await strategy.callStatic.borrowPositionTestAccess(usdc.address, collateralAmount, dai.address);

        expect(ret.toString()).eq("0");
      });
    });
  });

  describe("_closePosition", () => {
    describe("Good paths", () => {
      interface IMakeClosePositionTestInputParams {
        collateralAmountNum: number;
        amountToRepayNum: number;
        needToRepayNum: number;
        amountRepaidNum: number;
        swappedLeftoverCollateralOutNum?: number;
        swappedLeftoverBorrowOutNum?: number;
        priceOut?: number;
      }
      interface IMakeClosePositionTestResults {
        retRepay: BigNumber;
        balanceCollateralStrategyBefore: BigNumber;
        balanceCollateralStrategyAfter: BigNumber;
        balanceBorrowAssetStrategyBefore: BigNumber;
        balanceBorrowAssetStrategyAfter: BigNumber;
      }
      async function makeClosePositionTest(
        collateralAsset: MockToken,
        borrowAsset: MockToken,
        params: IMakeClosePositionTestInputParams
      ) : Promise<IMakeClosePositionTestResults> {
        const tetuConverter = await MockHelper.createMockTetuConverterSingleCall(signer);
        const strategy = await setupMockedStrategy(
          collateralAsset,
          [collateralAsset, borrowAsset],
          [100_000, 200_000],
          tetuConverter.address
        );
        const collateralAmount = parseUnits(params.collateralAmountNum.toString(), await collateralAsset.decimals());

        const borrowAssetDecimals = await borrowAsset.decimals();
        const amountToRepay = parseUnits(params.amountToRepayNum.toString(), borrowAssetDecimals);
        const needToRepay = parseUnits(params.needToRepayNum.toString(), borrowAssetDecimals);
        const amountRepaid = parseUnits(params.amountRepaidNum.toString(), borrowAssetDecimals);
        const swappedLeftoverCollateralOut = parseUnits((params.swappedLeftoverCollateralOutNum || 0).toString(), borrowAssetDecimals);
        const swappedLeftoverBorrowOut = parseUnits((params.swappedLeftoverBorrowOutNum || 0).toString(), borrowAssetDecimals);
        console.log("makeClosePositionTest.amountToRepay", amountToRepay);
        console.log("makeClosePositionTest.needToRepay", needToRepay);
        console.log("makeClosePositionTest.amountRepaid", amountRepaid);
        console.log("makeClosePositionTest.swappedLeftoverCollateralOut", swappedLeftoverCollateralOut);
        console.log("makeClosePositionTest.swappedLeftoverBorrowOut", swappedLeftoverBorrowOut);

        // Prepare tetu converter mock
        await tetuConverter.setGetDebtAmountCurrent(
          strategy.address,
          collateralAsset.address,
          borrowAsset.address,
          needToRepay,
          collateralAmount
        );
        await tetuConverter.setRepay(
          collateralAsset.address,
          borrowAsset.address,
          needToRepay,
          strategy.address,
          collateralAmount,
          needToRepay.sub(amountRepaid),
          swappedLeftoverCollateralOut,
          swappedLeftoverBorrowOut
        );

        // prepare liquidator
        if (amountToRepay.gt(needToRepay)) {
          const pool = ethers.Wallet.createRandom().address;
          const swapper = ethers.Wallet.createRandom().address;
          const priceOut = parseUnits((params.priceOut || 0).toString(), await collateralAsset.decimals());

          const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
          await controller.setLiquidator(liquidator.address);

          await liquidator.setBuildRoute(borrowAsset.address, collateralAsset.address, pool, swapper, "");
          await liquidator.setGetPriceForRoute(
            borrowAsset.address,
            collateralAsset.address,
            pool,
            swapper,
            amountToRepay.sub(needToRepay),
            priceOut
          );
          await liquidator.setLiquidateWithRoute(
            borrowAsset.address,
            collateralAsset.address,
            pool,
            swapper,
            amountToRepay.sub(needToRepay),
            priceOut
          );
          await collateralAsset.transfer(liquidator.address, priceOut);
        }

        // Prepare balances
        // put collateral on the balance of the tetuConverter
        await collateralAsset.transfer(tetuConverter.address, collateralAmount);
        // put borrowed amount to the balance of the strategy
        await borrowAsset.transfer(strategy.address, amountToRepay);

        const balanceBorrowAssetStrategyBefore = await borrowAsset.balanceOf(strategy.address);
        const balanceCollateralStrategyBefore = await collateralAsset.balanceOf(strategy.address);
        const retRepay = await strategy.callStatic.closePositionTestAccess(collateralAsset.address, borrowAsset.address, amountToRepay);
        await strategy.closePositionTestAccess(collateralAsset.address, borrowAsset.address, amountToRepay);

        return {
          retRepay,
          balanceBorrowAssetStrategyBefore,
          balanceCollateralStrategyBefore,
          balanceBorrowAssetStrategyAfter: await borrowAsset.balanceOf(strategy.address),
          balanceCollateralStrategyAfter: await collateralAsset.balanceOf(strategy.address),
        };
      }

      describe("Actually repaid amount is equal to needToRepay", () => {
        describe("amountToRepay == needToRepay", () => {
          it("should return expected value", async () => {
            const collateralAmountNum = 2000;
            const borrowedAmountNum = 1000;
            const r = await makeClosePositionTest(
              usdc,
              dai,
              {
                collateralAmountNum,
                amountToRepayNum: borrowedAmountNum,
                needToRepayNum: borrowedAmountNum,
                amountRepaidNum: borrowedAmountNum
              }
            );
            console.log("Results", r);

            const sret = [
              r.retRepay.toString(),
              r.balanceBorrowAssetStrategyBefore.sub(r.balanceBorrowAssetStrategyAfter).toString(),
              r.balanceCollateralStrategyAfter.sub(r.balanceCollateralStrategyBefore).toString()
            ].join("\n");
            const sexpected = [
              parseUnits(collateralAmountNum.toString(), await usdc.decimals()),
              parseUnits(borrowedAmountNum.toString(), await dai.decimals()),
              parseUnits(collateralAmountNum.toString(), await usdc.decimals()),
            ].join("\n");

            expect(sret).eq(sexpected);
          });
        });
        describe("amountToRepay > needToRepay", () => {
          it("should swap (amountToRepay-needToRepay) and return expected collateral value", async () => {
            const collateralAmountNum = 2000;
            const borrowedAmountNum = 1000;
            const delta = 100;
            const deltaPriceOut = 500;
            const r = await makeClosePositionTest(
              usdc,
              dai,
              {
                collateralAmountNum,
                amountToRepayNum: borrowedAmountNum,
                needToRepayNum: borrowedAmountNum - delta,
                amountRepaidNum: borrowedAmountNum - delta,
                priceOut: deltaPriceOut
              }
            );
            console.log("Results", r);

            const sret = [
              r.retRepay.toString(),

              r.balanceBorrowAssetStrategyBefore.sub(r.balanceBorrowAssetStrategyAfter).toString(),
              r.balanceCollateralStrategyAfter.sub(r.balanceCollateralStrategyBefore).toString()
            ].join("\n");
            const sexpected = [
              parseUnits((collateralAmountNum + deltaPriceOut).toString(), await usdc.decimals()),

              parseUnits(borrowedAmountNum.toString(), await dai.decimals()),
              parseUnits((collateralAmountNum + deltaPriceOut).toString(), await usdc.decimals()),
            ].join("\n");

            expect(sret).eq(sexpected);
          });
        });
      });
      describe("Actually repaid amount is less than needToRepay", () => {
        it("should revert", async () => {
          const collateralAmountNum = 2000;
          const borrowedAmountNum = 1000;
          const delta = 100; // amountToRepay - needToRepay
          const delta2 = 50; // needToRepay - amountRepaid
          const deltaPriceOut = 500;
          await expect(
            makeClosePositionTest(
              usdc,
              dai,
              {
                collateralAmountNum,
                amountToRepayNum: borrowedAmountNum,
                needToRepayNum: borrowedAmountNum - delta,
                amountRepaidNum: borrowedAmountNum - delta - delta2,
                priceOut: deltaPriceOut
              }
            )
          ).revertedWith("CSB: Can not convert back");
        });
      });
    });
  });

  describe("_withdrawFromPoolXXX - check investedAssetsUSD and assetPrice", () => {
    interface IMakeWithdrawTestInputParams {
      collateralAmountNum: number;
      amountToRepayNum: number;
      needToRepayNum: number;
      amountRepaidNum: number;
      depositorLiquidity: BigNumber;
      totalSupply: BigNumber;
      investedAssetNum: number;
      amountToWithdrawNum: number | undefined; // use undefined to withdraw all
      collateralDepositorAmountOutNum: number;
      borrowAssetDepositorAmountOutNum: number;
    }
    interface IMakeWithdrawTestResults {
      ret: {
        investedAssetsUSD: BigNumber;
        assetPrice: BigNumber;
      },
      expected: {
        investedAssetsUSD: BigNumber;
        assetPrice: BigNumber;
      },
      depositorLiquidity: BigNumber;
      investedAssets: BigNumber;
      amountToWithdraw: BigNumber | undefined;
    }
    async function makeWithdrawTest(
      collateralAsset: MockToken,
      borrowAsset: MockToken,
      params: IMakeWithdrawTestInputParams
    ) : Promise<IMakeWithdrawTestResults>{
      const tetuConverter = await MockHelper.createMockTetuConverterSingleCall(signer);
      const strategy = await setupMockedStrategy(
        collateralAsset,
        [collateralAsset, borrowAsset],
        [100_000, 200_000],
        tetuConverter.address
      );
      const collateralAmount = parseUnits(params.collateralAmountNum.toString(), await collateralAsset.decimals());

      const collateralAssetDecimals = await collateralAsset.decimals();
      const borrowAssetDecimals = await borrowAsset.decimals();

      const amountToRepay = parseUnits(params.amountToRepayNum.toString(), borrowAssetDecimals);
      const needToRepay = parseUnits(params.needToRepayNum.toString(), borrowAssetDecimals);
      const amountRepaid = parseUnits(params.amountRepaidNum.toString(), borrowAssetDecimals);
      console.log("makeClosePositionTest.amountToRepay", amountToRepay);
      console.log("makeClosePositionTest.needToRepay", needToRepay);
      console.log("makeClosePositionTest.amountRepaid", amountRepaid);

      await strategy.setDepositorLiquidity(params.depositorLiquidity);
      await strategy.setTotalSupply(params.totalSupply);

      const priceOracle = (await DeployerUtils.deployContract(
        signer,
        'PriceOracleMock',
        [usdc.address, dai.address],
        [parseUnits("1", 18), parseUnits("1", 18)]
      )) as PriceOracleMock;
      const tetuConverterController = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await tetuConverter.setController(tetuConverterController.address);

      const amountToWithdraw = params.amountToWithdrawNum
        ? parseUnits(params.amountToWithdrawNum.toString(), await collateralAsset.decimals())
        : undefined;

      // Prepare balances
      // put collateral on the balance of the tetuConverter
      await collateralAsset.transfer(tetuConverter.address, collateralAmount);
      // put borrowed amount to the balance of the strategy
      await borrowAsset.transfer(strategy.address, amountToRepay);

      // set _investedAssets to predefined value
      const depositorAmountsOut = [
        parseUnits(params.collateralDepositorAmountOutNum.toString(), collateralAssetDecimals),
        parseUnits(params.borrowAssetDepositorAmountOutNum.toString(), borrowAssetDecimals),
      ];
      await strategy.setDepositorQuoteExit(params.depositorLiquidity, depositorAmountsOut);

      const expectedInvestedAssets = parseUnits(
        (params.collateralDepositorAmountOutNum + params.investedAssetNum).toString(),
        collateralAssetDecimals
      );
      const expectedLiquidityAmount = amountToWithdraw
        ? params.depositorLiquidity
          .mul(101)
          .mul(amountToWithdraw)
          .div(expectedInvestedAssets)
          .div(100)
        : params.depositorLiquidity;

      await strategy.setDepositorExit(expectedLiquidityAmount, depositorAmountsOut);
      await tetuConverter.setQuoteRepay(
        strategy.address,
        collateralAsset.address,
        borrowAsset.address,
        amountToRepay.add(depositorAmountsOut[1]),
        parseUnits(params.investedAssetNum.toString(), await collateralAsset.decimals())
      );
      await strategy.updateInvestedAssetsTestAccess(); // tetuConverter.quoteRepay is called internally

      // we need a liquidator to avoid revert
      const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
      await controller.setLiquidator(liquidator.address);
      await liquidator.setBuildRoute(
        borrowAsset.address,
        collateralAsset.address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ""
      );

      // make test
      const depositorLiquidity = await strategy.depositorLiquidityTestAccess();
      const investedAssets = await strategy.investedAssets();


      const liquidityAmount = amountToWithdraw
        ? depositorLiquidity
          .mul(101)
          .mul(amountToWithdraw)
          .div(investedAssets)
          .div(100)
        : depositorLiquidity;
      const ret = amountToWithdraw
        ? await strategy.callStatic.withdrawFromPoolTestAccess(amountToWithdraw)
        : await strategy.callStatic._withdrawAllFromPoolTestAccess();

      // expected liquidity amount, see _withdrawFromPool implementation
      const expected = await strategy.getExpectedWithdrawnAmountUSDTestAccess(
        liquidityAmount,
        params.totalSupply,
        priceOracle.address
      );

      return {
        ret,
        expected,
        depositorLiquidity,
        investedAssets,
        amountToWithdraw,
      }
    }
    describe("Good paths", () => {
      describe("_withdrawFromPool", () => {
        it("should calculate liquidityAmount in expected way", async () => {
          const r = await makeWithdrawTest(
            usdc,
            dai,
            {
              collateralAmountNum: 1000,
              amountToWithdrawNum: 500,
              investedAssetNum: 10_000,

              depositorLiquidity: parseUnits("8000", 6),
              totalSupply: parseUnits("20000", 6),

              amountToRepayNum: 900,
              amountRepaidNum: 900,
              needToRepayNum: 900,

              collateralDepositorAmountOutNum: 1999,
              borrowAssetDepositorAmountOutNum: 173
            }
          );
          console.log(r);
          const sret = [
            r.ret.assetPrice.toString(),
            r.ret.investedAssetsUSD.toString()
          ].join();
          const sexpected = [
            r.expected.assetPrice.toString(),
            r.expected.investedAssetsUSD.toString()
          ].join();
          expect(sret).eq(sexpected);
        });
      });
      describe("_withdrawAllFromPool", () => {
        it("should use liquidityAmount equal to _depositorLiquidity()", async () => {
          const r = await makeWithdrawTest(
            usdc,
            dai,
            {
              collateralAmountNum: 1000,
              amountToWithdrawNum: undefined,
              investedAssetNum: 10_000,

              depositorLiquidity: parseUnits("8000", 6),
              totalSupply: parseUnits("20000", 6),

              amountToRepayNum: 900,
              amountRepaidNum: 900,
              needToRepayNum: 900,

              collateralDepositorAmountOutNum: 1999,
              borrowAssetDepositorAmountOutNum: 173

            }
          );
          console.log(r);
          const sret = [
            r.ret.assetPrice.toString(),
            r.ret.investedAssetsUSD.toString()
          ].join();
          const sexpected = [
            r.expected.assetPrice.toString(),
            r.expected.investedAssetsUSD.toString()
          ].join();
          expect(sret).eq(sexpected);
        });
      });
    });
    describe("Bad paths", () => {
      // amount == 0
    });
  });

  describe("calcInvestedAssets", () => {
    interface IMakeCalcInvestedAssetsInputParams {
      amountCollateralOnStrategyBalanceNum: number;
      amountBorrowAssetOnStrategyBalanceNum: number;
      quoteRepayResultCollateralAmountNum: number;
      depositorLiquidity: BigNumber;
      amountCollateralFromDepositorNum: number;
      amountBorrowAssetFromDepositorNum: number;
    }
    interface IMakeCalcInvestedAssetsTestResults {
      estimatedAssetsNum: number;
    }
    async function makeCalcInvestedAssetsTest(
      collateralAsset: MockToken,
      borrowAsset: MockToken,
      params: IMakeCalcInvestedAssetsInputParams
    ) : Promise<IMakeCalcInvestedAssetsTestResults> {
      const tetuConverter = await MockHelper.createMockTetuConverterSingleCall(signer);
      const strategy = await setupMockedStrategy(
        collateralAsset,
        [collateralAsset, borrowAsset],
        [100_000, 200_000],
        tetuConverter.address
      );

      const collateralDecimals = await collateralAsset.decimals();
      const borrowDecimals = await borrowAsset.decimals();

      const collateralAmount = parseUnits(params.amountCollateralOnStrategyBalanceNum.toString(), collateralDecimals);
      const collateralAmountOut = parseUnits(params.quoteRepayResultCollateralAmountNum.toString(), collateralDecimals);
      const borrowAmount = parseUnits(params.amountBorrowAssetOnStrategyBalanceNum.toString(), borrowDecimals);
      const amountCollateralFromDepositor = parseUnits(params.amountCollateralFromDepositorNum.toString(), collateralDecimals);
      const amountBorrowAssetFromDepositor = parseUnits(params.amountBorrowAssetFromDepositorNum.toString(), borrowDecimals);

      // Put two amounts on the balance of the strategy
      await collateralAsset.transfer(strategy.address, collateralAmount);
      await borrowAsset.transfer(strategy.address, borrowAmount);

      // set up mocked quoteRepay to exchange borrow asset => collateral asset
      await tetuConverter.setQuoteRepay(
        strategy.address,
        collateralAsset.address,
        borrowAsset.address,
        borrowAmount.add(amountBorrowAssetFromDepositor),
        collateralAmountOut
      );

      // set up mocked _depositorQuoteExit
      await strategy.setDepositorLiquidity(params.depositorLiquidity);
      await strategy.setDepositorQuoteExit(
        params.depositorLiquidity,
        [amountCollateralFromDepositor, amountBorrowAssetFromDepositor]
      );

      const estimatedAssets = await strategy.callStatic.calcInvestedAssets();

      return {
        estimatedAssetsNum: Number(formatUnits(estimatedAssets, collateralDecimals))
      };
    }
    describe("Good paths", () => {
     it("should return expected value", async () => {
       const r = await makeCalcInvestedAssetsTest(
         dai,
         usdc,
         {
           amountCollateralOnStrategyBalanceNum: 500,
           amountBorrowAssetOnStrategyBalanceNum: 700,
           quoteRepayResultCollateralAmountNum: 300,
           depositorLiquidity: parseUnits("1", 27), // the actual value doesn't matter
           amountCollateralFromDepositorNum: 77,
           amountBorrowAssetFromDepositorNum: 33
         }
       )
       console.log("Results", r);

       expect(r.estimatedAssetsNum).eq(300 + 77);
     });
    });
  });

  // describe("_convertDepositorPoolAssets", () => {
  //   describe("Good paths", () => {
  //     describe("amountToRepay <= needToRepay", () => {
  //       it("should call _closePosition() for borrowed token", async () => {
  //
  //       });
  //       it("should updated _investedAssets", async () => {
  //
  //       });
  //     });
  //   });
  // });
});