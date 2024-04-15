// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../integrations/uniswap/IUniswapV3Pool.sol";
import "./Univ3TokenSellerLib.sol";
import "../integrations/uniswap/IUniswapV3MintCallback.sol";

contract Univ3TokenSeller is IUniswapV3MintCallback {
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
  int24 public immutable tickSpacing;

  Univ3TokenSellerLib.Config public config;
  Univ3TokenSellerLib.State public state;

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
    address pool_,
    Univ3TokenSellerLib.Config memory config_
  ) {
    tokenA = tokenA_;
    tokenB = tokenB_;
    pool = IUniswapV3Pool(pool_);
    config = config_;
    tickSpacing = IUniswapV3Pool(pool_).tickSpacing();
  }
  //endregion ---------------------- Constructor

  //region ---------------------- View
  function balanceOf(address token) external view returns (uint) {
    return IERC20(token).balanceOf(address(this));
  }

  function needToRefresh() public view returns (bool) {
    int24 _lowerTick = state.lowerTick;
    int24 _upperTick = state.upperTick;
    (uint160 sqrtPriceX96, int24 tick,,,,,) = pool.slot0();
    int24 ratio = Univ3TokenSellerLib.calcNeedToRefreshRatio(tick, _lowerTick, _upperTick);
    if (ratio < 0) {
      // new price is below lower tick, tick range should be moved
      // difference in 1 tick is allowed, it's exist right after the call of refreshPool()
      return _lowerTick - tick > tickSpacing;
    } else {
      // new price is higher lowest tick
      (, uint amountB) = UniswapV3Lib.getAmountsForLiquidity(sqrtPriceX96, _lowerTick, _upperTick, pool.liquidity());
      return amountB > config.thresholdTokenB && uint(int(ratio)) > config.thresholdRatio;
    }
  }

  function isPositionOpened() public view returns (bool) {
    return pool.liquidity() != 0;
  }

  //endregion ---------------------- View

  //region ---------------------- Actions

  /// @notice Deposit to pool required amount of {liquidity}.
  /// Exact amounts of token A and B are calculated on the base of {liquidity} and tick range
  /// @param liquidity Required amount of liquidity that should be deposited to the pool.
  /// Assume that required amounts of A and B exist on the balance.
  function openPosition() external {
    // todo only allowed contracts
    if (isPositionOpened()) revert AlreadyOpened();

    Univ3TokenSellerLib._enter(pool, tickSpacing, config, state, config.amountA);
  }

  function closePosition() external {
    // todo only allowed contracts
    if (isPositionOpened()) {
      Univ3TokenSellerLib._exit(pool, state, true);
    }
  }

  function refreshPool() external {
    // todo only allowed contracts
    if (needToRefresh()) {
      Univ3TokenSellerLib._exit(pool, state, false);
      Univ3TokenSellerLib._enter(pool, tickSpacing, config, state, config.amountA);

      uint balanceB = IERC20(tokenB).balanceOf(address(this));
      if (balanceB > config.thresholdTokenB) {
        IERC20(tokenB).transfer(config.receiver, balanceB);
      }
    }
  }

  function withdraw(address receiver_, address token_, uint amount_) external {
    // todo only allowed contracts

    IERC20(token_).transfer(receiver_, amount_);
  }
  //endregion ---------------------- Actions

  //region ---------------------- UniswapV3 callbacks
  /// @notice Uniswap V3 callback fn, called back on pool.mint
  function uniswapV3MintCallback(uint amount0Owed, uint amount1Owed, bytes calldata data) external override {
    // todo sender can be equal to this
    address sender = abi.decode(data, (address));
    if (amount0Owed != 0) {
      IERC20(IUniswapV3Pool(msg.sender).token0()).transferFrom(sender, msg.sender, amount0Owed);
    }
    if (amount1Owed != 0) {
      IERC20(IUniswapV3Pool(msg.sender).token1()).transferFrom(sender, msg.sender, amount1Owed);
    }
  }
  //endregion ---------------------- UniswapV3 callbacks

  //region ---------------------- Governance action
  // todo function setLowestBound()

  //region ---------------------- Governance action
}