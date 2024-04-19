// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "../integrations/uniswap/IUniswapV3Pool.sol";
import "../integrations/uniswap/IUniswapV3MintCallback.sol";
import "./Univ3TokenSellerLib.sol";

/// @notice Deposit amount of token A to the pool under control using narrow tick range P <= Pa < Pb
/// where P - current price, Pa and Pb - lower and upper bounds of the range, Pa - P <= tickSpacing
/// After any swapping current price is moved from P to P'. If the price is moved far enough,
/// {refreshPool} closes exist position and opens new one with fixe tick range (again, P' <= Pa < Pb)
/// Only A token is deposited to the pool. If B token appears on the balance, it's withdrawn to the given receiver.
contract Univ3TokenSeller is IUniswapV3MintCallback {
  //region ---------------------- Constants
  string constant public TOKEN_SELLER_VERSION = "1.0.0";
  //endregion ---------------------- Constants

  //region ---------------------- Members
  /// @notice Token to be sold
  address public immutable tokenA;

  /// @notice Token to be withdrawn
  address public immutable tokenB;

  /// @notice Pool under control
  IUniswapV3Pool public immutable pool;

  /// @notice pool.tickSpacing()
  int24 public immutable tickSpacing;

  /// @notice False means that token A is pool.token0 and token B is pool.token1 and vice versa
  bool public immutable poolSwapTokens;

  /// @notice Governance of this contract
  address public owner;

  /// @notice New owner (not zero during process of changing the governance)
  address public pendingOwner;

  /// @notice Config params of pool refreshing
  Univ3TokenSellerLib.TokenSellerConfig public config;

  /// @notice Current state of the opened position
  Univ3TokenSellerLib.TokenSellerState public state;

  /// @notice Operator => is allowed to call {refreshPool}
  /// Operators are allowed to call refreshPool beside the owner
  mapping (address => bool) public operators;

  //endregion ---------------------- Members

  //region ---------------------- Errors
  /// @notice Initial position is already opened. If you need to re-open position, close exist position at first.
  error AlreadyOpened();

  /// @notice A new position cannot be opened with zero in-amount of token A
  error ZeroAmountA();

  error ErrorZeroAddress();
  error ErrorPendingOwner();

  error OnlyOwner();
  error OnlyOwnerOrOperator();
  error OnlyPool();

  //endregion ---------------------- Errors

  //region ---------------------- Constructor
  constructor (
    address tokenA_,
    address tokenB_,
    address pool_,
    Univ3TokenSellerLib.TokenSellerConfig memory config_,
    address owner_
  ) {
    tokenA = tokenA_;
    tokenB = tokenB_;
    pool = IUniswapV3Pool(pool_);
    config = config_;
    tickSpacing = IUniswapV3Pool(pool_).tickSpacing();
    owner = owner_;
    poolSwapTokens = IUniswapV3Pool(pool_).token1() == tokenA;
  }
  //endregion ---------------------- Constructor

  //region ---------------------- Restrictions
  function onlyOwner() internal view {
    if (owner != msg.sender) revert OnlyOwner();
  }

  function onlyOwnerOrOperator(address sender) internal view {
    if (owner != sender && !operators[sender]) revert OnlyOwnerOrOperator();
  }

  //endregion ---------------------- Restrictions

  //region ---------------------- View
  function balanceOf(address token) external view returns (uint) {
    return IERC20(token).balanceOf(address(this));
  }

  function needToRefresh() public view returns (bool) {
    return Univ3TokenSellerLib.needToRefresh(pool, tickSpacing, config, state, poolSwapTokens);
  }

  function isPositionOpened() public view returns (bool) {
    return state.liquidityAmount != 0;
  }
  //endregion ---------------------- View

  //region ---------------------- Configure
  function setConfig(Univ3TokenSellerLib.TokenSellerConfig memory config_) external {
    onlyOwner();

    config = config_;
  }

  /// @notice Suggest to change the owner
  function setOwner(address newOwner_) external {
    onlyOwner();
    if (newOwner_ == address(0)) revert ErrorZeroAddress();

    pendingOwner = newOwner_;
    emit Univ3TokenSellerLib.OnSetOwner(newOwner_);
  }

  /// @notice Old owner has suggested to change the owner.
  ///         Newly suggested owner must accept the change to actually change the owner.
  function acceptOwner() external {
    if (pendingOwner != msg.sender) revert ErrorPendingOwner();

    owner = pendingOwner;
    pendingOwner = address(0);
    emit Univ3TokenSellerLib.OnAcceptOwner(owner);
  }

  /// @notice Add or remove an operator
  function setOperator(address operator_, bool isOperator) external {
    onlyOwner();
    operators[operator_] = isOperator;
  }
  //endregion ---------------------- Configure

  //region ---------------------- Actions

  /// @notice Deposit to pool required amount of {liquidity}.
  /// Exact amounts of token A and B are calculated on the base of {liquidity} and tick range
  function openPosition() external {
    onlyOwner();

    if (isPositionOpened()) revert AlreadyOpened();

    uint amountA = _getAmountA();
    Univ3TokenSellerLib.enter(pool, tickSpacing, config, state, amountA, poolSwapTokens);
  }

  function closePosition() external {
    onlyOwner();

    if (isPositionOpened()) {
      Univ3TokenSellerLib.exit(pool, state, true);
    }
  }

  /// @notice Re-enter to the pool, move range near to the current price: P <= pA < pB (pA - P <= tickSpacing)
  /// where P is current price, pA and pB - prices of lower and upper bounds of the selected tick range.
  function refreshPool() external {
    onlyOwnerOrOperator(msg.sender);

    if (needToRefresh()) {
      Univ3TokenSellerLib.exit(pool, state, false);
      Univ3TokenSellerLib.enter(pool, tickSpacing, config, state, _getAmountA(), poolSwapTokens);

      // send all tokens B to the owner
      uint balanceB = IERC20(tokenB).balanceOf(address(this));
      if (balanceB > config.thresholdTokenB) {
        IERC20(tokenB).transfer(owner, balanceB);
        emit Univ3TokenSellerLib.Withdraw(owner, tokenB, balanceB);
      }

      state.lastRefreshPoolTimestamp = block.timestamp;
    }
  }

  function withdraw(address receiver_, address token_, uint amount_) external {
    onlyOwner();

    IERC20(token_).transfer(receiver_, amount_);
    emit Univ3TokenSellerLib.Withdraw(receiver_, token_, amount_);
  }
  //endregion ---------------------- Actions

  //region ---------------------- UniswapV3 callbacks
  /// @notice Uniswap V3 callback fn, called back on pool.mint
  function uniswapV3MintCallback(uint amount0Owed, uint amount1Owed, bytes calldata /* data */) external override {
    if (msg.sender != address(pool)) revert OnlyPool();

    if (amount0Owed != 0) {
      IERC20(IUniswapV3Pool(msg.sender).token0()).transfer(msg.sender, amount0Owed);
    }
    if (amount1Owed != 0) {
      IERC20(IUniswapV3Pool(msg.sender).token1()).transfer(msg.sender, amount1Owed);
    }
  }
  //endregion ---------------------- UniswapV3 callbacks

  //region ---------------------- Internal logic
  /// @notice Get in-amount of token A to enter to the pool
  function _getAmountA() internal view returns (uint amountA) {
    amountA = Math.min(config.amountA, IERC20(tokenA).balanceOf(address(this)));
    if (amountA == 0) revert ZeroAmountA();
  }

  //endregion ---------------------- Internal logic
}