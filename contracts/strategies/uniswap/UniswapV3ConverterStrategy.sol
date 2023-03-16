// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./UniswapV3Depositor.sol";
import "./UniswapV3ConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";

/// @title Delta-neutral liquidity hedging converter fill-up/swap rebalancing strategy for UniswapV3
/// @author a17
contract UniswapV3ConverterStrategy is UniswapV3Depositor, ConverterStrategyBase {
  string public constant override NAME = "UniswapV3 Converter Strategy";
  string public constant override PLATFORM = AppPlatforms.UNIV3;
  string public constant override STRATEGY_VERSION = "1.0.0";

  bool public isFuseTriggered;
  uint public fuseThreshold;
  uint public lastPrice;

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
    IERC20(tokenA).approve(liquidator, type(uint).max);
    IERC20(tokenB).approve(liquidator, type(uint).max);

    if (UniswapV3ConverterStrategyLogicLib.isStablePool(pool)) {
      fuseThreshold = 5e15; // 0.5% price change
      lastPrice = UniswapV3ConverterStrategyLogicLib.getOracleAssetsPrice(converter, tokenA, tokenB);
    }
  }

  function disableFuse() external {
    StrategyLib.onlyOperators(controller());
    isFuseTriggered = false;
  }

  function setFuseThreshold(uint newFuseThreshold) external {
    StrategyLib.onlyOperators(controller());
    fuseThreshold = newFuseThreshold;
  }

  /// @notice Is strategy ready to hard work
  function isReadyToHardWork() override external virtual view returns (bool) {
    // check claimable amounts and compare with thresholds
    (uint fee0, uint fee1) = getFees();
    fee0 += rebalanceEarned0;
    fee1 += rebalanceEarned1;

    if (_depositorSwapTokens) {
      (fee0, fee1) = (fee1, fee0);
    }

    return fee0 > liquidationThresholds[tokenA] || fee1 > liquidationThresholds[tokenB];
  }

  function needRebalance() public view returns (bool) {
    return !isFuseTriggered && UniswapV3ConverterStrategyLogicLib.needRebalance(pool, lowerTick, upperTick, rebalanceTickRange, tickSpacing);
  }

  /// @dev The rebalancing functionality is the core of this strategy.
  ///      Depending on the size of the range of liquidity provided, the Fill-up or Swap method is used.
  ///      There is also an attempt to cover rebalancing losses with rewards.
  function rebalance() external {
    StrategyLib.onlyOperators(controller());
    require(needRebalance(), "No rebalancing needed");

    /// @dev withdraw all liquidity from pool with adding calculated fees to rebalanceEarned0, rebalanceEarned1
    _depositorEmergencyExit();

    /// @dev for ultra-wide ranges we use Swap rebalancing strategy and Fill-up for other
    /// @dev upperTick always greater then lowerTick
    bool fillUp = upperTick - lowerTick >= 4 * tickSpacing;

    /// @dev for stable pools fuse can be enabled
    bool isStablePool = UniswapV3ConverterStrategyLogicLib.isStablePool(pool);

    uint newPrice = UniswapV3ConverterStrategyLogicLib.getOracleAssetsPrice(converter, tokenA, tokenB);

    if (isStablePool && UniswapV3ConverterStrategyLogicLib.enableFuse(lastPrice, newPrice, fuseThreshold)) {
      /// @dev enabling fuse: close debt and stop providing liquidity
      isFuseTriggered = true;

      UniswapV3ConverterStrategyLogicLib.closeDebt(
        converter,
        controller(),
        pool,
        tokenA,
        tokenB,
        _depositorSwapTokens,
        rebalanceEarned0,
        rebalanceEarned1
      );
    } else {
      if (isStablePool) {
        lastPrice = newPrice;
      }

      /// @dev rebalacing debt with passing rebalanceEarned0, rebalanceEarned1 that will remain untouched
      UniswapV3ConverterStrategyLogicLib.rebalanceDebt(
        converter,
        controller(),
        pool,
        tokenA,
        tokenB,
        fillUp,
        lowerTick,
        upperTick,
        tickSpacing,
        _depositorSwapTokens,
        rebalanceEarned0,
        rebalanceEarned1
      );

      /// @dev trying to cover rebalance loss (IL + not hedged part of tokenB + swap cost) by pool rewards
      uint notCoveredLoss;
      (rebalanceEarned0, rebalanceEarned1, notCoveredLoss) = UniswapV3ConverterStrategyLogicLib.tryToCoverLoss(
        UniswapV3ConverterStrategyLogicLib.TryCoverLossParams(
          converter,
          controller(),
          pool,
          tokenA,
          tokenB,
          _depositorSwapTokens,
          rebalanceEarned0,
          rebalanceEarned1,
          investedAssets(),
          tickSpacing,
          lowerTick,
          upperTick
        )
      );

      if (notCoveredLoss > 0) {
        rebalanceLost += notCoveredLoss;
      }

      // calculate and set new tick range
      _setNewTickRange();

      //put liquidity to pool without updated rebalanceEarned0, rebalanceEarned1 amounts
      uint[] memory tokenAmounts = new uint[](2);
      tokenAmounts[0] = _balance(tokenA) - (_depositorSwapTokens ? rebalanceEarned1 : rebalanceEarned0);
      tokenAmounts[1] = _balance(tokenB) - (_depositorSwapTokens ? rebalanceEarned0 : rebalanceEarned1);
      _depositorEnter(tokenAmounts);

      //add fill-up liquidity part of fill-up is used
      if (fillUp) {
        (lowerTickFillup, upperTickFillup, totalLiquidityFillup) = UniswapV3ConverterStrategyLogicLib.addFillup(pool, lowerTick, upperTick, tickSpacing, rebalanceEarned0, rebalanceEarned1);
      }
    }

    //updating baseAmounts (token amounts on strategy balance which are not rewards)
    uint balanceOfTokenABefore = baseAmounts[tokenA];
    uint balanceOfTokenBBefore = baseAmounts[tokenB];
    uint balanceOfTokenAAfter = _balance(tokenA) - (_depositorSwapTokens ? rebalanceEarned1 : rebalanceEarned0);
    uint balanceOfTokenBAfter = _balance(tokenB) - (_depositorSwapTokens ? rebalanceEarned0 : rebalanceEarned1);
    _updateBaseAmountsForAsset(
      tokenA,
      balanceOfTokenABefore > balanceOfTokenAAfter ? 0 : balanceOfTokenAAfter - balanceOfTokenABefore,
      balanceOfTokenABefore > balanceOfTokenAAfter ? balanceOfTokenABefore - balanceOfTokenAAfter : 0
    );
    _updateBaseAmountsForAsset(
      tokenB,
      balanceOfTokenBBefore > balanceOfTokenBAfter ? 0 : balanceOfTokenBAfter - balanceOfTokenBBefore,
      balanceOfTokenBBefore > balanceOfTokenBAfter ? balanceOfTokenBBefore - balanceOfTokenBAfter : 0
    );

    //updating investedAssets based on new baseAmounts
    _updateInvestedAssets();
  }

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

    bytes memory entryData = UniswapV3ConverterStrategyLogicLib.getEntryData(pool, lowerTick, upperTick, tickSpacing, _depositorSwapTokens);

    AppLib.approveIfNeeded(tokenA, amount_, address(tetuConverter_));
    (spentCollateral, borrowedAmounts[1]) = ConverterStrategyBaseLib.openPosition(
      tetuConverter_,
      entryData,
      tokenA,
      tokenB,
      amount_,
      0
    );

    tokenAmounts[0] = amount_ - spentCollateral;
    tokenAmounts[1] = borrowedAmounts[1];

    return (tokenAmounts, borrowedAmounts, spentCollateral);
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  function _handleRewards() override internal virtual returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    uint assetBalanceBefore = _balance(asset);
    _claim();
    assetBalanceAfterClaim = _balance(asset);
    if (rebalanceLost > 0) {
      lost = rebalanceLost;
      rebalanceLost = 0;
    }
    (earned, lost) = ConverterStrategyBaseLib.registerIncome(assetBalanceBefore, _balance(asset), earned, lost);
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

    if (isFuseTriggered) {
      assetPrice = ConverterStrategyBaseLib.getAssetPriceFromConverter(converter, tokenA);
      if (amount != 0) {
        _updateBaseAmountsForAsset(tokenA, 0, amount);
        _updateInvestedAssets();
        investedAssetsUSD = amount * assetPrice / 1e18;
      } else {
        // hide warning
        investedAssetsUSD = 0;
      }
    } else {
      (investedAssetsUSD, assetPrice) = _withdrawUniversal(amount, false, updatedInvestedAssets);
    }
  }

  /// @notice Deposit given amount to the pool.
  function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
    int totalAssetsDelta
  ) {
    uint updatedInvestedAssets;
    (updatedInvestedAssets, totalAssetsDelta) = _updateInvestedAssetsAndGetDelta(updateTotalAssetsBeforeInvest_);

    // skip deposit for small amounts
    if (amount_ > reinvestThresholdPercent * updatedInvestedAssets / 100_000/*REINVEST_THRESHOLD_DENOMINATOR*/) {
      if (isFuseTriggered) {
        uint[] memory tokenAmounts = new uint[](2);
        tokenAmounts[0] = amount_;
        emit OnDepositorEnter(tokenAmounts, tokenAmounts);
        _updateBaseAmountsForAsset(tokenA, amount_, 0);
      } else {
        (address[] memory tokens, uint indexAsset) = _getTokens();

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
