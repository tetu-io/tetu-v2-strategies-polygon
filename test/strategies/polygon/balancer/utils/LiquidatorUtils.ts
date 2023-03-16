import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { IERC20__factory, ITetuLiquidator__factory } from '../../../../../typechain';
import { MaticAddresses } from '../../../../../scripts/addresses/MaticAddresses';
import { Misc } from '../../../../../scripts/utils/Misc';

export interface ILiquidatorSwapResults {
  initialPrice: BigNumber;
  finalPrice: BigNumber;
  pricesRatio18: BigNumber;
}
/**
 * Change prices in liquidator by swapping big amounts
 */
export class LiquidatorUtils {
  /**
   * Swap {amountInPerSingleSwap} of assetIn to USDC until the price changes by {approxTargetPercent} percents
   */
  public static async swapToUsdc(
    signer: SignerWithAddress,
    liquidatorAddress: string,
    assetIn: string,
    assetInHolder: string,
    amountInPerSingleSwap: BigNumber,
    approxTargetPercent: number,
  ) : Promise<ILiquidatorSwapResults> {
    const assetOut = MaticAddresses.USDC_TOKEN;
    const liquidator = ITetuLiquidator__factory.connect(liquidatorAddress, signer);
    const initialPrice = await liquidator.getPrice(assetIn, assetOut, amountInPerSingleSwap);
    let price = initialPrice;
    while (initialPrice.sub(price).lt(price.mul(approxTargetPercent).div(100))) {
      // const holderBalance = await IERC20__factory.connect(assetIn, await Misc.impersonate(assetInHolder)).balanceOf(assetInHolder);
      // console.log("swapToUsdc.holderBalance", holderBalance, amountInPerSingleSwap);

      await IERC20__factory.connect(
        assetIn,
        await Misc.impersonate(assetInHolder)
      ).transfer(signer.address, amountInPerSingleSwap);
      await IERC20__factory.connect(assetIn, signer).approve(liquidator.address, amountInPerSingleSwap);

      await liquidator.liquidate(assetIn, assetOut, amountInPerSingleSwap, 100_000);
      price = await liquidator.getPrice(assetIn, assetOut, amountInPerSingleSwap);
      console.log("swapToUsdc.getPrice", price, assetIn, assetOut);
    }

    return {
      initialPrice,
      finalPrice: price,
      pricesRatio18: initialPrice.mul(Misc.ONE18).div(price)
    }
  }

  /**
   * Swap {amountInPerSingleSwap} of USDC to assetOut until the price changes by {approxTargetPercent} percents
   */
  public static async swapUsdcTo(
    signer: SignerWithAddress,
    liquidatorAddress: string,
    assetOut: string,
    assetInHolder: string,
    amountInPerSingleSwap: BigNumber,
    approxTargetPercent: number,
  ) : Promise<ILiquidatorSwapResults> {
    const assetIn = MaticAddresses.USDC_TOKEN;
    const liquidator = ITetuLiquidator__factory.connect(liquidatorAddress, signer);
    const initialPrice = await liquidator.getPrice(assetIn, assetOut, amountInPerSingleSwap);
    let price = initialPrice;
    while (initialPrice.sub(price).lt(price.mul(approxTargetPercent).div(100))) {
      // const holderBalance = await IERC20__factory.connect(assetIn, await Misc.impersonate(assetInHolder)).balanceOf(assetInHolder);
      // console.log("swapUsdcTo.holderBalance", holderBalance, amountInPerSingleSwap);
      await IERC20__factory.connect(
        assetIn,
        await Misc.impersonate(assetInHolder)
      ).transfer(signer.address, amountInPerSingleSwap);
      await IERC20__factory.connect(assetIn, signer).approve(liquidator.address, amountInPerSingleSwap);

      await liquidator.liquidate(assetIn, assetOut, amountInPerSingleSwap, 100_000);
      price = await liquidator.getPrice(assetIn, assetOut, amountInPerSingleSwap);
      console.log("swapUsdcTo.getPrice", price, assetIn, assetOut);
    }

    return {
      initialPrice,
      finalPrice: price,
      pricesRatio18: initialPrice.mul(Misc.ONE18).div(price)
    }
  }
}
