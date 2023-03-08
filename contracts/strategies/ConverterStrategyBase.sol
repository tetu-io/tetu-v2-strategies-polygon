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

/////////////////////////////////////////////////////////////////////
///                        TERMS
///  Main asset: the asset deposited to the vault by users
///  Secondary assets: all assets deposited to the internal pool except the main asset
///  Base amounts: not rewards; amounts deposited to vault, amounts deposited after compound
///                Base amounts can be converted one to another
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

  struct ConvertAfterWithdrawLocalParams {
    address asset;
    ITetuConverter tetuConverter;
    ITetuLiquidator liquidator;
    uint collateral;
    uint spentAmountIn;
    uint receivedAmountOut;
    uint liquidationThreshold;
  }

  /////////////////////////////////////////////////////////////////////
  ///                        CONSTANTS
  /////////////////////////////////////////////////////////////////////

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant CONVERTER_STRATEGY_BASE_VERSION = "1.0.0";

  uint private constant REINVEST_THRESHOLD_DENOMINATOR = 100_000;

  /////////////////////////////////////////////////////////////////////
  //                        VARIABLES
  //                Keep names and ordering!
  // Add only in the bottom and don't forget to decrease gap variable
  /////////////////////////////////////////////////////////////////////

  /// @dev Amount of underlying assets invested to the pool.
  uint private _investedAssets;

  /// @dev Linked Tetu Converter
  ITetuConverter public converter;

  /// @notice Minimum token amounts that can be liquidated
  mapping(address => uint) public liquidationThresholds;

  /// @notice Percent of asset amount that can be not invested, it's allowed to just keep it on balance
  ///         decimals = {REINVEST_THRESHOLD_PERCENT_DENOMINATOR}
  /// @dev We need this threshold to avoid numerous conversions of small amounts
  uint public reinvestThresholdPercent;

  /////////////////////////////////////////////////////////////////////
  ///                        Events
  /////////////////////////////////////////////////////////////////////
  event LiquidationThresholdChanged(address token, uint amount);
  event ReinvestThresholdPercentChanged(uint amount);
  event ReturnMainAssetToConverter(uint amount);
  event OnDepositorEnter(uint[] amounts, uint[] consumedAmounts);
  event OnDepositorExit(uint liquidityAmount, uint[] withdrawnAmounts);
  event OnDepositorEmergencyExit(uint[] withdrawnAmounts);

  /// @notice Recycle was made
  /// @param rewardTokens Full list of reward tokens received from tetuConverter and depositor
  /// @param receivedAmounts Received amounts of the tokens
  ///        This array has +1 item at the end: received amount of the main asset
  /// @param spentAmounts Spent amounts of the tokens
  /// @param amountsToForward Amounts to be sent to forwarder
  event Recycle(
    address[] rewardTokens,
    uint[] receivedAmounts,
    uint[] spentAmounts,
    uint[] amountsToForward
  );

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
    converter = ITetuConverter(converter_);
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
  function _depositToPool(uint amount_, bool updateTotalAssetsBeforeInvest_) override internal virtual returns (
    int totalAssetsDelta
  ){
    uint updatedInvestedAssets;
    (updatedInvestedAssets, totalAssetsDelta) = _updateInvestedAssetsAndGetDelta(updateTotalAssetsBeforeInvest_);

    // skip deposit for small amounts
    if (amount_ > reinvestThresholdPercent * updatedInvestedAssets / REINVEST_THRESHOLD_DENOMINATOR) {
      address[] memory tokens = _depositorPoolAssets();
      uint indexAsset = ConverterStrategyBaseLib.getAssetIndex(tokens, asset);

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
  ) internal virtual returns (
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
          "", // fixed collateral amount, max possible borrow amount // todo possibility to customize entry kind
          tokens_[indexAsset_],
          tokens_[i],
          tokenAmounts[i]
        );
        // collateral should be equal to tokenAmounts[i] here because we use default entry kind
        spentCollateral += collateral;

        // zero amount are possible (conversion is not available) but it's not suitable for depositor
        require(borrowedAmounts[i] != 0, AppErrors.ZERO_AMOUNT_BORROWED);
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

  /// @notice Withdraw all from the pool.
  /// @return investedAssetsUSD The value that we should receive after withdrawing
  /// @return assetPrice Price of the {asset} taken from the price oracle
  /// @return totalAssetsDelta The {strategy} updates its totalAssets amount internally before withdrawing
  ///                          Return [totalAssets-before-withdraw - totalAssets-before-call-of-_withdrawFromPool]
  function _withdrawAllFromPool() override internal virtual returns (
    uint investedAssetsUSD,
    uint assetPrice,
    int totalAssetsDelta
  ) {
    uint updatedInvestedAssets;
    (updatedInvestedAssets, totalAssetsDelta) = _updateInvestedAssetsAndGetDelta(true);

    (investedAssetsUSD, assetPrice) = _withdrawUniversal(0, true, updatedInvestedAssets);
  }

  /// @param amount Amount to be withdrawn. 0 is ok if we withdraw all.
  /// @param all Withdraw all
  /// @param investedAssets_ Current amount of invested assets
  /// @return investedAssetsUSD The value that we should receive after withdrawing
  /// @return assetPrice Price of the {asset} taken from the price oracle
  function _withdrawUniversal(uint amount, bool all, uint investedAssets_) internal returns (
    uint investedAssetsUSD,
    uint assetPrice
  ) {
    ConverterStrategyBaseLib.LiquidityAmountRatioInputParams memory vars;

    // _investedAssets value is deprecated, prices can be changed since last update
    // so we need to recalculate _investedAssets
    // to simplify testing, we pass recalculated version as a function param
    vars.investedAssets = investedAssets_;

    if ((all || amount != 0) && vars.investedAssets != 0) {
      vars.tokens = _depositorPoolAssets();
      vars.indexAsset = ConverterStrategyBaseLib.getAssetIndex(vars.tokens, asset);
      vars.converter = converter;
      uint len = vars.tokens.length;

      // temporary save liquidityRatioOut to liquidityAmount
      (uint liquidityAmount, uint[] memory amountsToConvert) = ConverterStrategyBaseLib.getLiquidityAmountRatio(
        all ? 0 : amount,
        baseAmounts,
        address(this),
        vars
      );
      if (liquidityAmount != 0) {
        // liquidityAmount temporary contains ratio...
        liquidityAmount = liquidityAmount * _depositorLiquidity() / 1e18;
      }

      {
        IPriceOracle priceOracle = IPriceOracle(IConverterController(vars.converter.controller()).priceOracle());
        assetPrice = priceOracle.getAssetPrice(vars.tokens[vars.indexAsset]);
      }

      uint[] memory withdrawnAmounts;
      uint expectedAmountMainAsset;
      if (liquidityAmount != 0) {
        uint[] memory expectedWithdrawAmounts = ConverterStrategyBaseLib.getExpectedWithdrawnAmounts(
          _depositorPoolReserves(),
          liquidityAmount,
          _depositorTotalSupply()
        );
        withdrawnAmounts = _depositorExit(liquidityAmount);
        emit OnDepositorExit(liquidityAmount, withdrawnAmounts);

        expectedAmountMainAsset = ConverterStrategyBaseLib.getExpectedAmountMainAsset(
          vars,
          expectedWithdrawAmounts,
          amountsToConvert
        );
        for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
          amountsToConvert[i] += withdrawnAmounts[i];
        }
      } else {
        withdrawnAmounts = new uint[](len);
        // we don't need to withdraw any amounts from the pool, available converted amounts are enough for us
        expectedAmountMainAsset = ConverterStrategyBaseLib.getExpectedAmountMainAsset(
          vars,
          withdrawnAmounts, // array with all zero values
          amountsToConvert
        );
      }

      // convert amounts to main asset and update base amounts
      (uint collateral, uint[] memory repaid) = _convertAfterWithdraw(vars.tokens, vars.indexAsset, amountsToConvert);
      _updateBaseAmounts(vars.tokens, withdrawnAmounts, repaid, vars.indexAsset, int(collateral));

      investedAssetsUSD = expectedAmountMainAsset * assetPrice / 1e18;

      // adjust _investedAssets
      _updateInvestedAssets();
    }

    return (investedAssetsUSD, assetPrice);
  }

  /// @notice If pool supports emergency withdraw need to call it for emergencyExit()
  function _emergencyExitFromPool() override internal virtual {
    uint[] memory withdrawnAmounts = _depositorEmergencyExit();
    emit OnDepositorEmergencyExit(withdrawnAmounts);

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
  /// @dev todo SCB-587
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
    return ConverterStrategyBaseLib.convertAfterWithdraw(
      ConverterStrategyBaseLib.ConvertAfterWithdrawInputParams({
        tetuConverter: converter,
        liquidator: ITetuLiquidator(IController(controller()).liquidator()),
        liquidationThreshold: liquidationThresholds[tokens_[indexAsset_]],
        tokens: tokens_,
        indexAsset: indexAsset_,
        amountsToConvert: amountsToConvert_
     })
    );
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
      uint receivedAmount = receivedAmounts_[i];
      uint spentAmount = spentAmounts_[i];
      if (i == indexAsset_) {
        if (amountAsset_ > 0) {
          receivedAmount += uint(amountAsset_);
        } else {
          spentAmount += uint(-amountAsset_);
        }
      }
      _updateBaseAmountsForAsset(tokens_[i], receivedAmount, spentAmount);
    }
  }

  function _updateBaseAmountsForAsset(address asset_, uint received_, uint spent_) internal {
    if (received_ > spent_) {
      _increaseBaseAmount(asset_, received_ - spent_, _balance(asset_));
    } else if (spent_ > received_) {
      _decreaseBaseAmount(asset_, spent_ - received_);
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
    // get rewards from the Depositor
    (address[] memory depositorRewardTokens, uint[] memory depositorRewardAmounts) = _depositorClaimRewards();

    (address[] memory rewardTokens, uint[] memory amounts) = _prepareRewardsList(
      converter,
      depositorRewardTokens,
      depositorRewardAmounts
    );

    uint len = rewardTokens.length;
    if (len > 0) {
      (uint[] memory received, uint[] memory spent, uint[] memory amountsToForward) = _recycle(rewardTokens, amounts);

      _updateBaseAmounts(rewardTokens, received, spent, type(uint).max, 0); // max - we don't need to exclude any asset
      // received has a length equal to rewardTokens.length + 1
      // last item contains amount of the {asset} received after swapping
      _updateBaseAmountsForAsset(asset, received[len], 0);

      // send forwarder-part of the rewards to the forwarder
      ConverterStrategyBaseLib.sendTokensToForwarder(controller(), splitter, rewardTokens, amountsToForward);
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
    (receivedAmounts, spentAmounts, amountsToForward) = ConverterStrategyBaseLib.recycle(
      asset,
      compoundRatio,
      _depositorPoolAssets(),
      ITetuLiquidator(IController(controller()).liquidator()),
      liquidationThresholds,
      baseAmounts,
      rewardTokens_,
      rewardAmounts_
    );
    emit Recycle(
      rewardTokens_,
      receivedAmounts,
      spentAmounts,
      amountsToForward
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
    uint assetBalanceBefore = _balance(asset);
    _claim();
    uint assetBalanceAfterClaim = _balance(asset);
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
    uint investedAssetsLocal = _updateInvestedAssets();

    _preHardWork(reInvest);

    (earned, lost) = _handleRewards();
    uint assetBalance = _balance(asset);

    // re-invest income
    if (reInvest && assetBalance > reinvestThresholdPercent * investedAssetsLocal / REINVEST_THRESHOLD_DENOMINATOR) {

      uint assetInUseBefore = investedAssetsLocal + assetBalance;
      _depositToPool(assetBalance, false);
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
  /// @dev Should be called after deposit / withdraw / claim; virtual - for ut
  function _updateInvestedAssets() internal returns (uint investedAssetsOut) {
    investedAssetsOut = _calcInvestedAssets();
    _investedAssets = investedAssetsOut;
  }

  /// @notice Calculate amount we will receive when we withdraw all from pool
  /// @dev This is writable function because we need to update current balances in the internal protocols.
  /// @return Invested asset amount under control (in terms of {asset})
  function _calcInvestedAssets() internal returns (uint) {
    uint liquidity = _depositorLiquidity();

    address[] memory tokens = _depositorPoolAssets();
    uint indexAsset = ConverterStrategyBaseLib.getAssetIndex(tokens, asset);

    uint[] memory amountsOut = liquidity == 0
      ? new uint[](tokens.length)
      : _depositorQuoteExit(liquidity);

    return ConverterStrategyBaseLib.calcInvestedAssets(tokens, amountsOut, indexAsset, converter, baseAmounts);
  }

  function calcInvestedAssets() external returns (uint) {
    return _calcInvestedAssets();
  }

  /// @notice Update invested assets and return delta [new-investedAssets - old-investedAssets]
  /// @param updateTotalAssetsBeforeInvest_ If false - skip update, return delta = 0
  function _updateInvestedAssetsAndGetDelta(bool updateTotalAssetsBeforeInvest_) internal returns (
    uint updatedInvestedAssets,
    int totalAssetsDelta
  ) {
    uint __investedAssets = _investedAssets;
    updatedInvestedAssets = updateTotalAssetsBeforeInvest_
      ? _updateInvestedAssets()
      : __investedAssets;
    totalAssetsDelta = updateTotalAssetsBeforeInvest_
      ? int(updatedInvestedAssets) - int(__investedAssets)
      : int(0);
  }

  /////////////////////////////////////////////////////////////////////
  ///               ITetuConverterCallback
  /////////////////////////////////////////////////////////////////////

  /// @notice TetuConverter calls this function health factor is unhealthy and TetuConverter need more tokens to fix it.
  ///         The borrow must send either required collateral-asset amount OR required borrow-asset amount.
  /// @dev The implementation below always sends {collateralAsset_}
  /// @param collateralAsset_ Collateral asset of the borrow to identify the borrow on the borrower's side
  /// @param requiredAmountCollateralAsset_ What amount of collateral asset the Borrower should send to TetuConverter
  /// @return amountOut Exact amount that borrower has sent to balance of TetuConverter
  ///                   It should be equal to either to requiredAmountBorrowAsset_ or to requiredAmountCollateralAsset_
  /// @return isCollateral What is amountOut: true - collateral asset, false - borrow asset
  function requireAmountBack(
    address collateralAsset_,
    uint requiredAmountCollateralAsset_,
    address /*borrowAsset_*/,
    uint /*requiredAmountBorrowAsset_*/
  ) external override returns (
    uint amountOut,
    bool isCollateral
  ) {
    address _converter = address(converter);
    require(msg.sender == _converter, AppErrors.ONLY_TETU_CONVERTER);
    require(collateralAsset_ == asset, AppErrors.WRONG_ASSET);

    amountOut = 0;
    uint assetBalance = _balance(collateralAsset_);

    if (assetBalance >= requiredAmountCollateralAsset_) {
      amountOut = requiredAmountCollateralAsset_;
    } else {
      // we assume if withdraw less amount then requiredAmountCollateralAsset_
      // it will be rebalanced in the next call
      _withdrawFromPool(requiredAmountCollateralAsset_ - assetBalance);
      uint balanceAfterWithdraw = _balance(collateralAsset_);
      amountOut = balanceAfterWithdraw > requiredAmountCollateralAsset_
        ? requiredAmountCollateralAsset_
        : balanceAfterWithdraw;
    }

    IERC20(collateralAsset_).safeTransfer(_converter, amountOut);
    isCollateral = true;
    emit ReturnMainAssetToConverter(amountOut);
  }

  function onTransferBorrowedAmount(
    address /*collateralAsset_*/,
    address /*borrowAsset_*/,
    uint /*amountBorrowAssetSentToBorrower_*/
  ) override pure external {
    // noop; will deposit amount received at the next hardwork
  }


  /////////////////////////////////////////////////////////////////////
  ///                Others
  /////////////////////////////////////////////////////////////////////

  /// @notice Unlimited capacity by default
  function capacity() external virtual view returns (uint) {
    return 2**255; // almost same as type(uint).max but more gas efficient
  }


  /**
* @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
  uint[50] private __gap;

}
