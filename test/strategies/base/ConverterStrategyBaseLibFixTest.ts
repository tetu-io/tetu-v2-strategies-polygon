import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../scripts/utils/TimeUtils';
import { DeployerUtils } from '../../../scripts/utils/DeployerUtils';
import { defaultAbiCoder, formatUnits, parseUnits } from 'ethers/lib/utils';
import { ConverterStrategyBaseLibFacade, MockToken, PriceOracleMock } from '../../../typechain';
import { expect } from 'chai';
import { MockHelper } from '../../baseUT/helpers/MockHelper';
import { controlGasLimitsEx } from '../../../scripts/utils/GasLimitUtils';
import {
  GAS_CALC_INVESTED_ASSETS_NO_DEBTS,
  GAS_CALC_INVESTED_ASSETS_SINGLE_DEBT,
  GAS_OPEN_POSITION,
  GAS_PERFORMANCE_FEE,
  GET_EXPECTED_WITHDRAW_AMOUNT_ASSETS,
  GET_GET_COLLATERALS,
  GET_INTERNAL_SWAP_TO_GIVEN_AMOUNT,
  GET_LIQUIDITY_AMOUNT_RATIO
} from "../../baseUT/GasLimits";
import {Misc} from "../../../scripts/utils/Misc";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {BigNumber, BigNumberish} from "ethers";
import {areAlmostEqual} from "../../baseUT/utils/MathUtils";
import {ILiquidationParams} from "../../baseUT/utils/TestDataTypes";
import {setupMockedLiquidation} from "./utils/MockLiquidationUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";

/**
 * Test of ConverterStrategyBaseLib using ConverterStrategyBaseLibFacade
 * to direct access of the library functions.
 *
 * Following tests are created using fixtures, not snapshots
 */
describe('ConverterStrategyBaseLibFixTest', () => {
  //region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let facade: ConverterStrategyBaseLibFacade;
  //endregion Variables

  //region before, after
  before(async function() {
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    facade = await MockHelper.createConverterStrategyBaseFacade(signer);
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 18);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);
    console.log("usdc", usdc.address);
    console.log("dai", dai.address);
    console.log("tetu", tetu.address);
    console.log("weth", weth.address);
    console.log("usdt", usdt.address);
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });
  //endregion before, after

  //region Unit tests
  describe("openPositionEntryKind1 (SCB-621)", () => {

    interface IOpenPositionEntryKind1TestParams {
      threshold: number,
      borrows?: {
        converter: string;
        collateralAsset: MockToken;
        collateralAmount: BigNumber;
        borrowAsset: MockToken;
        amountToBorrow: BigNumber;
      }[];
      findBorrowStrategyOutputs?: {
        entryData: string;
        sourceToken: string;
        amountIn: BigNumber;
        targetToken: string;

        converters: string[];
        collateralAmountsOut: BigNumber[];
        amountToBorrowsOut: BigNumber[];
        aprs18: BigNumber[];
      }[];
      amountBorrowAssetForTetuConverter: BigNumber;
      amountCollateralForFacade: BigNumber;
      amountInIsCollateral: boolean;
      prices: {
        collateral: BigNumber;
        borrow: BigNumber;
      };
    }

    interface IOpenPositionEntryKind1TestResults {
      collateralAmountOut: BigNumber;
      borrowedAmountOut: BigNumber;
      gasUsed: BigNumber;
      balanceBorrowAssetTetuConverter: BigNumber;
      balanceCollateralAssetFacade: BigNumber;
    }

    async function makeOpenPositionEntryKind1Test(
      entryData: string,
      collateralAsset: MockToken,
      borrowAsset: MockToken,
      amountIn: BigNumber,
      params: IOpenPositionEntryKind1TestParams,
    ): Promise<IOpenPositionEntryKind1TestResults> {
      const tetuConverter = await MockHelper.createMockTetuConverter(signer);

      if (params.borrows) {
        for (const b of params.borrows) {
          await tetuConverter.setBorrowParams(
            b.converter,
            b.collateralAsset.address,
            b.collateralAmount,
            b.borrowAsset.address,
            b.amountToBorrow,
            ethers.Wallet.createRandom().address,
            b.amountToBorrow,
          );
        }
      }

      if (params.findBorrowStrategyOutputs) {
        for (const b of params.findBorrowStrategyOutputs) {
          await tetuConverter.setFindBorrowStrategyOutputParams(
            b.entryData,
            b.converters,
            b.collateralAmountsOut,
            b.amountToBorrowsOut,
            b.aprs18,
            b.sourceToken,
            b.amountIn,
            b.targetToken,
            1, // period
          );
        }
      }

      const priceOracle = await MockHelper.createPriceOracle(
        signer,
        [collateralAsset.address, borrowAsset.address],
        [params.prices.collateral, params.prices.borrow],
      );
      const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await tetuConverter.setController(controller.address);

      await collateralAsset.mint(facade.address, params.amountCollateralForFacade);
      await borrowAsset.mint(tetuConverter.address, params.amountBorrowAssetForTetuConverter);

      if (params.amountInIsCollateral) {
        await collateralAsset.connect(await Misc.impersonate(facade.address)).approve(tetuConverter.address, amountIn);
      } else {
        await borrowAsset.connect(await Misc.impersonate(facade.address)).approve(tetuConverter.address, amountIn);
      }
      const ret = await facade.callStatic.openPositionEntryKind1(
        tetuConverter.address,
        entryData,
        collateralAsset.address,
        borrowAsset.address,
        amountIn,
        params.threshold,
      );

      const tx = await facade.openPositionEntryKind1(
        tetuConverter.address,
        entryData,
        collateralAsset.address,
        borrowAsset.address,
        amountIn,
        params.threshold,
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        collateralAmountOut: ret.collateralAmountOut,
        borrowedAmountOut: ret.borrowedAmountOut,
        gasUsed,
        balanceBorrowAssetTetuConverter: await borrowAsset.balanceOf(tetuConverter.address),
        balanceCollateralAssetFacade: await collateralAsset.balanceOf(facade.address),
      };
    }

    /**
     * https://dashboard.tenderly.co/tx/polygon/0x00b1287431f89a85879007f8a2a80d79976f818813718e5a122c29eadf430afe/debugger?trace=0.0.1.0.0.0.2.1.2.0.2.0.0.0.0.3.11.8.0
     * There were 3 borrows instead 1
     */
    async function reproduceError(threshold: number) : Promise<IOpenPositionEntryKind1TestResults> {
      const entryData1 = "0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000f4366000000000000000000000000000000000000000000000000000000000000d93e";
      return makeOpenPositionEntryKind1Test(
        entryData1,
        usdc,
        usdt,
        BigNumber.from("194495951"),
        {
          threshold,
          borrows: [
            {
              collateralAsset: usdc,
              collateralAmount: BigNumber.from("13606564"),
              borrowAsset: usdt,
              amountToBorrow: BigNumber.from("10052591"),
              converter: "0x14b8ffeb2484b01ca66d521b2a7a59628817aa53",
            },
            {
              collateralAsset: usdc,
              collateralAmount: BigNumber.from("2"),
              borrowAsset: usdt,
              amountToBorrow: BigNumber.from("1"),
              converter: "0x7d6ad97865258f11f1f31fb3b9b8838d1bce5bce",
            },
          ],
          findBorrowStrategyOutputs: [
            {
              converters: ["0x14b8ffeb2484b01ca66d521b2a7a59628817aa53", "0x7d6ad97865258f11f1f31fb3b9b8838d1bce5bce", "0x34a379bf1514e1a93179cdfe8dd4555d7822e91b"],
              sourceToken: usdc.address,
              targetToken: usdt.address,
              entryData: entryData1,
              aprs18: [BigNumber.from("-1481796327407567"), BigNumber.from("-192674234045099"), BigNumber.from("831344681206963")],
              amountIn: BigNumber.from("194495951"),
              collateralAmountsOut: [BigNumber.from("13606564"), BigNumber.from("13606564"), BigNumber.from("13606564")],
              amountToBorrowsOut: [BigNumber.from("10052591"), BigNumber.from("10115580"), BigNumber.from("10143568")],
            },
          ],
          amountCollateralForFacade: BigNumber.from("194495951"),
          amountBorrowAssetForTetuConverter: BigNumber.from("10052592"),
          amountInIsCollateral: true,
          prices: {
            collateral: BigNumber.from("1000082050000000000"),
            borrow: BigNumber.from("1000523100000000000")
          }
        },
      );
    }

    async function reproduceErrorSingleBorrow() : Promise<IOpenPositionEntryKind1TestResults> {
      return reproduceError(0);
    }
    async function reproduceErrorTwoBorrows() : Promise<IOpenPositionEntryKind1TestResults> {
      return reproduceError(10);
    }

    it('should make two borrows if threshold is 0', async() => {
      const r = await loadFixture(reproduceErrorSingleBorrow);

      expect(r.collateralAmountOut).eq(BigNumber.from("13606566")); // (!) 64 + 2 = 66 (two borrows)
      expect(r.borrowedAmountOut).eq(BigNumber.from("10052592")); // (!) 91 + 1 = 92 (two borrows)
    });
    it('should make single borrow if threshold is 10', async() => {
      const r = await loadFixture(reproduceErrorTwoBorrows);

      expect(r.collateralAmountOut).eq(BigNumber.from("13606564")); // (!) 64 (single borrow)
      expect(r.borrowedAmountOut).eq(BigNumber.from("10052591")); // (!) 91 (single borrow)
    });
  });

//endregion Unit tests
});
