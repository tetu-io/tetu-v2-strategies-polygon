// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IController.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyBaseV2.sol";
import "../interfaces/converter/ITetuConverter.sol";
import "../interfaces/converter/ITetuConverterCallback.sol";
import "../interfaces/converter/IPriceOracle.sol";
import "../interfaces/converter/IConverterController.sol";
import "../tools/TokenAmountsLib.sol";
import "../tools/AppLib.sol";
import "./ConverterStrategyBaseLib.sol";
import "./DepositorBase.sol";

import "hardhat/console.sol";

/////////////////////////////////////////////////////////////////////
///                        TERMS
///  Main asset: the asset deposited to the vault by users
///  Secondary assets: all assets deposited to the internal pool except the main asset
///  Base amounts: not rewards; amounts deposited to vault, amounts deposited after compound
///                Base amounts can be converter one to another
/////////////////////////////////////////////////////////////////////

/// @title Abstract contract for base Converter strategy functionality
/// @notice All depositor assets must be correlated (ie USDC/USDT/DAI)
/// @author bogdoslav, dvpublic
abstract contract ConverterStrategyBase is ITetuConverterCallback, DepositorBase, StrategyBaseV2 {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  ///                        DATA TYPES
  /////////////////////////////////////////////////////////////////////
  /// @notice Local vars for {_recycle}, workaround for stack too deep
  struct RecycleLocalParams {
    address asset;
    uint compoundRatio;
    IForwarder forwarder;
    uint[] amountsToForward;
    uint liquidationThreshold;
    uint amountToCompound;
    uint amountToForward;
    address rewardToken;
    address[] tokens;
  }

  /////////////////////////////////////////////////////////////////////
  ///                        CONSTANTS
  /////////////////////////////////////////////////////////////////////

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant CONVERTER_STRATEGY_BASE_VERSION = "1.0.0";

  uint private constant _ASSET_LIQUIDATION_SLIPPAGE = 500; // 0.5%

  uint private constant REINVEST_THRESHOLD_DENOMINATOR = 100_000;

  /////////////////////////////////////////////////////////////////////
  //                        VARIABLES
  //                Keep names and ordering!
  // Add only in the bottom and don't forget to decrease gap variable
  /////////////////////////////////////////////////////////////////////

  /// @dev Amount of underlying assets invested to the pool.
  uint private _investedAssets;

  /// @dev Linked Tetu Converter
  ITetuConverter public tetuConverter;

  /// @notice Minimum token amounts that can be liquidated
  mapping(address => uint) public liquidationThresholds;

  /// @notice Percent of asset amount that can be not invested, it's allowed to just keep it on balance
  ///         decimals = {REINVEST_THRESHOLD_PERCENT_DENOMINATOR}
  /// @dev We need this threshold to avoid numerous conversions of small amounts
  uint public reinvestThresholdPercent;

  event LiquidationThresholdChanged(address token, uint amount);
  event ReinvestThresholdPercentChanged(uint amount);

  /////////////////////////////////////////////////////////////////////
  //                Initialization and configuration
  /////////////////////////////////////////////////////////////////////

  /// @notice Initialize contract after setup it as proxy implementation
  function __ConverterStrategyBase_init(
    address controller_,
    address splitter_,
    address converter_
  ) internal onlyInitializing {
    __StrategyBase_init(controller_, splitter_);
    tetuConverter = ITetuConverter(converter_);
  }

  function setLiquidationThreshold(address token, uint amount) external {
    _onlyOperators();
    liquidationThresholds[token] = amount;
    emit LiquidationThresholdChanged(token, amount);
  }

  /// @param percent_ New value of the percent, decimals = {REINVEST_THRESHOLD_PERCENT_DENOMINATOR}
  function setReinvestThresholdPercent(uint percent_) external {
    _onlyOperators();
    require(percent_ <= REINVEST_THRESHOLD_DENOMINATOR, AppErrors.WRONG_VALUE);

    reinvestThresholdPercent = percent_;
    emit ReinvestThresholdPercentChanged(percent_);
  }

  /////////////////////////////////////////////////////////////////////
  ///                     Deposit to the pool
  /////////////////////////////////////////////////////////////////////

  /// @notice Amount of underlying assets converted to pool assets and invested to the pool.
  function investedAssets() override public view virtual returns (uint) {
    return _investedAssets;
  }

  /// @notice Deposit given amount to the pool.
  function _depositToPool(uint amount_) override internal virtual {
    // skip deposit for small amounts
    if (amount_ > reinvestThresholdPercent * _investedAssets / REINVEST_THRESHOLD_DENOMINATOR) {
      address[] memory tokens = _depositorPoolAssets();
      uint indexAsset = ConverterStrategyBaseLib.getAssetIndex(tokens, asset);

      // prepare array of amounts ready to deposit, borrow missed amounts
      (uint[] memory amounts, uint[] memory borrowedAmounts, uint collateral) = _beforeDeposit(
        tetuConverter,
        amount_,
        tokens,
        indexAsset
      );

      // make deposit, actually consumed amounts can be different from the desired amounts
      (uint[] memory consumedAmounts,) = _depositorEnter(amounts);

      // adjust base-amounts
      _updateBaseAmounts(tokens, borrowedAmounts, consumedAmounts, indexAsset, -int(collateral));

      // adjust _investedAssets
      _updateInvestedAssets();
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///               Convert amounts before deposit
  /////////////////////////////////////////////////////////////////////

  /// @notice Prepare {tokenAmounts} to be passed to depositorEnter
  /// @param amount_ The amount of main asset that should be invested
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @return tokenAmounts Amounts of depositor's assets ready to invest (this array can be passed to depositorEnter)
  /// @return borrowedAmounts Amounts that were borrowed to prepare {tokenAmounts}
  /// @return spentCollateral Total collateral spent to get {borrowedAmounts}
  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory tokens_,
    uint indexAsset_
  ) internal returns (
    uint[] memory tokenAmounts,
    uint[] memory borrowedAmounts,
    uint spentCollateral
  ) {
    // calculate required collaterals for each token and temporary save them to tokenAmounts
    // save to tokenAmounts[indexAsset_] already correct value
    (uint[] memory weights, uint totalWeight) = _depositorPoolWeights();
    tokenAmounts = ConverterStrategyBaseLib.getCollaterals(
      amount_,
      tokens_,
      weights,
      totalWeight,
      indexAsset_,
      IPriceOracle(IConverterController(tetuConverter_.controller()).priceOracle())
    );

    // make borrow and save amounts of tokens available for deposit to tokenAmounts
    // total collateral amount spent for borrowing
    uint len = tokens_.length;
    borrowedAmounts = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset_) continue;

      if (tokenAmounts[i] > 0) {
        uint collateral;
        AppLib.approveIfNeeded(tokens_[indexAsset_], tokenAmounts[i], address(tetuConverter_));
        (collateral, borrowedAmounts[i]) = ConverterStrategyBaseLib.openPosition(
          tetuConverter_,
          "", // fixed collateral amount, max possible borrow amount
          tokens_[indexAsset_],
          tokens_[i],
          tokenAmounts[i]
        );
        // collateral should be equal to tokenAmounts[i] here because we use default entry kind
        spentCollateral += collateral;
      }
      tokenAmounts[i] = IERC20(tokens_[i]).balanceOf(address(this));
    }

    return (tokenAmounts, borrowedAmounts, spentCollateral);
  }

  /////////////////////////////////////////////////////////////////////
  ///                     Withdraw from the pool
  /////////////////////////////////////////////////////////////////////

  /// @notice Withdraw given amount from the pool.
  /// @param amount Amount to be withdrawn in terms of the asset.
  /// @return investedAssetsUSD The value that we should receive after withdrawing (in USD, decimals of the {asset})
  /// @return assetPrice Price of the {asset} from the price oracle
  function _withdrawFromPool(uint amount) override internal virtual returns (uint investedAssetsUSD, uint assetPrice) {
    require(_investedAssets != 0, "CSB: no investments");
    return _withdrawUniversal(amount, false);
  }

  /// @notice Withdraw all from the pool.
  /// @return investedAssetsUSD The value that we should receive after withdrawing
  /// @return assetPrice Price of the {asset} taken from the price oracle
  function _withdrawAllFromPool() override internal virtual returns (uint investedAssetsUSD, uint assetPrice) {
    return _withdrawUniversal(0, true);
  }

  function _withdrawUniversal(uint amount, bool all) internal returns (uint investedAssetsUSD, uint assetPrice) {
    uint liquidityAmount = all
      ? _depositorLiquidity()  // total amount of LP-tokens deposited by the strategy
      : amount == 0 || _investedAssets == 0
        ? 0
        : _depositorLiquidity()
          * 101 // add 1% on top...
          * amount / _investedAssets // a part of amount that we are going to withdraw
          / 100; // .. add 1% on top

    if (liquidityAmount != 0) {
      address[] memory tokens = _depositorPoolAssets();
      uint indexAsset = ConverterStrategyBaseLib.getAssetIndex(tokens, asset);

      (investedAssetsUSD, assetPrice) = ConverterStrategyBaseLib.getExpectedWithdrawnAmountUSD(
        tokens,
        _depositorPoolReserves(),
        asset,
        liquidityAmount,
        _depositorTotalSupply(),
        IPriceOracle(IConverterController(tetuConverter.controller()).priceOracle())
      );
      uint[] memory withdrawnAmounts = _depositorExit(liquidityAmount);

      // convert amounts to main asset and update base amounts
      (uint collateral, uint[] memory repaid) = all
        ? _convertAfterWithdrawAll(tokens, indexAsset)
        : _convertAfterWithdraw(tokens, indexAsset, withdrawnAmounts);
      _updateBaseAmounts(tokens, withdrawnAmounts, repaid, indexAsset, int(collateral));

      // we cannot predict collateral amount that is returned after closing position, so we use actual collateral value
      investedAssetsUSD += collateral * assetPrice / 1e18;

      // adjust _investedAssets
      _updateInvestedAssets();
    }

    return (investedAssetsUSD, assetPrice);
  }

  /// @notice If pool support emergency withdraw need to call it for emergencyExit()
  function _emergencyExitFromPool() override internal virtual {
    uint[] memory withdrawnAmounts = _depositorEmergencyExit();

    address[] memory tokens = _depositorPoolAssets();
    uint indexAsset = ConverterStrategyBaseLib.getAssetIndex(tokens, asset);

    // convert amounts to main asset and update base amounts
    (uint collateral, uint[] memory repaid) = _convertAfterWithdrawAll(tokens, indexAsset);
    _updateBaseAmounts(tokens, withdrawnAmounts, repaid, indexAsset, int(collateral));

    // adjust _investedAssets
    _updateInvestedAssets();
  }

  /////////////////////////////////////////////////////////////////////
  ///               Convert amounts after withdraw
  /////////////////////////////////////////////////////////////////////

  /// @notice Convert all available amounts of {tokens_} to the main {asset}
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @return collateralOut Total amount of collateral returned after closing positions
  /// @return repaidAmounts What amounts were spent in exchange of the {collateralOut}
  function _convertAfterWithdrawAll(address[] memory tokens_, uint indexAsset_) internal returns (
    uint collateralOut,
    uint[] memory repaidAmounts
  ){
    uint[] memory amountsToConvert = ConverterStrategyBaseLib.getAvailableBalances(tokens_, indexAsset_);

    // convert amounts to the main asset
    (collateralOut, repaidAmounts) = _convertAfterWithdraw(tokens_, indexAsset_, amountsToConvert);
  }

  /// @notice Convert {amountsToConvert_} to the main {asset}
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @return collateralOut Total amount of collateral returned after closing positions
  /// @return repaidAmountsOut What amounts were spent in exchange of the {collateralOut}
  function _convertAfterWithdraw(
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory amountsToConvert_
  ) internal returns (
    uint collateralOut,
    uint[] memory repaidAmountsOut
  ) {
    address _asset = tokens_[indexAsset_];
    uint len = tokens_.length;
    repaidAmountsOut = new uint[](len);
    {
      ITetuConverter _tetuConverter = tetuConverter; // gas saving
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        if (i == indexAsset_) continue;
        uint collateral;
        (collateral, repaidAmountsOut[i]) = ConverterStrategyBaseLib.closePosition(
          _tetuConverter,
          _asset,
          tokens_[i],
          amountsToConvert_[i]
        );
        collateralOut += collateral;
      }
    }

    { // Manually swap remain leftovers
      ITetuLiquidator liquidator = ITetuLiquidator(IController(controller()).liquidator());
      uint liquidationThreshold = liquidationThresholds[_asset];
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        if (i == indexAsset_) continue;
        if (amountsToConvert_[i] > repaidAmountsOut[i]) {
          (uint spentAmountIn, uint receivedAmountOut) = ConverterStrategyBaseLib.liquidate(
            liquidator,
            tokens_[i],
            _asset,
            amountsToConvert_[i] - repaidAmountsOut[i],
            _ASSET_LIQUIDATION_SLIPPAGE,
            liquidationThreshold
          );
          if (receivedAmountOut != 0) {
            collateralOut += receivedAmountOut;
          }
          if (spentAmountIn != 0) {
            repaidAmountsOut[i] += spentAmountIn;
          }
        }
      }
    }

    return (collateralOut, repaidAmountsOut);
  }

  /////////////////////////////////////////////////////////////////////
  ///                 Update base amounts
  /////////////////////////////////////////////////////////////////////

  /// @notice Update base amounts after withdraw
  /// @param receivedAmounts_ Received amounts of not main-asset
  /// @param spentAmounts_ Spent amounts of not main-asset
  /// @param indexAsset_ Index of the asset in {tokens_} with different update logic (using {amountAsset_})
  /// @param amountAsset_ Base amount of the asset with index indexAsset_ should be adjusted to {amountAsset_}
  function _updateBaseAmounts(
    address[] memory tokens_,
    uint[] memory receivedAmounts_,
    uint[] memory spentAmounts_,
    uint indexAsset_,
    int amountAsset_
  ) internal {
    uint len = tokens_.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset_) {
        uint receivedAmount = receivedAmounts_[i];
        uint spentAmount = spentAmounts_[i];
        if (amountAsset_ > 0) {
          receivedAmount += uint(amountAsset_);
        } else {
          spentAmount += uint(-amountAsset_);
        }

        _updateBaseAmountsForAsset(
          tokens_[indexAsset_],
          receivedAmount > spentAmount
            ? receivedAmount - spentAmount
            : spentAmount - receivedAmount,
          receivedAmount > spentAmount
        );
      } else {
        _updateBaseAmountsForAsset(
          tokens_[i],
          receivedAmounts_[i] > spentAmounts_[i]
            ? receivedAmounts_[i] - spentAmounts_[i]
            : spentAmounts_[i] - receivedAmounts_[i],
          receivedAmounts_[i] > spentAmounts_[i]
        );
      }
    }
  }

  function _updateBaseAmountsForAsset(address asset_, uint amount_, bool increased_) internal {
    if (amount_ != 0) {
      if (increased_) {
        _increaseBaseAmount(asset_, amount_, _balance(asset_));
      } else {
        _decreaseBaseAmount(asset_, amount_);
      }
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                 Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @notice Claim rewards from tetuConverter, generate result list of all available rewards
  /// @dev The post-processing is rewards conversion to the main asset
  /// @param tokens_ List of rewards claimed from the internal pool
  /// @param amounts_ Amounts of rewards claimed from the internal pool
  /// @param tokensOut List of available rewards - not zero amounts, reward tokens don't repeat
  /// @param amountsOut Amounts of available rewards
  function _prepareRewardsList(
    ITetuConverter tetuConverter_,
    address[] memory tokens_,
    uint[] memory amounts_
  ) internal returns(
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    // Rewards from TetuConverter
    (address[] memory tokens2, uint[] memory amounts2) = tetuConverter_.claimRewards(address(this));

    // Join arrays and recycle tokens
    (tokensOut, amountsOut) = TokenAmountsLib.unite(tokens_, amounts_, tokens2, amounts2);

    // {amounts} contain just received values, but probably we already had some tokens on balance
    uint len = tokensOut.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      amountsOut[i] = IERC20(tokensOut[i]).balanceOf(address(this)) - baseAmounts[tokensOut[i]];
    }
  }

  /// @notice Claim all possible rewards.
  function _claim() override internal virtual {
    console.log("_claim.1");
    // get rewards from the Depositor
    (address[] memory depositorRewardTokens, uint[] memory depositorRewardAmounts) = _depositorClaimRewards();
    console.log("_claim.2");

    (address[] memory rewardTokens, uint[] memory amounts) = _prepareRewardsList(
      tetuConverter,
      depositorRewardTokens,
      depositorRewardAmounts
    );
    console.log("_claim.3");

    uint len = rewardTokens.length;
    if (len > 0) {
      (uint[] memory received, uint[] memory spent, uint[] memory amountsToForward) = _recycle(rewardTokens, amounts);
      console.log("_claim.4");

      _updateBaseAmounts(rewardTokens, received, spent, type(uint).max, 0); // max - we don't need to exclude any asset
      // received has a length equal to rewardTokens.length + 1
      // last item contains amount of the {asset} received after swapping
      _updateBaseAmountsForAsset(asset, received[len], true);
      console.log("_claim.5");

      // send forwarder-part of the rewards to the forwarder
      IForwarder forwarder = IForwarder(IController(controller()).forwarder());
      for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
        AppLib.approveIfNeeded(rewardTokens[i], amountsToForward[i], address(forwarder));
      }
      console.log("_claim.6");

    forwarder.registerIncome(rewardTokens, amountsToForward, ISplitter(splitter).vault(), true);
      console.log("_claim.7");
    }
  }

  /// @notice Recycle the amounts: liquidate a part of each amount, send the other part to the forwarder.
  /// We have two kinds of rewards:
  /// 1) rewards in depositor's assets (the assets returned by _depositorPoolAssets)
  /// 2) any other rewards
  /// All received rewards divided on two parts: to forwarder, to compound
  ///   Compound-part of Rewards-2 can be liquidated
  ///   Compound part of Rewards-1 should be just added to baseAmounts
  /// All forwarder-parts are returned in amountsToForward and should be transferred to the forwarder.
  /// @dev {_recycle} is implemented as separate (inline) function to simplify unit testing
  /// @param rewardTokens_ Full list of reward tokens received from tetuConverter and depositor
  /// @param rewardAmounts_ Amounts of {rewardTokens_}; we assume, there are no zero amounts here
  /// @return receivedAmounts Received amounts of the tokens
  ///         This array has +1 item at the end: received amount of the main asset
  ///                                            there was no possibility to use separate var for it, stack too deep
  /// @return spentAmounts Spent amounts of the tokens
  /// @return amountsToForward Amounts to be sent to forwarder
  function _recycle(address[] memory rewardTokens_, uint[] memory rewardAmounts_) internal returns (
    uint[] memory receivedAmounts,
    uint[] memory spentAmounts,
    uint[] memory amountsToForward
  ) {
    return ConverterStrategyBaseLib.recycle(
      asset,
      compoundRatio,
      _depositorPoolAssets(),
      ITetuLiquidator(IController(controller()).liquidator()),
      liquidationThresholds,
      baseAmounts,
      rewardTokens_,
      rewardAmounts_
    );
  }

  /////////////////////////////////////////////////////////////////////
  ///                   Hardwork
  /////////////////////////////////////////////////////////////////////

  /// @notice A virtual handler to make any action before hardwork
  function _preHardWork(bool reInvest) internal virtual {}

  /// @notice A virtual handler to make any action after hardwork
  function _postHardWork() internal virtual {}

  /// @notice Is strategy ready to hard work
  function isReadyToHardWork() override external virtual view returns (bool) {
    // check claimable amounts and compare with thresholds
    return true;
  }

  /// @notice Do hard work
  function doHardWork() override public returns (uint, uint) {
    return _doHardWork(true);
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  function _handleRewards() internal virtual returns (uint earned, uint lost) {
    console.log("_handleRewards.1");
    uint assetBalanceBefore = _balance(asset);
    _claim();
    uint assetBalanceAfterClaim = _balance(asset);
    console.log("_handleRewards.2");
    if (assetBalanceAfterClaim > assetBalanceBefore) {
      earned = assetBalanceAfterClaim - assetBalanceBefore;
    } else {
      lost = assetBalanceBefore - assetBalanceAfterClaim;
    }

    return (earned, lost);
  }

  /// @return earned Earned amount in terms of {asset}
  /// @return lost Lost amount in terms of {asset}
  function _doHardWork(bool reInvest) internal returns (uint earned, uint lost) {
    console.log("_doHardWork.1");
    _preHardWork(reInvest);

    (earned, lost) = _handleRewards();
    uint assetBalance = _balance(asset);
    console.log("_doHardWork.2");

    // re-invest income
    if (reInvest && assetBalance > reinvestThresholdPercent * _investedAssets / REINVEST_THRESHOLD_DENOMINATOR) {
      console.log("_doHardWork.3");

      uint assetInUseBefore = _investedAssets + assetBalance;
      _depositToPool(assetBalance);
      uint assetInUseAfter = _investedAssets + _balance(asset);

      if (assetInUseAfter > assetInUseBefore) {
        earned += assetInUseAfter - assetInUseBefore;
      } else {
        lost += assetInUseBefore - assetInUseAfter;
      }
    }

    _postHardWork();
  }


  /////////////////////////////////////////////////////////////////////
  ///               InvestedAssets Calculations
  /////////////////////////////////////////////////////////////////////

  /// @notice Updates cached _investedAssets to actual value
  /// @dev Should be called after deposit / withdraw / claim
  function _updateInvestedAssets() internal {
    _investedAssets = calcInvestedAssets();
  }

  /// @notice Calculate amount we will receive when we withdraw all from pool
  /// @dev This is writable function because quoteRepay is writable (it updates current balances in the internal pools)
  /// @return estimatedAssets Invested asset amount under control (in terms of {asset})
  function calcInvestedAssets() public returns (uint estimatedAssets) {
    uint liquidity = _depositorLiquidity();
    if (liquidity != 0) {
      uint[] memory amountsOut = _depositorQuoteExit(liquidity);
      address[] memory tokens = _depositorPoolAssets();

      address _asset = asset;

      uint len = tokens.length;
      for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
        address borrowedToken = tokens[i];
        estimatedAssets += _asset == borrowedToken
          ? amountsOut[i]
          : tetuConverter.quoteRepay(address(this), _asset, borrowedToken, _balance(borrowedToken) + amountsOut[i]);
      }
    }

    return estimatedAssets;
  }

  /////////////////////////////////////////////////////////////////////
  ///               ITetuConverterCallback
  /////////////////////////////////////////////////////////////////////

  function requireAmountBack(
    address collateralAsset_,
    uint requiredAmountCollateralAsset_,
    address /*borrowAsset_*/,
    uint /*requiredAmountBorrowAsset_*/
  ) external override returns (
    uint amountOut,
    bool isCollateral
  ) {
    address _tetuConverter = address(tetuConverter);
    require(msg.sender == _tetuConverter, "CSB: Only TetuConverter");
    require(collateralAsset_ == asset, 'CSB: Wrong asset');

    amountOut = 0;
    uint assetBalance = _balance(collateralAsset_);

    if (assetBalance >= requiredAmountCollateralAsset_) {
      amountOut = requiredAmountCollateralAsset_;

    } else {
      // we assume if withdraw less amount then requiredAmountCollateralAsset_
      // it will be rebalanced in the next call
      _withdrawFromPool(requiredAmountCollateralAsset_ - assetBalance);
      amountOut = _balance(collateralAsset_);
    }

    IERC20(collateralAsset_).safeTransfer(_tetuConverter, amountOut);
    isCollateral = true;
  }

  function onTransferBorrowedAmount(
    address /*collateralAsset_*/,
    address /*borrowAsset_*/,
    uint /*amountBorrowAssetSentToBorrower_*/
  ) override pure external {
    // noop; will deposit amount received at the next hardwork
  }



  /**
* @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
  uint[50] private __gap;

}
