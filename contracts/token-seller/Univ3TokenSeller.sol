// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../integrations/uniswap/IUniswapV3Pool.sol";
import "./Univ3TokenSellerLib.sol";

contract Univ3TokenSeller {
  //region ---------------------- Constants
  string constant public TOKEN_SELLER_VERSION = "1.0.0";
  uint private DENOMINATOR = 100_000;
  //endregion ---------------------- Constants

  //region ---------------------- Members
  /// @notice Token to be sold
  address public immutable tokenA;
  /// @notice Token to be withdrawn
  address public immutable tokenB;
  IUniswapV3Pool public immutable pool;

  /// @notice Receiver of the token B
  address public receiver;

  /// @notice Min allowed lowest tick
  /// If current prices moves below it, the contract stops to move range and waits when the price will return back.
  int24 public minTick;

  /// @notice Range size in shares of the price.
  /// tickRange = [tick(currentPrice), tick(currentPrice * (1 + rangeSizeRatio / DENOMINATOR))]
  uint public rangeSizeRatio;

  /// @notice Amount of token B that cannot be withdrawn from balance inside {refreshPool}
  uint public minBalanceTokenB;

  /// @notice Lower bound of the currently opened position
  int24 public lowerTick;
  /// @notice Upper bound of the currently opened position
  int24 public upperTick;

  /// @notice Min amount of token B that should be transferred to the receiver
  uint public thresholdTokenB;

  // todo delay for refreshPool
  // todo list of operators

  //endregion ---------------------- Members

  //region ---------------------- Errors
  error AlreadyOpened();

  //endregion ---------------------- Errors

  //region ---------------------- Events

  //endregion ---------------------- Events

  //region ---------------------- Constructor
  constructor (
    address tokenA_,
    address tokenB_,
    address pool_
  ) {
    tokenA = tokenA_;
    tokenB = tokenB_;
    pool = IUniswapV3Pool(pool_);
  }
  //endregion ---------------------- Constructor

  //region ---------------------- View
  function balanceOf(address token) external view returns (uint) {
    return IERC20(token).balanceOf(address(this));
  }

  function needToRefresh() public view returns (bool) {
    int24 _lowerTick = lowerTick;
    int24 _upperTick = upperTick;
    (uint160 sqrtPriceX96, int24 tick,,,,,) = pool.slot0();
    int24 ratio = Univ3TokenSellerLib.calcNeedToRefreshRatio(tick, _lowerTick, _upperTick);
    if (ratio < 0) {
      return true;
    } else {
      (, uint amountB) = UniswapV3Lib.getAmountsForLiquidity(sqrtPriceX96, _lowerTick, _upperTick, pool.liquidity());
      return amountB > thresholdTokenB;
    }
  }

  function isPositionOpened() public view returns (bool) {
    return pool.liquidity() != 0;
  }

  //endregion ---------------------- View

  //region ---------------------- Actions

  /// @notice Deposit to pool required amount of {liquidity}.
  /// Exact amounts of token A and B are calculated on the base of {liquidity} and tick range
  function openPosition(uint liquidity) external {
    // todo only allowed contracts
    if (isPositionOpened()) revert AlreadyOpened();

    // get optimal tick range
    // shift tick range if price is below lower bound
    // enter to the pool
  }

  function closePosition() external {
    // todo only allowed contracts
    if (isPositionOpened()) {
      // todo exit from the pool
    }
  }

  function refreshPool() external {
    // todo only allowed contracts
    if (needToRefresh()) {
      // todo exit from the pool
      // todo enter to the pool
      // todo withdraw token B
    }
  }

  function withdraw(address receiver_, address token_, uint amount_) external {
    // todo only allowed contracts

  }
  //endregion ---------------------- Actions

  //region ---------------------- Governance action
  // todo function setLowestBound()

  //region ---------------------- Governance action
}