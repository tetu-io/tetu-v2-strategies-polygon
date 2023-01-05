import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  ControllerMinimal,
  MockConverterStrategy, MockConverterStrategy__factory, MockGauge, MockGauge__factory,
  MockToken, PriceOracleMock, PriceOracleMock__factory, ProxyControlled,
  StrategySplitterV2, StrategySplitterV2__factory,
  TetuVaultV2
} from "../../../../typechain";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../../scripts/utils/Misc";
import {BigNumber} from "ethers";
import {expect} from "chai";

/**
 * Test internal view functions of ConverterStrategyBase
 */
describe('MockConverterStrategyTests', function() {
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

  describe("ConverterStrategyBase._getExpectedWithdrawnAmountUSD", () => {
    /**
     * Set up a vault for the given asset.
     * Set up a strategy with given set of the tokens and given values of the resources.
     * Initialize the pre-created splitter by the given asset
     */
    async function setupMockedStrategy(
      asset: MockToken,
      depositorTokens: MockToken[],
      depositorReservesNum: number[]
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

      const strategy: MockConverterStrategy = MockConverterStrategy__factory.connect(
        (await DeployerUtils.deployProxy(signer, 'MockConverterStrategy')),
        signer
      );
      const depositorReserves = await Promise.all(
        depositorTokens.map(
          async (token, index) => parseUnits(depositorReservesNum[index].toString(), await token.decimals())
        )
      );
      await strategy.init(
        controller.address,
        splitter.address,
        ethers.Wallet.createRandom().address, // tetu converter is not used in the tests below
        depositorTokens.map(x => x.address),
        [],
        [],
        [1, 1],
        depositorReserves
      );

      await splitterNotInitialized.addStrategies([strategy.address], [0]);
      return strategy;
    }

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
        const priceOracle = (await DeployerUtils.deployContract(
          signer,
          'PriceOracleMock',
          [usdc.address, dai.address],
          [
            parseUnits("0", 18), // (!) usdc price is zero
            parseUnits("2", 18)
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
});