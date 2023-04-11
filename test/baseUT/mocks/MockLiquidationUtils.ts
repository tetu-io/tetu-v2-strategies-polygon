import {MockTetuLiquidatorSingleCall} from "../../../typechain";
import {ILiquidationParams} from "./TestDataTypes";
import {ethers} from "hardhat";

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
    liquidation.amountIn,
    liquidation.amountOut
  );
  await liquidator.setLiquidateWithRoute(
    liquidation.tokenIn.address,
    liquidation.tokenOut.address,
    pool,
    swapper,
    liquidation.amountIn,
    liquidation.amountOut
  );
  await liquidation.tokenOut.mint(liquidator.address, liquidation.amountOut);
}