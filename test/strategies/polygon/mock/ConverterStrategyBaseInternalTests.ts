import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  ControllerMinimal,
  MockConverterStrategy,
  MockGauge,
  MockGauge__factory,
  MockToken,
  ProxyControlled,
  StrategySplitterV2,
  StrategySplitterV2__factory,
} from '../../../../typechain';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import { parseUnits } from 'ethers/lib/utils';
import { Misc } from '../../../../scripts/utils/Misc';
import { expect } from 'chai';
import { MockHelper } from '../../../baseUT/helpers/MockHelper';
import { BigNumber } from 'ethers';

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
  before(async function() {
    [signer, signer1, signer2] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();

    controller = await DeployerUtils.deployMockController(signer);
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    await usdc.transfer(signer2.address, parseUnits('1', 6));

    // set up a vault and a mocked gage
    const mockGaugeImp = await DeployerUtils.deployContract(signer, 'MockGauge') as MockGauge;
    const gProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    await gProxy.initProxy(mockGaugeImp.address);

    mockGauge = MockGauge__factory.connect(gProxy.address, signer);
    await mockGauge.init(controller.address);

    // set up NOT INITIALIZED splitter
    const sProxy = await DeployerUtils.deployContract(signer, '@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol:ProxyControlled') as ProxyControlled;
    const splitterImpl = await DeployerUtils.deployContract(signer, 'StrategySplitterV2') as StrategySplitterV2;
    await sProxy.initProxy(splitterImpl.address);
    splitterNotInitialized = StrategySplitterV2__factory.connect(sProxy.address, signer);
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });
  //endregion before, after

  //region Utils
  interface ISetupMockedStrategyResults {
    strategy: MockConverterStrategy;
    depositorReserves: BigNumber[];
  }

  /**
   * Set up a vault for the given asset.
   * Set up a strategy with given set of the tokens and given values of the resources.
   * Initialize the pre-created splitter by the given asset
   */
  async function setupMockedStrategy(
    asset: MockToken,
    depositorTokens: MockToken[],
    depositorReservesNum: number[],
    tetuConverterAddress?: string,
  ): Promise<ISetupMockedStrategyResults> {
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
        async(token, index) => parseUnits(depositorReservesNum[index].toString(), await token.decimals()),
      ),
    );
    await strategy.init(
      controller.address,
      splitter.address,
      tetuConverterAddress || ethers.Wallet.createRandom().address,
      depositorTokens.map(x => x.address),
      [1, 1],
      depositorReserves,
    );

    await splitterNotInitialized.addStrategies([strategy.address], [0]);
    return { strategy, depositorReserves };
  }

  //endregion Utils

  describe('_closePosition', () => {
    describe('Good paths', () => {
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
        params: IMakeClosePositionTestInputParams,
      ): Promise<IMakeClosePositionTestResults> {
        const tetuConverter = await MockHelper.createMockTetuConverter(signer);
        const strategy = (await setupMockedStrategy(
          collateralAsset,
          [collateralAsset, borrowAsset],
          [100_000, 200_000],
          tetuConverter.address,
        )).strategy;
        const collateralAmount = parseUnits(params.collateralAmountNum.toString(), await collateralAsset.decimals());

        const borrowAssetDecimals = await borrowAsset.decimals();
        const amountToRepay = parseUnits(params.amountToRepayNum.toString(), borrowAssetDecimals);
        const needToRepay = parseUnits(params.needToRepayNum.toString(), borrowAssetDecimals);
        const amountRepaid = parseUnits(params.amountRepaidNum.toString(), borrowAssetDecimals);
        const swappedLeftoverCollateralOut = parseUnits(
          (params.swappedLeftoverCollateralOutNum || 0).toString(),
          borrowAssetDecimals,
        );
        const swappedLeftoverBorrowOut = parseUnits(
          (params.swappedLeftoverBorrowOutNum || 0).toString(),
          borrowAssetDecimals,
        );
        console.log('makeClosePositionTest.amountToRepay', amountToRepay);
        console.log('makeClosePositionTest.needToRepay', needToRepay);
        console.log('makeClosePositionTest.amountRepaid', amountRepaid);
        console.log('makeClosePositionTest.swappedLeftoverCollateralOut', swappedLeftoverCollateralOut);
        console.log('makeClosePositionTest.swappedLeftoverBorrowOut', swappedLeftoverBorrowOut);

        // Prepare tetu converter mock
        await tetuConverter.setGetDebtAmountCurrent(
          strategy.address,
          collateralAsset.address,
          borrowAsset.address,
          needToRepay,
          collateralAmount,
          true
        );
        await tetuConverter.setRepay(
          collateralAsset.address,
          borrowAsset.address,
          needToRepay,
          strategy.address,
          collateralAmount,
          needToRepay.sub(amountRepaid),
          swappedLeftoverCollateralOut,
          swappedLeftoverBorrowOut,
        );

        // prepare liquidator
        if (amountToRepay.gt(needToRepay)) {
          const pool = ethers.Wallet.createRandom().address;
          const swapper = ethers.Wallet.createRandom().address;
          const priceOut = parseUnits((params.priceOut || 0).toString(), await collateralAsset.decimals());

          const liquidator = await MockHelper.createMockTetuLiquidatorSingleCall(signer);
          await controller.setLiquidator(liquidator.address);

          await liquidator.setBuildRoute(borrowAsset.address, collateralAsset.address, pool, swapper, '');
          await liquidator.setGetPriceForRoute(
            borrowAsset.address,
            collateralAsset.address,
            pool,
            swapper,
            amountToRepay.sub(needToRepay),
            priceOut,
          );
          await liquidator.setLiquidateWithRoute(
            borrowAsset.address,
            collateralAsset.address,
            pool,
            swapper,
            amountToRepay.sub(needToRepay),
            priceOut,
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
        const retRepay = await strategy.callStatic.closePositionTestAccess(
          collateralAsset.address,
          borrowAsset.address,
          amountToRepay,
        );
        await strategy.closePositionTestAccess(collateralAsset.address, borrowAsset.address, amountToRepay);

        return {
          retRepay: retRepay.returnedAssetAmount,
          balanceBorrowAssetStrategyBefore,
          balanceCollateralStrategyBefore,
          balanceBorrowAssetStrategyAfter: await borrowAsset.balanceOf(strategy.address),
          balanceCollateralStrategyAfter: await collateralAsset.balanceOf(strategy.address),
        };
      }

      describe('Actually repaid amount is equal to needToRepay', () => {
        describe('amountToRepay == needToRepay', () => {
          it('should return expected value', async() => {
            const collateralAmountNum = 2000;
            const borrowedAmountNum = 1000;
            const r = await makeClosePositionTest(
              usdc,
              dai,
              {
                collateralAmountNum,
                amountToRepayNum: borrowedAmountNum,
                needToRepayNum: borrowedAmountNum,
                amountRepaidNum: borrowedAmountNum,
              },
            );
            console.log('Results', r);

            const sret = [
              r.retRepay.toString(),
              r.balanceBorrowAssetStrategyBefore.sub(r.balanceBorrowAssetStrategyAfter).toString(),
              r.balanceCollateralStrategyAfter.sub(r.balanceCollateralStrategyBefore).toString(),
            ].join('\n');
            const sexpected = [
              parseUnits(collateralAmountNum.toString(), await usdc.decimals()),
              parseUnits(borrowedAmountNum.toString(), await dai.decimals()),
              parseUnits(collateralAmountNum.toString(), await usdc.decimals()),
            ].join('\n');

            expect(sret).eq(sexpected);
          });
        });
        describe('amountToRepay > needToRepay', () => {
          it('should reqpay only needToRepay amount and leave leftovers for swap', async() => {
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
                priceOut: deltaPriceOut,
              },
            );
            console.log('Results', r);

            const sret = [
              r.retRepay.toString(),

              r.balanceBorrowAssetStrategyBefore.sub(r.balanceBorrowAssetStrategyAfter).toString(),
              r.balanceCollateralStrategyAfter.sub(r.balanceCollateralStrategyBefore).toString(),
            ].join('\n');
            const sexpected = [
              parseUnits((collateralAmountNum).toString(), await usdc.decimals()),

              parseUnits((borrowedAmountNum - delta).toString(), await dai.decimals()),
              parseUnits((collateralAmountNum).toString(), await usdc.decimals()),
            ].join('\n');

            expect(sret).eq(sexpected);
          });
        });
      });
      describe('Actually repaid amount is less than needToRepay', () => {
        it('should revert', async() => {
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
                priceOut: deltaPriceOut,
              },
            ),
          ).revertedWith('SB: Wrong value'); // StrategyLib.WRONG_VALUE
        });
      });
    });
  });
});
