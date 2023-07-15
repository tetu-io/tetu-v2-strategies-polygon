import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber, ContractTransaction, Signer} from "ethers";
import {
  IDForceController, IDForceController__factory,
  IDForcePriceOracle,
  IDForcePriceOracle__factory
} from "../../../../typechain";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";

//region Data types
export interface IDForceMarketData {
  controller: string;
  name: string;
  symbol: string;
  decimals: number;
  ctoken: string;
  underlying: string;
  /** The supply interest rate per block, scaled by 1e18 */
  borrowRatePerBlock: BigNumber;
  exchangeRateStored: BigNumber;
  supplyRatePerBlock: BigNumber;
  /** cash balance of this cToken in the underlying asset */
  cash: BigNumber;
  /** Total amount of outstanding borrows of the underlying in this market */
  totalBorrows: BigNumber;
  /** Total amount of reserves of the underlying held in this market */
  totalReserves: BigNumber;
  /** Total number of tokens in circulation */
  totalSupply: BigNumber;
  /** Fraction of interest currently set aside for reserves */
  reserveRatio: BigNumber;
  /*
   *  Multiplier representing the most one can borrow the asset.
   *  For instance, 0.5 to allow borrowing this asset 50% * collateral value * collateralFactor.
   *  When calculating equity, 0.5 with 100 borrow balance will produce 200 borrow value
   *  Must be between (0, 1], and stored as a mantissa.
   */
  borrowFactorMantissa: BigNumber;
  /*
   *  Multiplier representing the most one can borrow against their collateral in this market.
   *  For instance, 0.9 to allow borrowing 90% of collateral value.
   *  Must be in [0, 0.9], and stored as a mantissa.
   */
  collateralFactorMantissa: BigNumber;
  closeFactorMantissa: BigNumber;
  mintPaused: boolean;
  redeemPaused: boolean;
  borrowPaused: boolean;
  /** Model which tells what the current interest rate should be */
  interestRateModel: string;
  /*
   *  The borrow capacity of the asset, will be checked in beforeBorrow()
   *  -1 means there is no limit on the capacity
   *  0 means the asset can not be borrowed any more
   */
  borrowCapacity: BigNumber;
  /*
   *  The supply capacity of the asset, will be checked in beforeMint()
   *  -1 means there is no limit on the capacity
   *  0 means the asset can not be supplied any more
   */
  supplyCapacity: BigNumber;
  price: BigNumber;
  underlyingDecimals: number;

  blocksPerYear: BigNumber;
}

export interface IDForceMarketRewards {
  controller: string;
  name: string;
  symbol: string;
  decimals: number;
  ctoken: string;
  underlying: string;

  distributionBorrowState_Index: BigNumber;
  distributionBorrowState_Block: BigNumber;
  distributionFactorMantissa: BigNumber;
  distributionSpeed: BigNumber;
  distributionSupplySpeed: BigNumber;
  distributionSupplyState_Index: BigNumber;
  distributionSupplyState_Block: BigNumber;
  globalDistributionSpeed: BigNumber;
  globalDistributionSupplySpeed: BigNumber;
  rewardToken: string;
  paused: boolean;

  rewardTokenPrice: BigNumber;
}

export interface IDForceMarketAccount {
  distributionSupplierIndex: BigNumber;
  distributionBorrowerIndex: BigNumber;
  accountBalance: BigNumber;
  rewards: BigNumber;
}

/**
 * All data at the given block
 * required to calculate rewards
 * that we will have at any given block in the future
 * (on the assumption, that no data is changed between blocks)
 */
export interface IRewardsStatePoint {
  accountBalance: BigNumber;
  stateIndex: BigNumber;
  distributionSpeed: BigNumber;
  totalToken: BigNumber;
  accountIndex: BigNumber;
  stateBlock: BigNumber;
}

/**
 * All data at the moment of supply
 * required to calculate amount of rewards
 * that we will have at any given block in the future
 * (on the assumption, that no data is changed after supply)
 */
export interface ISupplyRewardsStatePoint {
  /** Block in which supply happens */
  blockSupply: BigNumber;
  beforeSupply: {
    stateIndex: BigNumber;
    stateBlock: BigNumber;
    distributionSpeed: BigNumber;
    totalSupply: BigNumber;
  }
  supplyAmount: BigNumber;
}

/**
 * All data at the moment of borrow
 * required to calculate amount of borrow-rewards
 * that we will have at any given block in the future
 * (on the assumption, that no data is changed after supply)
 */
export interface IBorrowRewardsStatePoint {
  /** Block in which borrow happens */
  blockBorrow: BigNumber;
  beforeBorrow: {
    stateIndex: BigNumber;
    stateBlock: BigNumber;
    distributionSpeed: BigNumber;
    totalBorrow: BigNumber;
    borrowIndex: BigNumber;
    borrowBalanceStored: BigNumber;
  }
  borrowAmount: BigNumber;
  /**
   *  Borrow index at the moment of claiming rewards.
   *  Borrow index is updated manually(?) using updateInterest()
   */
  borrowIndexClaimRewards: BigNumber;
}

export interface IBorrowRewardsPredictionInput {
  blockNumber: BigNumber;
  amountToBorrow: BigNumber;

  accrualBlockNumber: BigNumber;

  stateIndex: BigNumber;
  stateBlock: BigNumber;
  borrowIndex: BigNumber;
  distributionSpeed: BigNumber;

  totalCash: BigNumber;
  totalBorrows: BigNumber;
  totalReserves: BigNumber;
  reserveFactor: BigNumber;
}
//endregion Data types

export class DForceHelper {
//region Access
  public static getController(signer: SignerWithAddress) : IDForceController {
    return IDForceController__factory.connect(MaticAddresses.DFORCE_CONTROLLER, signer);
  }

  public static async getPriceOracle(
    controller: IDForceController,
    signer: SignerWithAddress
  ) : Promise<IDForcePriceOracle> {
    return IDForcePriceOracle__factory.connect(await controller.priceOracle(), signer);
  }
}