import {MockTetuConverter, MockToken, PriceOracleMock} from "../../../typechain";
import {IBorrowParamsNum, IQuoteRepayParams, IRepayParams} from "./TestDataTypes";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../scripts/utils/Misc";
import {BigNumber, BigNumberish} from "ethers";

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
    parseUnits(p.totalCollateralAmountOut, decimalsCollateral),
    false
  );
  const totalDebtAmountOutWithDebtGap = (Number(p.totalDebtAmountOut) + Number(p.debtGapToSend || "0")).toString();
  await tetuConverter.setGetDebtAmountCurrent(
    user,
    p.collateralAsset.address,
    p.borrowAsset.address,
    parseUnits(totalDebtAmountOutWithDebtGap, decimalsBorrow),
    parseUnits(p.totalCollateralAmountOut, decimalsCollateral),
    true
  );

  await tetuConverter.setRepay(
    p.collateralAsset.address,
    p.borrowAsset.address,
    parseUnits(p.amountRepay, decimalsBorrow),
    user,
    parseUnits(p.collateralAmountOut, decimalsCollateral),
    parseUnits(p.returnedBorrowAmountOut || "0", decimalsBorrow),
    parseUnits(p.swappedLeftoverCollateralOut || "0", decimalsCollateral),
    parseUnits(p.swappedLeftoverBorrowOut || "0", decimalsBorrow),
    parseUnits(p.debtGapToReturn || "0", decimalsBorrow),
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
    parseUnits(p.swappedAmountOut || "0", decimalsCollateral)
  );
}

export async function setupPrices(priceOracleMock: PriceOracleMock, tokens: MockToken[], prices: string[]) {
  await priceOracleMock.changePrices(
    tokens.map(x => x.address),
    prices.map(x => parseUnits(x, 18))
  );
}

export async function setupMockedBorrow(converter: MockTetuConverter, user: string, p: IBorrowParamsNum) {
  const collateralAmount = await parseUnits(p.collateralAmount, await p.collateralAsset.decimals());
  const borrowAmount = parseUnits(p.maxTargetAmount, await p.borrowAsset.decimals());
  await converter.setFindBorrowStrategyOutputParams(
    "0x",
    [p.converter],
    [collateralAmount],
    [borrowAmount],
    [parseUnits("1", 18)], // apr value doesn't matter
    p.collateralAsset.address,
    collateralAmount,
    p.borrowAsset.address,
    30*24*60*60/2 // === _LOAN_PERIOD_IN_BLOCKS
  );

  await converter.setBorrowParams(
    p.converter,
    p.collateralAsset.address,
    collateralAmount,
    p.borrowAsset.address,
    borrowAmount,
    user,
    borrowAmount,
  );

  await p.borrowAsset.mint(converter.address, borrowAmount);
}

export async function setupMockedBorrowEntryKind1(
  converter: MockTetuConverter,
  user: string,
  p: IBorrowParamsNum,
  proportion0: BigNumberish = 1,
  proportion1: BigNumberish = 1
) {
  console.log("setupMockedBorrowEntryKind1.proportion0", proportion0);
  console.log("setupMockedBorrowEntryKind1.proportion1", proportion1);
  console.log("setupMockedBorrowEntryKind1.p.collateralAmount", p.collateralAmount);
  console.log("setupMockedBorrowEntryKind1.p.collateralAmountOut", p.collateralAmountOut);

  const collateralAmountIn = await parseUnits(p.collateralAmount, await p.collateralAsset.decimals());
  const collateralAmountToLock = p.collateralAmountOut
    ? await parseUnits(p.collateralAmountOut, await p.collateralAsset.decimals())
    : collateralAmountIn;

  const borrowAmount = parseUnits(p.maxTargetAmount, await p.borrowAsset.decimals());
  const borrowAmountToReturn = p.borrowAmountOut
    ? parseUnits(p.borrowAmountOut, await p.borrowAsset.decimals())
    : borrowAmount;

  await converter.setFindBorrowStrategyOutputParams(
    defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [1, proportion0, proportion1]),
    [p.converter],
    [collateralAmountIn],
    [borrowAmount],
    [parseUnits("1", 18)], // apr value doesn't matter
    p.collateralAsset.address,
    collateralAmountIn,
    p.borrowAsset.address,
    30*24*60*60/2 // === _LOAN_PERIOD_IN_BLOCKS
  );

  await converter.setBorrowParams(
    p.converter,
    p.collateralAsset.address,
    collateralAmountToLock,
    p.borrowAsset.address,
    borrowAmountToReturn,
    user,
    borrowAmountToReturn,
  );

  await p.borrowAsset.mint(converter.address, borrowAmount);
}