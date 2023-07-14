// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./KyberDepositor.sol";
import "./KyberConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";
import "../../interfaces/IRebalancingV2Strategy.sol";
import "../../interfaces/IFarmingStrategy.sol";
import "./KyberStrategyErrors.sol";


contract KyberConverterStrategy is KyberDepositor, ConverterStrategyBase, IRebalancingV2Strategy, IFarmingStrategy {

  /////////////////////////////////////////////////////////////////////
  ///                CONSTANTS
  /////////////////////////////////////////////////////////////////////

  string public constant override NAME = "Kyber Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.KYBER;
  string public constant override STRATEGY_VERSION = "2.0.0";

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
    int24 rebalanceTickRange_,
    bool isStablePool,
    uint pId
  ) external initializer {
    __ConverterStrategyBase_init(controller_, splitter_, converter_);
    KyberConverterStrategyLogicLib.initStrategyState(
      state,
      controller_,
      converter_,
      pool_,
      tickRange_,
      rebalanceTickRange_,
      ISplitter(splitter_).asset(),
      isStablePool
    );

    state.pId = pId;

    // setup specific name for UI
    baseState.strategySpecificName = KyberConverterStrategyLogicLib.createSpecificName(state);
    emit StrategyLib2.StrategySpecificNameChanged(baseState.strategySpecificName);
  }

  /////////////////////////////////////////////////////////////////////
  ///                OPERATOR ACTIONS
  /////////////////////////////////////////////////////////////////////

  /// @notice Disable fuse for the strategy.
  function disableFuse() external {
    StrategyLib2.onlyOperators(controller());
    state.isFuseTriggered = false;
    state.lastPrice = ConverterStrategyBaseLib2.getOracleAssetsPrice(converter, state.tokenA, state.tokenB);

    KyberConverterStrategyLogicLib.emitDisableFuse();
  }

  function changePId(uint pId) external {
    StrategyLib2.onlyOperators(controller());
    require(!state.staked, KyberStrategyErrors.NOT_UNSTAKED);
    state.pId = pId;
  }

  /// @notice Set the fuse threshold for the strategy.
  /// @param newFuseThreshold The new fuse threshold value.
  function setFuseThreshold(uint newFuseThreshold) external {
    StrategyLib2.onlyOperators(controller());
    state.fuseThreshold = newFuseThreshold;

    KyberConverterStrategyLogicLib.emitNewFuseThreshold(newFuseThreshold);
  }

  function setStrategyProfitHolder(address strategyProfitHolder) external {
    StrategyLib2.onlyOperators(controller());
    state.strategyProfitHolder = strategyProfitHolder;
  }

  /////////////////////////////////////////////////////////////////////
  ///                   METRIC VIEWS
  /////////////////////////////////////////////////////////////////////

  /// @notice Check if the strategy needs rebalancing.
  /// @return A boolean indicating if the strategy needs rebalancing.
  function needRebalance() public view returns (bool) {
    (bool needStake, bool needUnstake) = KyberConverterStrategyLogicLib.needRebalanceStaking(state);
    return KyberConverterStrategyLogicLib.needRebalance(state) || needStake || needUnstake;
  }

  /*/// @return swapAtoB, swapAmount
  function quoteRebalanceSwap() external returns (bool, uint) {
    return KyberConverterStrategyLogicLib.quoteRebalanceSwap(state, converter);
  }*/

  function canFarm() external view returns (bool) {
    return !KyberConverterStrategyLogicLib.isFarmEnded(state.pId);
  }

  /// @notice View function required by reader
  function getPoolTokens() external view returns (address tokenA, address tokenB) {
    return (state.tokenA, state.tokenB);
  }

  /////////////////////////////////////////////////////////////////////
  ///                   CALLBACKS
  /////////////////////////////////////////////////////////////////////

  function onERC721Received(
    address,
    address,
    uint256,
    bytes memory
  ) external pure returns (bytes4) {
    return this.onERC721Received.selector;
  }

  /////////////////////////////////////////////////////////////////////
  ///                   REBALANCE
  /////////////////////////////////////////////////////////////////////

  /// @notice Rebalance using borrow/repay only, no swaps
  /// @return True if the fuse was triggered
  /// @param checkNeedRebalance Revert if rebalance is not needed. Pass false to deposit after withdrawByAgg-iterations
  function rebalanceNoSwaps(bool checkNeedRebalance) external returns (bool) {
    (uint profitToCover, uint oldTotalAssets,) = _rebalanceBefore(true, checkNeedRebalance);
    (uint[] memory tokenAmounts, bool fuseEnabledOut) = KyberConverterStrategyLogicLib.rebalanceNoSwaps(
      state,
      converter,
      oldTotalAssets,
      profitToCover,
      baseState.splitter,
      checkNeedRebalance
    );
    _rebalanceAfter(tokenAmounts);
    return fuseEnabledOut;
  }

  function quoteWithdrawByAgg(bytes memory planEntryData) external returns (address tokenToSwap, uint amountToSwap) {
    revert('Not implemented yet');
  }

  function withdrawByAggStep(
    address[2] calldata tokenToSwapAndAggregator,
    uint amountToSwap_,
    bytes memory swapData,
    bytes memory planEntryData,
    uint entryToPool
  ) external returns (bool completed) {
    revert('Not implemented yet');
  }

  function getPropNotUnderlying18() external view returns (uint) {
    revert('Not implemented yet');
  }

  /////////////////////////////////////////////////////////////////////
  ///                   INTERNAL LOGIC
  /////////////////////////////////////////////////////////////////////

  /// @notice Prepare to rebalance: check operator-only, fix price changes, call depositor exit
  function _rebalanceBefore(bool allowExit, bool checkNeedRebalance) internal returns (uint profitToCover, uint oldTotalAssets, address controllerOut) {
    controllerOut = controller();
    StrategyLib2.onlyOperators(controllerOut);

    require(needRebalance() || !checkNeedRebalance, KyberStrategyErrors.NO_REBALANCE_NEEDED);

    (, profitToCover) = _fixPriceChanges(true);
    oldTotalAssets = totalAssets() - profitToCover;

    KyberConverterStrategyLogicLib.claimRewardsBeforeExitIfRequired(state);

    // withdraw all liquidity from pool
    // after disableFuse() liquidity is zero
    if (allowExit && state.totalLiquidity > 0) {
      _depositorEmergencyExit();
    }
  }

  /// @notice Make actions after rebalance: depositor enter, add fillup if necessary, update invested assets
  function _rebalanceAfter(uint[] memory tokenAmounts) internal {
    if (tokenAmounts.length == 2) {
      _depositorEnter(tokenAmounts);
    }

    _updateInvestedAssets();
  }

  /*function _startRebalance() internal returns(uint profitToCover, uint oldTotalAssets,  address _controller) {
    _controller = controller();
    StrategyLib2.onlyOperators(_controller);

    require(needRebalance(), KyberStrategyErrors.NO_REBALANCE_NEEDED);

    (, profitToCover) = _fixPriceChanges(true);
    oldTotalAssets = totalAssets() - profitToCover;

    KyberConverterStrategyLogicLib.claimRewardsBeforeExitIfRequired(state);

    /// withdraw all liquidity from pool with adding calculated fees to rebalanceEarned0, rebalanceEarned1
    /// after disableFuse() liquidity is zero
    if (state.totalLiquidity > 0) {
      _depositorEmergencyExit();
    }
  }*/

  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory /*tokens_*/,
    uint /*indexAsset_*/
  ) override internal virtual returns (
    uint[] memory tokenAmounts
  ) {
    require(!needRebalance(), KyberStrategyErrors.NEED_REBALANCE);

    tokenAmounts = new uint[](2);
    uint spentCollateral;

    bytes memory entryData = KyberConverterStrategyLogicLib.getEntryData(
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
    address asset = baseState.asset;
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    earned = KyberConverterStrategyLogicLib.calcEarned(asset, controller(), rewardTokens, amounts);
    _rewardsLiquidation(rewardTokens, amounts);
    return (earned, lost, AppLib.balance(asset));
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
    require(!needRebalance(), KyberStrategyErrors.NEED_REBALANCE);
  }
}
