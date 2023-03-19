// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./UniswapV3Depositor.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";

/// @title Delta-neutral liquidity hedging converter fill-up/swap rebalancing strategy for UniswapV3
/// @notice This strategy provides delta-neutral liquidity hedging for Uniswap V3 pools. It rebalances the liquidity
///         by utilizing fill-up and swap methods depending on the range size of the liquidity provided.
///         It also attempts to cover rebalancing losses with rewards.
/// @author a17
contract UniswapV3ConverterStrategy is UniswapV3Depositor, ConverterStrategyBase {

  /////////////////////////////////////////////////////////////////////
  ///                CONSTANTS
  /////////////////////////////////////////////////////////////////////

  string public constant override NAME = "UniswapV3 Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.UNIV3;
  string public constant override STRATEGY_VERSION = "1.0.0";

  uint internal constant DEFAULT_FUSE_THRESHOLD = 5e15;

  /////////////////////////////////////////////////////////////////////
  ///                EVENTS
  /////////////////////////////////////////////////////////////////////

  event DisableFuse();
  event NewFuseThreshold(uint newFuseThreshold);

  /////////////////////////////////////////////////////////////////////
  ///                INIT
  /////////////////////////////////////////////////////////////////////

  /// @notice Initialize the strategy with the given parameters.
  /// @param controller_ The address of the controller.
  /// @param splitter_ The address of the splitter.
  /// @param converter_ The address of the converter.
  /// @param pool_ The address of the pool.
  /// @param tickRange_ The tick range for the liquidity position.
  /// @param rebalanceTickRange_ The tick range for rebalancing.
  function init(
    address controller_,
    address splitter_,
    address converter_,
    address pool_,
    int24 tickRange_,
    int24 rebalanceTickRange_
  ) external initializer {
    __UniswapV3Depositor_init(ISplitter(splitter_).asset(), pool_, tickRange_, rebalanceTickRange_);
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    address liquidator = IController(controller_).liquidator();
    IERC20(state.tokenA).approve(liquidator, type(uint).max);
    IERC20(state.tokenB).approve(liquidator, type(uint).max);

    /// for ultra-wide ranges we use Swap rebalancing strategy and Fill-up for other
    /// upperTick always greater then lowerTick
    state.fillUp = state.upperTick - state.lowerTick >= 4 * state.tickSpacing;

    if (UniswapV3ConverterStrategyLogicLib.isStablePool(state.pool)) {
      /// for stable pools fuse can be enabled
      state.isStablePool = true;
      // 0.5% price change
      state.fuseThreshold = DEFAULT_FUSE_THRESHOLD;
      emit NewFuseThreshold(DEFAULT_FUSE_THRESHOLD);
      state.lastPrice = UniswapV3ConverterStrategyLogicLib.getOracleAssetsPrice(converter, state.tokenA, state.tokenB);
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                OPERATOR ACTIONS
  /////////////////////////////////////////////////////////////////////

  /// @notice Disable fuse for the strategy.
  function disableFuse() external {
    StrategyLib.onlyOperators(controller());
    state.isFuseTriggered = false;
    emit DisableFuse();
  }

  /// @notice Set the fuse threshold for the strategy.
  /// @param newFuseThreshold The new fuse threshold value.
  function setFuseThreshold(uint newFuseThreshold) external {
    StrategyLib.onlyOperators(controller());
    state.fuseThreshold = newFuseThreshold;

    emit NewFuseThreshold(newFuseThreshold);
  }

  /////////////////////////////////////////////////////////////////////
  ///                   METRIC VIEWS
  /////////////////////////////////////////////////////////////////////

  /// @notice Check if the strategy is ready for hard work.
  /// @return A boolean indicating if the strategy is ready for hard work.
  function isReadyToHardWork() override external virtual view returns (bool) {
    return UniswapV3ConverterStrategyLogicLib.isReadyToHardWork(state, converter);
  }

  /// @notice Check if the strategy needs rebalancing.
  /// @return A boolean indicating if the strategy needs rebalancing.
  function needRebalance() external view returns (bool) {
    return UniswapV3ConverterStrategyLogicLib.needRebalance(
      state.isFuseTriggered,
      state.pool,
      state.lowerTick,
      state.upperTick,
      state.tickSpacing,
      state.rebalanceTickRange
    );
  }

  /////////////////////////////////////////////////////////////////////
  ///                   REBALANCE
  /////////////////////////////////////////////////////////////////////

  /// @dev The rebalancing functionality is the core of this strategy.
  ///      Depending on the size of the range of liquidity provided, the Fill-up or Swap method is used.
  ///      There is also an attempt to cover rebalancing losses with rewards.
  function rebalance() external {
    address _controller = controller();
    StrategyLib.onlyOperators(_controller);

    /// @dev withdraw all liquidity from pool with adding calculated fees to rebalanceEarned0, rebalanceEarned1
    _depositorEmergencyExit();

    (
    uint[] memory tokenAmounts, // _depositorEnter(tokenAmounts) if length == 2
    bool isNeedFillup
    ) = UniswapV3ConverterStrategyLogicLib.rebalance(
      state,
      converter,
      _controller,
      investedAssets()
    );

    if (tokenAmounts.length == 2) {
      _depositorEnter(tokenAmounts);

      //add fill-up liquidity part of fill-up is used
      if (isNeedFillup) {
        (state.lowerTickFillup, state.upperTickFillup, state.totalLiquidityFillup) = UniswapV3ConverterStrategyLogicLib.addFillup(
          state.pool,
          state.lowerTick,
          state.upperTick,
          state.tickSpacing,
          state.rebalanceEarned0,
          state.rebalanceEarned1
        );
      }
    }

    (
    uint receivedA,
    uint spentA,
    uint receivedB,
    uint spentB
    ) = UniswapV3ConverterStrategyLogicLib.getUpdateInfo(state, baseAmounts);

    _updateBaseAmountsForAsset(
      state.tokenA,
      receivedA,
      spentA
    );
    _updateBaseAmountsForAsset(
      state.tokenB,
      receivedB,
      spentB
    );

    //updating investedAssets based on new baseAmounts
    _updateInvestedAssets();
  }

  /////////////////////////////////////////////////////////////////////
  ///                   INTERNAL LOGIC
  /////////////////////////////////////////////////////////////////////

  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory /*tokens_*/,
    uint /*indexAsset_*/
  ) override internal virtual returns (
    uint[] memory tokenAmounts,
    uint[] memory borrowedAmounts,
    uint spentCollateral
  ) {
    tokenAmounts = new uint[](2);
    borrowedAmounts = new uint[](2);

    bytes memory entryData = UniswapV3ConverterStrategyLogicLib.getEntryData(
      state.pool,
      state.lowerTick,
      state.upperTick,
      state.tickSpacing,
      state.depositorSwapTokens
    );

    AppLib.approveIfNeeded(state.tokenA, amount_, address(tetuConverter_));
    (spentCollateral, borrowedAmounts[1]) = ConverterStrategyBaseLib.openPosition(
      tetuConverter_,
      entryData,
      state.tokenA,
      state.tokenB,
      amount_,
      0
    );

    tokenAmounts[0] = amount_ - spentCollateral;
    tokenAmounts[1] = borrowedAmounts[1];

    return (tokenAmounts, borrowedAmounts, spentCollateral);
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  /// @return earned The amount of earned rewards.
  /// @return lost The amount of lost rewards.
  /// @return assetBalanceAfterClaim The asset balance after claiming rewards.
  function _handleRewards() override internal virtual returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    uint assetBalanceBefore = _balance(asset);
    _claim();
    assetBalanceAfterClaim = _balance(asset);
    if (state.rebalanceLost > 0) {
      lost = state.rebalanceLost;
      state.rebalanceLost = 0;
    }
    (earned, lost) = ConverterStrategyBaseLib.registerIncome(assetBalanceBefore, assetBalanceAfterClaim, earned, lost);
    return (earned, lost, assetBalanceAfterClaim);
  }

  /// @notice Withdraw given amount from the pool.
  /// @param amount Amount to be withdrawn in terms of the asset.
  /// @return investedAssetsUSD The value that we should receive after withdrawing (in USD, decimals of the {asset})
  /// @return assetPrice Price of the {asset} from the price oracle
  /// @return totalAssetsDelta The {strategy} updates its totalAssets amount internally before withdrawing
  ///                          Return [totalAssets-before-withdraw - totalAssets-before-call-of-_withdrawFromPool]
  function _withdrawFromPool(uint amount) override internal virtual returns (
    uint investedAssetsUSD,
    uint assetPrice,
    int totalAssetsDelta
  ) {
    uint updatedInvestedAssets;
    (updatedInvestedAssets, totalAssetsDelta) = _updateInvestedAssetsAndGetDelta(true);
    require(updatedInvestedAssets != 0, AppErrors.NO_INVESTMENTS);
    (investedAssetsUSD, assetPrice) = _withdrawUniversal(amount, false, updatedInvestedAssets);
  }

  /// @notice Deposit given amount to the pool.
  /// @param amount_ The amount to be deposited.
  /// @param updateTotalAssetsBeforeInvest_ A boolean indicating if the total assets should be updated before investing.
  /// @return totalAssetsDelta The change in total assets after the deposit.
  function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
    int totalAssetsDelta
  ) {
    uint updatedInvestedAssets;
    (updatedInvestedAssets, totalAssetsDelta) = _updateInvestedAssetsAndGetDelta(updateTotalAssetsBeforeInvest_);

    // skip deposit for small amounts
    if (amount_ > reinvestThresholdPercent * updatedInvestedAssets / REINVEST_THRESHOLD_DENOMINATOR) {
      if (state.isFuseTriggered) {
        uint[] memory tokenAmounts = new uint[](2);
        tokenAmounts[0] = amount_;
        emit OnDepositorEnter(tokenAmounts, tokenAmounts);
        _updateBaseAmountsForAsset(state.tokenA, amount_, 0);
      } else {
        (address[] memory tokens, uint indexAsset) = _getTokens(asset);

        // prepare array of amounts ready to deposit, borrow missed amounts
        (uint[] memory amounts, uint[] memory borrowedAmounts, uint collateral) = _beforeDeposit(
          converter,
          amount_,
          tokens,
          indexAsset
        );

        // make deposit, actually consumed amounts can be different from the desired amounts
        (uint[] memory consumedAmounts,) = _depositorEnter(amounts);
        emit OnDepositorEnter(amounts, consumedAmounts);

        // adjust base-amounts
        _updateBaseAmounts(tokens, borrowedAmounts, consumedAmounts, indexAsset, - int(collateral));
      }

      // adjust _investedAssets
      _updateInvestedAssets();
    }
  }
}
