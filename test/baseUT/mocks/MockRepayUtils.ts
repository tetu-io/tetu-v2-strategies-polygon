import {MockTetuConverter} from "../../../typechain";
import {IQuoteRepayParams, IRepayParams} from "./TestDataTypes";
import {parseUnits} from "ethers/lib/utils";

export async function setupMockedRepay(
  tetuConverter: MockTetuConverter,
  user: string,
  p: IRepayParams
) {
  const decimalsCollateral = await p.collateralAsset.decimals();
  const decimalsBorrow = await p.borrowAsset.decimals();
  await tetuConverter.setGetDebtAmountCurrent(
    user,
    p.collateralAsset.address,
    p.borrowAsset.address,
    parseUnits(p.totalDebtAmountOut, decimalsBorrow),
    parseUnits(p.totalCollateralAmountOut, decimalsCollateral)
  );
  await tetuConverter.setRepay(
    p.collateralAsset.address,
    p.borrowAsset.address,
    parseUnits(p.amountRepay, decimalsBorrow),
    user,
    parseUnits(p.collateralAmountOut, decimalsCollateral),
    parseUnits(p.returnedBorrowAmountOut || "0", decimalsBorrow),
    parseUnits(p.swappedLeftoverCollateralOut || "0", decimalsCollateral),
    parseUnits(p.swappedLeftoverBorrowOut || "0", decimalsBorrow)
  );
  await p.collateralAsset.mint(
    tetuConverter.address,
    parseUnits(p.collateralAmountOut, decimalsCollateral)
  );
}

export async function setupMockedQuoteRepay(tetuConverter: MockTetuConverter, user: string, p: IQuoteRepayParams) {
  const decimalsCollateral = await p.collateralAsset.decimals();
  const decimalsBorrow = await p.borrowAsset.decimals();
  await tetuConverter.setQuoteRepay(
    user,
    p.collateralAsset.address,
    p.borrowAsset.address,
    parseUnits(p.amountRepay, decimalsBorrow),
    parseUnits(p.collateralAmountOut, decimalsCollateral),
  );
}