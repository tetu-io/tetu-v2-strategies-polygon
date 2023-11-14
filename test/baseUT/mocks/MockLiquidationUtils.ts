import {MockTetuConverter, MockTetuLiquidatorSingleCall} from "../../../typechain";
import {IConversionValidationParams, ILiquidationParams} from "./TestDataTypes";
import {ethers} from "hardhat";
import {parseUnits} from "ethers/lib/utils";

const FAILED_0 = 0;
const SUCCESS_1 = 1;
const ZERO_PRICE_ERROR = 2;

export async function setupMockedLiquidation(
  liquidator: MockTetuLiquidatorSingleCall,
  liquidation: ILiquidationParams,
  pool0?: string,
  swapper0?: string
) {
  const pool = pool0 ?? ethers.Wallet.createRandom().address;
  const swapper = swapper0 ?? ethers.Wallet.createRandom().address;
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
  await liquidator.setPrice(
    liquidation.tokenIn.address,
    liquidation.tokenOut.address,
    parseUnits(liquidation.amountIn, await liquidation.tokenIn.decimals()),
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
  valid: boolean,
  generateZeroPriceError: boolean = false
) {
  await converter.setIsConversionValid(
    liquidation.tokenIn.address,
    parseUnits(liquidation.amountIn, await liquidation.tokenIn.decimals()),
    liquidation.tokenOut.address,
    parseUnits(liquidation.amountOut, await liquidation.tokenOut.decimals()),
    generateZeroPriceError
        ? ZERO_PRICE_ERROR
        : valid ? SUCCESS_1 : FAILED_0
  );
}

export async function setupIsConversionValidDetailed(converter: MockTetuConverter, p: IConversionValidationParams) {
  await converter.setIsConversionValid(
    p.tokenIn.address,
    parseUnits(p.amountIn, await p.tokenIn.decimals()),
    p.tokenOut.address,
    parseUnits(p.amountOut, await p.tokenOut.decimals()),
    p.result
  );
}