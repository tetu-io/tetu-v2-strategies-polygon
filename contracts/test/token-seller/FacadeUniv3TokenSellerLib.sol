// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../../token-seller/Univ3TokenSellerLib.sol";

contract FacadeUniv3TokenSellerLib {
  Univ3TokenSellerLib.State private _state;
  Univ3TokenSellerLib.Config private _config;

  //region ------------------------------ For tests
  function setState(Univ3TokenSellerLib.State memory state_) external {
    _state = state_;
  }
  function getState() external view returns (Univ3TokenSellerLib.State memory state) {
    return _state;
  }
  function setConfig(Univ3TokenSellerLib.Config memory config_) external {
    _config = config_;
  }
  function getConfig() external view returns (Univ3TokenSellerLib.Config memory config) {
    return _config;
  }

  //endregion ------------------------------ For tests

  //region ------------------------------ Calculate tick range

  function calcTickRange(int24 tick, int24 tickRange, int24 tickSpacing) external pure returns (int24 lowerTick, int24 upperTick) {
    return Univ3TokenSellerLib.calcTickRangeSymmetrically(tick, tickRange, tickSpacing);
  }

  function getNarrowTickRange(int24 tick, int24 tickRangeSize, int24 tickSpacing, int24 minTick) external pure returns (int24 lowerTick, int24 upperTick) {
    return Univ3TokenSellerLib.getNarrowTickRange(tick, tickRangeSize, tickSpacing, minTick);
  }
  //endregion ------------------------------ Calculate tick range

  //region ---------------------- Enter/exit logic
  function needToRefresh(IUniswapV3Pool pool, int24 tickSpacing, bool poolSwapTokens) external view returns (bool) {
    return Univ3TokenSellerLib.needToRefresh(pool, tickSpacing, _config, _state, poolSwapTokens);
  }

  /// @notice Enter to the pool using narrow tick range given by {config}.
  /// Deposit only token A, amount of the second token is always zero.
  /// @param poolSwapTokens False means that token A is pool.token0 and token B is pool.token1 and vice versa
  /// @param amountA Amount of token A to be deposited to the pool. Assume that this amount exists on the balance.
  function enter(IUniswapV3Pool pool, int24 tickSpacing, uint amountA, bool poolSwapTokens) external {
    Univ3TokenSellerLib.enter(pool, tickSpacing, _config, _state, amountA, poolSwapTokens);
  }

  /// @notice Close position and withdraw all fees and amounts from the pool on balance.
  /// @param clearState True - clear values in {state}
  function exit(IUniswapV3Pool pool, bool clearState) external {
    Univ3TokenSellerLib.exit(pool, _state, clearState);
  }
  //endregion ---------------------- Enter/exit logic
}