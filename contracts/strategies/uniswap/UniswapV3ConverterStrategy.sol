// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./UniswapV3Depositor.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";
import "../../interfaces/IRebalancingStrategy.sol";
import "./Uni3StrategyErrors.sol";

/// @title Delta-neutral liquidity hedging converter fill-up/swap rebalancing strategy for UniswapV3
/// @notice This strategy provides delta-neutral liquidity hedging for Uniswap V3 pools. It rebalances the liquidity
///         by utilizing fill-up and swap methods depending on the range size of the liquidity provided.
///         It also attempts to cover rebalancing losses with rewards.
/// @author a17
contract UniswapV3ConverterStrategy is UniswapV3Depositor, ConverterStrategyBase, IRebalancingStrategy {

  /////////////////////////////////////////////////////////////////////
  ///                CONSTANTS
  /////////////////////////////////////////////////////////////////////

  string public constant override NAME = "UniswapV3 Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.UNIV3;
  string public constant override STRATEGY_VERSION = "1.4.0";

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
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    UniswapV3ConverterStrategyLogicLib.initStrategyState(
      state,
      controller_,
      converter_,
      pool_,
      tickRange_,
      rebalanceTickRange_,
      ISplitter(splitter_).asset()
    );

    // setup specific name for UI
    strategySpecificName = UniswapV3ConverterStrategyLogicLib.createSpecificName(state);
    emit StrategySpecificNameChanged(strategySpecificName);
  }

  /////////////////////////////////////////////////////////////////////
  ///                OPERATOR ACTIONS
  /////////////////////////////////////////////////////////////////////

  /// @notice Disable fuse for the strategy.
  function disableFuse() external {
    StrategyLib.onlyOperators(controller());
    UniswapV3ConverterStrategyLogicLib.disableFuse(state, converter);
  }

  /// @notice Set the fuse threshold for the strategy.
  /// @param newFuseThreshold The new fuse threshold value.
  function setFuseThreshold(uint newFuseThreshold) external {
    StrategyLib.onlyOperators(controller());
    UniswapV3ConverterStrategyLogicLib.newFuseThreshold(state, newFuseThreshold);
  }

  function setStrategyProfitHolder(address strategyProfitHolder) external {
    StrategyLib.onlyOperators(controller());
    state.strategyProfitHolder = strategyProfitHolder;
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
  function needRebalance() public view returns (bool) {
    return UniswapV3ConverterStrategyLogicLib.needRebalance(
      state.isFuseTriggered,
      state.pool,
      state.lowerTick,
      state.upperTick,
      state.tickSpacing,
      state.rebalanceTickRange
    );
  }

  /// @return swapAtoB, swapAmount
  function quoteRebalanceSwap() external returns (bool, uint) {
    return UniswapV3ConverterStrategyLogicLib.quoteRebalanceSwap(state, converter);
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

    // todo change to new function developing by dvpublic
    uint oldInvestedAssets = _investedAssets;
    uint newInvestedAssets = _updateInvestedAssets();
    uint profitToCover;
    if (newInvestedAssets > oldInvestedAssets) {
      profitToCover = newInvestedAssets - oldInvestedAssets;
    } else {
      ISplitter(splitter).coverPossibleStrategyLoss(0, oldInvestedAssets - newInvestedAssets);
    }
    uint oldTotalAssets = totalAssets() - profitToCover;

    /// withdraw all liquidity from pool
    /// after disableFuse() liquidity is zero
    if (state.totalLiquidity > 0) {
      _depositorEmergencyExit();
    }

    (
    uint[] memory tokenAmounts, // _depositorEnter(tokenAmounts) if length == 2
    bool isNeedFillup,
    uint loss
    ) = UniswapV3ConverterStrategyLogicLib.rebalance(
      state,
      converter,
      _controller,
      oldTotalAssets,
      profitToCover
    );

    if (tokenAmounts.length == 2) {
      _depositorEnter(tokenAmounts);

      //add fill-up liquidity part of fill-up is used
      if (isNeedFillup) {
        UniswapV3ConverterStrategyLogicLib.addFillup(state);
      }
    }

    //updating investedAssets based on new baseAmounts
    _updateInvestedAssets();

    if (loss > 0) {
      ISplitter(splitter).coverPossibleStrategyLoss(0, loss);
    }
  }

  function rebalanceSwapByAgg(bool direction, uint amount, address agg, bytes memory swapData) external {
    address _controller = controller();
    StrategyLib.onlyOperators(_controller);

    // todo change to new function developing by dvpublic
    uint profitToCover;
    {
    uint oldInvestedAssets = _investedAssets;
    uint newInvestedAssets = _updateInvestedAssets();
    if (newInvestedAssets > oldInvestedAssets) {
      profitToCover = newInvestedAssets - oldInvestedAssets;
    } else {
      ISplitter(splitter).coverPossibleStrategyLoss(0, oldInvestedAssets - newInvestedAssets);
    }
    }
    uint oldTotalAssets = totalAssets() - profitToCover;

    /// withdraw all liquidity from pool
    /// after disableFuse() liquidity is zero
    if (state.totalLiquidity > 0) {
      _depositorEmergencyExit();
    }

    // _depositorEnter(tokenAmounts) if length == 2
    (uint[] memory tokenAmounts, uint loss) = UniswapV3ConverterStrategyLogicLib.rebalanceSwapByAgg(
      state,
      converter,
      oldTotalAssets,
      UniswapV3ConverterStrategyLogicLib.RebalanceSwapByAggParams(
        direction,
        amount,
        agg,
        swapData
      ),
      profitToCover
    );

    if (tokenAmounts.length == 2) {
      _depositorEnter(tokenAmounts);
    }

    //updating investedAssets based on new baseAmounts
    _updateInvestedAssets();

    if (loss > 0) {
      ISplitter(splitter).coverPossibleStrategyLoss(0, loss);
    }
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
    uint[] memory tokenAmounts
  ) {
    require(!needRebalance(), Uni3StrategyErrors.NEED_REBALANCE);

    tokenAmounts = new uint[](2);
    uint spentCollateral;

    bytes memory entryData = UniswapV3ConverterStrategyLogicLib.getEntryData(
      state.pool,
      state.lowerTick,
      state.upperTick,
      state.depositorSwapTokens
    );

    AppLib.approveIfNeeded(state.tokenA, amount_, address(tetuConverter_));
    (spentCollateral, tokenAmounts[1]) = ConverterStrategyBaseLib.openPosition(
      tetuConverter_,
      entryData,
      state.tokenA,
      state.tokenB,
      amount_,
      0
    );

    tokenAmounts[0] = amount_ - spentCollateral;
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  /// @return earned The amount of earned rewards.
  /// @return lost The amount of lost rewards.
  /// @return assetBalanceAfterClaim The asset balance after claiming rewards.
  function _handleRewards() override internal virtual returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    earned = UniswapV3ConverterStrategyLogicLib.calcEarned(state);
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    _rewardsLiquidation(rewardTokens, amounts);
    lost = 0; // hide warning
    assetBalanceAfterClaim = AppLib.balance(asset);
  }

  /// @notice Deposit given amount to the pool.
  /// @param amount_ The amount to be deposited.
  /// @param updateTotalAssetsBeforeInvest_ A boolean indicating if the total assets should be updated before investing.
  /// @return strategyLoss Loss should be covered from Insurance
  function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
    uint strategyLoss
  ) {
    if (state.isFuseTriggered) {
      uint[] memory tokenAmounts = new uint[](2);
      tokenAmounts[0] = amount_;
      emit OnDepositorEnter(tokenAmounts, tokenAmounts);
      return 0;
    } else {
      return super._depositToPool(amount_, updateTotalAssetsBeforeInvest_);
    }
  }

  function _beforeWithdraw(uint /*amount*/) internal view override {
    require(!needRebalance(), Uni3StrategyErrors.NEED_REBALANCE);
  }
}
