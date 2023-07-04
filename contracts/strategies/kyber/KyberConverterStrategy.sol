// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./KyberDepositor.sol";
import "./KyberConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";
import "../../interfaces/IRebalancingStrategy.sol";
import "../../interfaces/IFarmingStrategy.sol";
import "./KyberStrategyErrors.sol";


contract KyberConverterStrategy is KyberDepositor, ConverterStrategyBase, IRebalancingStrategy, IFarmingStrategy {

  /////////////////////////////////////////////////////////////////////
  ///                CONSTANTS
  /////////////////////////////////////////////////////////////////////

  string public constant override NAME = "Kyber Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.KYBER;
  string public constant override STRATEGY_VERSION = "1.0.1";

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
    strategySpecificName = KyberConverterStrategyLogicLib.createSpecificName(state);
    emit StrategyLib.StrategySpecificNameChanged(strategySpecificName);
  }

  /////////////////////////////////////////////////////////////////////
  ///                OPERATOR ACTIONS
  /////////////////////////////////////////////////////////////////////

  /// @notice Disable fuse for the strategy.
  function disableFuse() external {
    StrategyLib.onlyOperators(controller());
    state.isFuseTriggered = false;
    state.lastPrice = ConverterStrategyBaseLib2.getOracleAssetsPrice(converter, state.tokenA, state.tokenB);

    KyberConverterStrategyLogicLib.emitDisableFuse();
  }

  function changePId(uint pId) external {
    StrategyLib.onlyOperators(controller());
    require(!state.staked, KyberStrategyErrors.NOT_UNSTAKED);
    state.pId = pId;
  }

  /// @notice Set the fuse threshold for the strategy.
  /// @param newFuseThreshold The new fuse threshold value.
  function setFuseThreshold(uint newFuseThreshold) external {
    StrategyLib.onlyOperators(controller());
    state.fuseThreshold = newFuseThreshold;

    KyberConverterStrategyLogicLib.emitNewFuseThreshold(newFuseThreshold);
  }

  function setStrategyProfitHolder(address strategyProfitHolder) external {
    StrategyLib.onlyOperators(controller());
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

  /// @return swapAtoB, swapAmount
  function quoteRebalanceSwap() external returns (bool, uint) {
    return KyberConverterStrategyLogicLib.quoteRebalanceSwap(state, converter);
  }

  function canFarm() external view returns (bool) {
    return !KyberConverterStrategyLogicLib.isFarmEnded(state.pId);
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

  /// @dev The rebalancing functionality is the core of this strategy.
  ///      Swap method is used.
  function rebalance() external {
    (uint profitToCover, uint oldTotalAssets, address _controller) = _startRebalance();

    // _depositorEnter(tokenAmounts) if length == 2
    uint[] memory tokenAmounts = KyberConverterStrategyLogicLib.rebalance(
      state,
      converter,
      _controller,
      oldTotalAssets,
      profitToCover,
      splitter
    );

    if (tokenAmounts.length == 2) {
      _depositorEnter(tokenAmounts);
    }

    //updating investedAssets based on new baseAmounts
    _updateInvestedAssets();
  }

  function rebalanceSwapByAgg(bool direction, uint amount, address agg, bytes memory swapData) external {
    (uint profitToCover, uint oldTotalAssets,) = _startRebalance();

    // _depositorEnter(tokenAmounts) if length == 2
    uint[] memory tokenAmounts = KyberConverterStrategyLogicLib.rebalanceSwapByAgg(
      state,
      converter,
      oldTotalAssets,
      KyberConverterStrategyLogicLib.RebalanceSwapByAggParams(
        direction,
        amount,
        agg,
        swapData
      ),
      profitToCover,
      splitter
    );

    if (tokenAmounts.length == 2) {
      _depositorEnter(tokenAmounts);
    }

    //updating investedAssets based on new baseAmounts
    _updateInvestedAssets();
  }

  /////////////////////////////////////////////////////////////////////
  ///                   INTERNAL LOGIC
  /////////////////////////////////////////////////////////////////////

  function _startRebalance() internal returns(uint profitToCover, uint oldTotalAssets,  address _controller) {
    _controller = controller();
    StrategyLib.onlyOperators(_controller);

    require(needRebalance(), KyberStrategyErrors.NO_REBALANCE_NEEDED);

    (, profitToCover) = _fixPriceChanges(true);
    oldTotalAssets = totalAssets() - profitToCover;

    KyberConverterStrategyLogicLib.claimRewardsBeforeExitIfRequired(state);

    /// withdraw all liquidity from pool with adding calculated fees to rebalanceEarned0, rebalanceEarned1
    /// after disableFuse() liquidity is zero
    if (state.totalLiquidity > 0) {
      _depositorEmergencyExit();
    }
  }

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
    (address[] memory rewardTokens, uint[] memory amounts) = _claim();
    earned = KyberConverterStrategyLogicLib.calcEarned(state.tokenA, controller(), rewardTokens, amounts);
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
