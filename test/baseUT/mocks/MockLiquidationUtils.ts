import {MockTetuConverter, MockTetuLiquidatorSingleCall} from "../../../typechain";
import {ILiquidationParams} from "./TestDataTypes";
import {ethers} from "hardhat";
import {parseUnits} from "ethers/lib/utils";

export async function setupMockedLiquidation(
  liquidator: MockTetuLiquidatorSingleCall,
  liquidation: ILiquidationParams
) {
  const pool = ethers.Wallet.createRandom().address;
  const swapper = ethers.Wallet.createRandom().address;
  await liquidator.setBuildRoute(
    liquidation.tokenIn.address,
    liquidation.tokenOut.address,
    pool,
    swapper,
    ""
  );
  await liquidator.setGetPriceForRoute(
    liquidation.tokenIn.address,
    liquidation.tokenOut.address,
    pool,
    swapper,
    parseUnits(liquidation.amountIn, await liquidation.tokenIn.decimals()),
    parseUnits(liquidation.amountOut, await liquidation.tokenOut.decimals())
  );
  await liquidator.setLiquidateWithRoute(
    liquidation.tokenIn.address,
    liquidation.tokenOut.address,
    pool,
    swapper,
    parseUnits(liquidation.amountIn, await liquidation.tokenIn.decimals()),
    parseUnits(liquidation.amountOut, await liquidation.tokenOut.decimals())
  );
  await liquidation.tokenOut.mint(
    liquidator.address,
    parseUnits(liquidation.amountOut, await liquidation.tokenOut.decimals())
  );
}

export async function setupIsConversionValid(
  converter: MockTetuConverter,
  liquidation: ILiquidationParams,
  valid: boolean
) {
  await converter.setIsConversionValid(
    liquidation.tokenIn.address,
    parseUnits(liquidation.amountIn, await liquidation.tokenIn.decimals()),
    liquidation.tokenOut.address,
    parseUnits(liquidation.amountOut, await liquidation.tokenOut.decimals()),
    valid
  );

}