import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { IERC20__factory, ITetuLiquidator__factory, ControllerV2__factory, ITetuLiquidator } from '../../../../../typechain';
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
  ): Promise<ILiquidatorSwapResults> {
    const assetOut = MaticAddresses.USDC_TOKEN;
    const liquidator = ITetuLiquidator__factory.connect(liquidatorAddress, signer);
    const initialPrice = await liquidator.getPrice(assetIn, assetOut, amountInPerSingleSwap);
    let price = initialPrice;
    while (initialPrice.sub(price).abs().lt(price.mul(approxTargetPercent).div(100))) {
      // const holderBalance = await IERC20__factory.connect(assetIn, await Misc.impersonate(assetInHolder)).balanceOf(assetInHolder);
      // console.log("swapToUsdc.holderBalance", holderBalance, amountInPerSingleSwap);

      await IERC20__factory.connect(
        assetIn,
        await Misc.impersonate(assetInHolder),
      ).transfer(signer.address, amountInPerSingleSwap);
      await IERC20__factory.connect(assetIn, signer).approve(liquidator.address, amountInPerSingleSwap);

      await liquidator.liquidate(assetIn, assetOut, amountInPerSingleSwap, 100_000);
      price = await liquidator.getPrice(assetIn, assetOut, amountInPerSingleSwap);
      console.log('swapToUsdc.getPrice', price, assetIn, assetOut);
    }
    console.log('swapToUsdc.initialPrice.sub(price).abs()', initialPrice.sub(price).abs());
    console.log('swapToUsdc.price.mul(approxTargetPercent).div(100)', price.mul(approxTargetPercent).div(100));

    return {
      initialPrice,
      finalPrice: price,
      pricesRatio18: initialPrice.mul(Misc.ONE18).div(price),
    };
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
    singleSwapOnly: boolean = false
  ): Promise<ILiquidatorSwapResults> {
    const assetIn = MaticAddresses.USDC_TOKEN;
    const liquidator = ITetuLiquidator__factory.connect(liquidatorAddress, signer);
    const initialPrice = await liquidator.getPrice(assetIn, assetOut, amountInPerSingleSwap);
    let price = initialPrice;
    while (!singleSwapOnly && initialPrice.sub(price).abs().lt(price.mul(approxTargetPercent).div(100))) {
      // const holderBalance = await IERC20__factory.connect(assetIn, await Misc.impersonate(assetInHolder)).balanceOf(assetInHolder);
      // console.log("swapUsdcTo.holderBalance", holderBalance, amountInPerSingleSwap);
      await IERC20__factory.connect(
        assetIn,
        await Misc.impersonate(assetInHolder),
      ).transfer(signer.address, amountInPerSingleSwap);
      await IERC20__factory.connect(assetIn, signer).approve(liquidator.address, amountInPerSingleSwap);

      await liquidator.liquidate(assetIn, assetOut, amountInPerSingleSwap, 100_000);
      price = await liquidator.getPrice(assetIn, assetOut, amountInPerSingleSwap);
      console.log('swapUsdcTo.getPrice', price, assetIn, assetOut);
      console.log('swapUsdcTo.initialPrice', initialPrice);
      console.log('swapUsdcTo.price', price);
      console.log('swapUsdcTo.initialPrice.sub(price).abs()', initialPrice.sub(price).abs());
      console.log('swapUsdcTo.price.mul(approxTargetPercent).div(100)', price.mul(approxTargetPercent).div(100));
    }

    return {
      initialPrice,
      finalPrice: price,
      pricesRatio18: initialPrice.mul(Misc.ONE18).div(price),
    };
  }

  public static async addBlueChipsPools(
    signer: SignerWithAddress,
    controllerAddress: string,
    liquidator?: ITetuLiquidator
  ) {
    const controller = ControllerV2__factory.connect(controllerAddress, signer)
    const operators = await controller.operatorsList();
    const operator = await Misc.impersonate(operators[0]);
    const pools = [
      {
        pool: MaticAddresses.UNISWAPV3_USDC_DAI_100,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.DAI_TOKEN,
        tokenOut: MaticAddresses.USDC_TOKEN,
      },
      {
        pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.USDT_TOKEN,
        tokenOut: MaticAddresses.USDC_TOKEN,
      },
    ]
    await liquidator?.connect(operator).addBlueChipsPools(pools, true);
  }
}
