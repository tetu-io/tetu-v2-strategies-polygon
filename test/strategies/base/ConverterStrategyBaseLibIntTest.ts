import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../scripts/utils/TimeUtils';
import { defaultAbiCoder, parseUnits } from 'ethers/lib/utils';
import {
  ConverterStrategyBaseLibFacade,
  IConverterController__factory,
  IERC20__factory,
  IERC20Metadata__factory,
  IPriceOracle__factory,
  ITetuConverter,
  ITetuConverter__factory,
} from '../../../typechain';
import { expect } from 'chai';
import { MockHelper } from '../../baseUT/helpers/MockHelper';
import {
  getConverterAddress,
  getDForcePlatformAdapter,
  Misc,
} from '../../../scripts/utils/Misc';
import { BalanceUtils } from '../../baseUT/utils/BalanceUtils';
import { BigNumber } from 'ethers';
import { MaticAddresses } from '../../../scripts/addresses/MaticAddresses';
import { ConverterUtils } from '../../baseUT/utils/ConverterUtils';
import { MaticHolders } from '../../../scripts/addresses/MaticHolders';
import { areAlmostEqual } from '../../baseUT/utils/MathUtils';

/**
 * Test of ConverterStrategyBaseLib using ConverterStrategyBaseLibFacade,
 * real tetu converter, real assets.
 */
describe.skip('ConverterStrategyBaseLibIntTest', () => {
  //region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let facade: ConverterStrategyBaseLibFacade;
  let tetuConverter: ITetuConverter;
  //endregion Variables

  //region before, after
  before(async function() {
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    facade = await MockHelper.createConverterStrategyBaseFacade(signer);

    tetuConverter = ITetuConverter__factory.connect(getConverterAddress(), signer);
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

  //region Unit tests
  describe('openPosition.dust [matic block 40302700]', () => {
    interface IOpenPositionTestResults {
      collateralAmountOut: BigNumber;
      borrowedAmountOut: BigNumber;
      gasUsed: BigNumber;
      /** collateralAmountOut + borrowedAmountOut (in terms of the collateral) */
      totalAmountInTermsCollateral: BigNumber;
    }

    async function makeOpenPositionTest(
      entryData: string,
      collateralAsset: string,
      borrowAsset: string,
      amountIn: BigNumber,
      collateralHolder: string,
    ): Promise<IOpenPositionTestResults> {
      // Disable DForce (as it reverts on repay after block advance)
      await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());
      await ConverterUtils.addToWhitelist(signer, tetuConverter.address, facade.address);

      // todo add facade to whitelist of the tetu converter

      await BalanceUtils.getAmountFromHolder(
        collateralAsset,
        collateralHolder,
        facade.address,
        amountIn, // max possible collateral
      );

      await IERC20__factory.connect(
        collateralAsset,
        await Misc.impersonate(facade.address),
      ).approve(tetuConverter.address, amountIn);

      const ret = await facade.callStatic.openPosition(
        tetuConverter.address,
        entryData,
        collateralAsset,
        borrowAsset,
        amountIn,
        0,
      );

      const gasUsed = await facade.estimateGas.openPosition(
        tetuConverter.address,
        entryData,
        collateralAsset,
        borrowAsset,
        amountIn,
        0,
      );

      const priceOracle = IPriceOracle__factory.connect(
        await IConverterController__factory.connect(await tetuConverter.controller(), signer).priceOracle(),
        signer,
      );
      const priceCollateral = await priceOracle.getAssetPrice(collateralAsset);
      const priceBorrow = await priceOracle.getAssetPrice(borrowAsset);
      const decimalsCollateral = await IERC20Metadata__factory.connect(collateralAsset, signer).decimals();
      const decimalsBorrow = await IERC20Metadata__factory.connect(borrowAsset, signer).decimals();

      return {
        collateralAmountOut: ret.collateralAmountOut,
        borrowedAmountOut: ret.borrowedAmountOut,
        gasUsed,
        totalAmountInTermsCollateral: ret.collateralAmountOut.add(
          ret.borrowedAmountOut
            .mul(priceBorrow)
            .mul(parseUnits('1', decimalsCollateral))
            .div(priceCollateral)
            .div(parseUnits('1', decimalsBorrow)),
        ),
      };
    }

    describe('Good paths', () => {
      describe('Entry kind 1', () => {
        it('should return expected values, single borrow', async() => {
          const r = await makeOpenPositionTest(
            defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, 1, 1]),
            MaticAddresses.USDC_TOKEN,
            MaticAddresses.WETH_TOKEN,
            BigNumber.from('9762660842'),
            MaticHolders.HOLDER_USDC,
          );
          console.log('results', r);

          const ret = areAlmostEqual(r.totalAmountInTermsCollateral, BigNumber.from('9762660842'));

          expect(ret).eq(true);
        });
      });
    });
  });

  //endregion Unit tests
});
