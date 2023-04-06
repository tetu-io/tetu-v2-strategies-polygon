// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyBaseV2.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverterCallback.sol";
import "./ConverterStrategyBaseLib.sol";
import "./ConverterStrategyBaseLib2.sol";
import "./DepositorBase.sol";

/////////////////////////////////////////////////////////////////////
///                        TERMS
///  Main asset == underlying: the asset deposited to the vault by users
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

  struct WithdrawUniversalLocal {
    uint[] reserves;
    uint totalSupply;
    uint depositorLiquidity;
    uint liquidityAmount;
    uint assetPrice;
    uint[] amountsToConvert;
  }

  struct RequirePayAmountBackLocal {
    uint len;
    address converter;
    address[] tokens;
    uint indexTheAsset;
    uint balance;
    uint[] withdrawnAmounts;
    uint[] spentAmounts;
    uint liquidity;
  }

  /////////////////////////////////////////////////////////////////////
  ///                        CONSTANTS
  /////////////////////////////////////////////////////////////////////

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant CONVERTER_STRATEGY_BASE_VERSION = "1.1.0";

  uint internal constant REINVEST_THRESHOLD_DENOMINATOR = 100_000;

  /////////////////////////////////////////////////////////////////////
  //                        VARIABLES
  //                Keep names and ordering!
  // Add only in the bottom and don't forget to decrease gap variable
  /////////////////////////////////////////////////////////////////////

  /// @dev Amount of underlying assets invested to the pool.
  uint internal _investedAssets;

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
  event ReturnAssetToConverter(address asset, uint amount);
  event OnDepositorEnter(uint[] amounts, uint[] consumedAmounts);
  event OnDepositorExit(uint liquidityAmount, uint[] withdrawnAmounts);
  event OnDepositorEmergencyExit(uint[] withdrawnAmounts);

  /// @notice Recycle was made
  /// @param rewardTokens Full list of reward tokens received from tetuConverter and depositor
  /// @param amountsToForward Amounts to be sent to forwarder
  event Recycle(
    address[] rewardTokens,
    uint[] amountsToForward,
    uint[] performanceAmounts
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

    // 1% by default
    reinvestThresholdPercent = REINVEST_THRESHOLD_DENOMINATOR / 100;
    emit ReinvestThresholdPercentChanged(REINVEST_THRESHOLD_DENOMINATOR / 100);
  }

  function setLiquidationThreshold(address token, uint amount) external {
    StrategyLib.onlyOperators(controller());
    liquidationThresholds[token] = amount;
    emit LiquidationThresholdChanged(token, amount);
  }

  /// @param percent_ New value of the percent, decimals = {REINVEST_THRESHOLD_PERCENT_DENOMINATOR}
  function setReinvestThresholdPercent(uint percent_) external {
    StrategyLib.onlyOperators(controller());
    require(percent_ <= REINVEST_THRESHOLD_DENOMINATOR, StrategyLib.WRONG_VALUE);

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
    uint strategyLoss
  ){
    uint updatedInvestedAssets;
    // we need to compensate difference between last updated invested assets and the current value for do not allow share price fluctuation
    (updatedInvestedAssets, strategyLoss) = _updateInvestedAssetsAndGetLoss(updateTotalAssetsBeforeInvest_);
    // skip deposit for small amounts
    if (amount_ > reinvestThresholdPercent * updatedInvestedAssets / REINVEST_THRESHOLD_DENOMINATOR) {
      address _asset = asset;
      uint balanceBefore = _balance(_asset);
      (address[] memory tokens, uint indexAsset) = _getTokens(asset);

      // prepare array of amounts ready to deposit, borrow missed amounts
      uint[] memory amounts = _beforeDeposit(
        converter,
        amount_,
        tokens,
        indexAsset
      );

      // make deposit, actually consumed amounts can be different from the desired amounts
      (uint[] memory consumedAmounts,) = _depositorEnter(amounts);
      emit OnDepositorEnter(amounts, consumedAmounts);

      // update _investedAssets with new deposited amount
      uint updatedInvestedAssetsAfterDeposit = _updateInvestedAssets();
      // after deposit some asset can exist
      uint balanceAfter = _balance(_asset);

      // we need to compensate difference if during deposit we lost some assets
      if ((updatedInvestedAssetsAfterDeposit + balanceAfter) < (updatedInvestedAssets + balanceBefore)) {
        strategyLoss += (updatedInvestedAssets + balanceBefore) - (updatedInvestedAssetsAfterDeposit + balanceAfter);
      }
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///               Convert amounts before deposit
  /////////////////////////////////////////////////////////////////////

  /// @notice Prepare {tokenAmounts} to be passed to depositorEnter
  /// @dev Override this function to customize entry kind
  /// @param amount_ The amount of main asset that should be invested
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @return tokenAmounts Amounts of depositor's assets ready to invest (this array can be passed to depositorEnter)
  function _beforeDeposit(
    ITetuConverter tetuConverter_,
    uint amount_,
    address[] memory tokens_,
    uint indexAsset_
  ) internal virtual returns (
    uint[] memory tokenAmounts
  ) {
    // calculate required collaterals for each token and temporary save them to tokenAmounts
    (uint[] memory weights, uint totalWeight) = _depositorPoolWeights();
    // temporary save collateral to tokensAmounts
    tokenAmounts = ConverterStrategyBaseLib.getCollaterals(
      amount_,
      tokens_,
      weights,
      totalWeight,
      indexAsset_,
      IPriceOracle(IConverterController(tetuConverter_.controller()).priceOracle())
    );

    // make borrow and save amounts of tokens available for deposit to tokenAmounts
    tokenAmounts = ConverterStrategyBaseLib.getTokenAmounts(
      tetuConverter_,
      tokens_,
      indexAsset_,
      tokenAmounts,
      liquidationThresholds[tokens_[indexAsset_]]
    );
  }

  /////////////////////////////////////////////////////////////////////
  ///                     Withdraw from the pool
  /////////////////////////////////////////////////////////////////////

  /// @notice Withdraw given amount from the pool.
  /// @param amount Amount to be withdrawn in terms of the asset.
  /// @return expectedWithdrewUSD The value that we should receive after withdrawing (in USD, decimals of the {asset})
  /// @return assetPrice Price of the {asset} from the price oracle
  /// @return strategyLoss Loss should be covered from Insurance
  function _withdrawFromPool(uint amount) override internal virtual returns (
    uint expectedWithdrewUSD,
    uint assetPrice,
    uint strategyLoss
  ) {
    (expectedWithdrewUSD, assetPrice, strategyLoss) = _withdrawUniversal(amount, false);
  }

  /// @notice Withdraw all from the pool.
  /// @return expectedWithdrewUSD The value that we should receive after withdrawing
  /// @return assetPrice Price of the {asset} taken from the price oracle
  /// @return strategyLoss Loss should be covered from Insurance
  function _withdrawAllFromPool() override internal virtual returns (
    uint expectedWithdrewUSD,
    uint assetPrice,
    uint strategyLoss
  ) {
    (expectedWithdrewUSD, assetPrice, strategyLoss) = _withdrawUniversal(0, true);
  }

  /// @param amount Amount to be withdrawn. 0 is ok if we withdraw all.
  /// @param all Withdraw all
  /// @return expectedWithdrewUSD The value that we should receive after withdrawing in terms of USD value of each asset in the pool
  /// @return __assetPrice Price of the {asset} taken from the price oracle
  function _withdrawUniversal(uint amount, bool all) internal returns (
    uint expectedWithdrewUSD,
    uint __assetPrice,
    uint strategyLoss
  ) {
    uint investedAssetsBeforeWithdraw;
    (investedAssetsBeforeWithdraw, strategyLoss) = _updateInvestedAssetsAndGetLoss(true);

    if ((all || amount != 0) && investedAssetsBeforeWithdraw != 0) {

      address[] memory tokens = _depositorPoolAssets();
      address _asset = asset;
      uint indexAsset = ConverterStrategyBaseLib.getAssetIndex(tokens, _asset);
      ITetuConverter _converter = converter;
      uint balanceBefore = _balance(_asset);

      WithdrawUniversalLocal memory vars = WithdrawUniversalLocal({
      reserves : _depositorPoolReserves(),
      totalSupply : _depositorTotalSupply(),
      depositorLiquidity : _depositorLiquidity(),
      liquidityAmount : 0,
      amountsToConvert : new uint[](0),
      assetPrice : ConverterStrategyBaseLib.getAssetPriceFromConverter(_converter, _asset)
      });

      (vars.liquidityAmount, vars.amountsToConvert) = ConverterStrategyBaseLib.getLiquidityAmountRatio(
        all ? 0 : amount,
        address(this),
        tokens,
        indexAsset,
        _converter,
        investedAssetsBeforeWithdraw,
        vars.depositorLiquidity
      );

      uint[] memory withdrawnAmounts;
      uint expectedAmountMainAsset;

      if (vars.liquidityAmount != 0) {

        // =============== WITHDRAW =====================
        // make withdraw
        withdrawnAmounts = _depositorExit(vars.liquidityAmount);
        emit OnDepositorExit(vars.liquidityAmount, withdrawnAmounts);
        // ==============================================

        (expectedAmountMainAsset, vars.amountsToConvert) = ConverterStrategyBaseLib.postWithdrawActions(
          vars.reserves,
          vars.depositorLiquidity,
          vars.liquidityAmount,
          vars.totalSupply,
          vars.amountsToConvert,
          tokens,
          indexAsset,
          _converter,
          _depositorLiquidity(),
          withdrawnAmounts
        );

      } else {
        // we don't need to withdraw any amounts from the pool, available converted amounts are enough for us
        (withdrawnAmounts, expectedAmountMainAsset) = ConverterStrategyBaseLib.postWithdrawActionsEmpty(
          tokens,
          indexAsset,
          _converter,
          new uint[](tokens.length), // array with all zero values
          vars.amountsToConvert
        );
      }

      // convert amounts to main asset
      _convertAfterWithdraw(tokens, indexAsset, vars.amountsToConvert, _converter);

      uint investedAssetsAfterWithdraw = _updateInvestedAssets();
      uint balanceAfterWithdraw = _balance(_asset);

      // we need to compensate difference if during withdraw we lost some assets
      if ((investedAssetsAfterWithdraw + balanceAfterWithdraw) < (investedAssetsBeforeWithdraw + balanceBefore)) {
        strategyLoss += (investedAssetsBeforeWithdraw + balanceBefore) - (investedAssetsAfterWithdraw + balanceAfterWithdraw);
      }

      return (
      expectedAmountMainAsset * vars.assetPrice / 1e18,
      vars.assetPrice,
      strategyLoss
      );
    }
    return (0, 0, 0);
  }

  /// @notice If pool supports emergency withdraw need to call it for emergencyExit()
  function _emergencyExitFromPool() override internal virtual {
    uint[] memory withdrawnAmounts = _depositorEmergencyExit();
    emit OnDepositorEmergencyExit(withdrawnAmounts);

    // convert amounts to main asset
    (address[] memory tokens, uint indexAsset) = _getTokens(asset);
    _convertAfterWithdrawAll(tokens, indexAsset);

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
    uint[] memory amountsToConvert = ConverterStrategyBaseLib2.getAvailableBalances(tokens_, indexAsset_);

    // convert amounts to the main asset
    (collateralOut, repaidAmounts) = _convertAfterWithdraw(tokens_, indexAsset_, amountsToConvert, converter);
  }

  /// @notice Convert {amountsToConvert_} to the main {asset}
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @return collateralOut Total amount of collateral returned after closing positions
  /// @return repaidAmountsOut What amounts were spent in exchange of the {collateralOut}
  function _convertAfterWithdraw(
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory amountsToConvert_,
    ITetuConverter _converter
  ) internal returns (
    uint collateralOut,
    uint[] memory repaidAmountsOut
  ) {
    return ConverterStrategyBaseLib.convertAfterWithdraw(
      _converter,
      ITetuLiquidator(IController(controller()).liquidator()),
      liquidationThresholds[tokens_[indexAsset_]],
      tokens_,
      indexAsset_,
      amountsToConvert_
    );
  }

  /////////////////////////////////////////////////////////////////////
  ///                 Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @notice Claim all possible rewards.
  function _claim() override internal virtual {
    // get rewards from the Depositor
    (address[] memory depositorRewardTokens, uint[] memory depositorRewardAmounts, uint[] memory depositorBalancesBefore) = _depositorClaimRewards();

    (address[] memory rewardTokens, uint[] memory amounts) = ConverterStrategyBaseLib.prepareRewardsList(
      converter,
      _depositorPoolAssets(),
      depositorRewardTokens,
      depositorRewardAmounts,
      depositorBalancesBefore
    );

    uint len = rewardTokens.length;
    if (len > 0) {
      uint[] memory amountsToForward = _recycle(rewardTokens, amounts);

      // send forwarder-part of the rewards to the forwarder
      ConverterStrategyBaseLib2.sendTokensToForwarder(controller(), splitter, rewardTokens, amountsToForward);
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
  /// @return amountsToForward Amounts to be sent to forwarder
  function _recycle(
    address[] memory rewardTokens_,
    uint[] memory rewardAmounts_
  ) internal returns (uint[] memory amountsToForward) {
    // send performance-part of the rewards to performanceReceiver
    (uint[] memory rewardAmounts, uint[] memory performanceAmounts) = ConverterStrategyBaseLib2.sendPerformanceFee(
      performanceFee,
      performanceReceiver,
      rewardTokens_,
      rewardAmounts_
    );

    // send other part of rewards to forwarder/compound
    (amountsToForward) = ConverterStrategyBaseLib.recycle(
      asset,
      compoundRatio,
      _depositorPoolAssets(),
      ITetuLiquidator(IController(controller()).liquidator()),
      liquidationThresholds,
      rewardTokens_,
      rewardAmounts
    );

    emit Recycle(
      rewardTokens_,
      amountsToForward,
      performanceAmounts
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
    require(msg.sender == splitter, StrategyLib.DENIED);
    return _doHardWork(true);
  }

  /// @notice Claim rewards, do _processClaims() after claiming, calculate earned and lost amounts
  function _handleRewards() internal virtual returns (uint earned, uint lost, uint assetBalanceAfterClaim) {
    uint assetBalanceBefore = _balance(asset);
    _claim();
    assetBalanceAfterClaim = _balance(asset);
    (earned, lost) = ConverterStrategyBaseLib.registerIncome(assetBalanceBefore, assetBalanceAfterClaim, earned, lost);
    return (earned, lost, assetBalanceAfterClaim);
  }

  /// @return earned Earned amount in terms of {asset}
  /// @return lost Lost amount in terms of {asset}
  function _doHardWork(bool reInvest) internal returns (uint earned, uint lost) {
    uint investedAssetsBefore = _investedAssets;
    uint investedAssetsLocal = _updateInvestedAssets();

    _preHardWork(reInvest);

    uint assetBalance;
    (earned, lost, assetBalance) = _handleRewards();

    // register autocompound income or possible lose if assets fluctuated
    (earned, lost) = ConverterStrategyBaseLib.registerIncome(investedAssetsBefore, investedAssetsLocal, earned, lost);

    // re-invest income
    if (reInvest && assetBalance > reinvestThresholdPercent * investedAssetsLocal / REINVEST_THRESHOLD_DENOMINATOR) {
      uint assetInUseBefore = investedAssetsLocal + assetBalance;
      _depositToPool(assetBalance, false);

      (earned, lost) = ConverterStrategyBaseLib.registerIncome(assetInUseBefore, _investedAssets + _balance(asset), earned, lost);
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
    (address[] memory tokens, uint indexAsset) = _getTokens(asset);
    return ConverterStrategyBaseLib.calcInvestedAssets(
      tokens,
    // quote exit should check zero liquidity
      _depositorQuoteExit(_depositorLiquidity()),
      indexAsset,
      converter
    );
  }

  function calcInvestedAssets() external returns (uint) {
    return _calcInvestedAssets();
  }

  /// @notice Update invested assets and return possible lose [new-investedAssets - old-investedAssets]
  /// @param updateTotalAssetsBeforeInvest_ If false - skip update, return delta = 0
  function _updateInvestedAssetsAndGetLoss(bool updateTotalAssetsBeforeInvest_) internal returns (
    uint updatedInvestedAssets,
    uint loss
  ) {
    uint __investedAssets = _investedAssets;

    updatedInvestedAssets = updateTotalAssetsBeforeInvest_
    ? _updateInvestedAssets()
    : __investedAssets;

    loss = updateTotalAssetsBeforeInvest_
    ? updatedInvestedAssets < __investedAssets ? __investedAssets - updatedInvestedAssets : 0
    : uint(0);
  }

  /////////////////////////////////////////////////////////////////////
  ///               ITetuConverterCallback
  /////////////////////////////////////////////////////////////////////

  /// @notice Converters asks to send some amount back.
  /// @param theAsset_ Required asset (either collateral or borrow)
  /// @param amount_ Required amount of the {theAsset_}
  /// @return amountOut Amount sent to balance of TetuConverter, amountOut <= amount_
  function requirePayAmountBack(address theAsset_, uint amount_) external override returns (uint amountOut) {
    RequirePayAmountBackLocal memory v;
    v.converter = address(converter);
    require(msg.sender == v.converter, StrategyLib.DENIED);

    // detect index of the target asset
    (v.tokens, v.indexTheAsset) = _getTokens(theAsset_);
    require(v.indexTheAsset != type(uint).max, StrategyLib.WRONG_VALUE);
    v.len = v.tokens.length;

    // get amount of target asset available to be sent
    v.balance = _balance(theAsset_);

    // follow array can be re-created below but it's safer to initialize them here
    v.withdrawnAmounts = new uint[](v.len);
    v.spentAmounts = new uint[](v.len);

    // withdraw from the pool
    if (v.balance < amount_) {
      // the strategy doesn't have enough target asset on balance
      // withdraw all from the pool but don't convert assets to underlying
      v.liquidity = _depositorLiquidity();
      if (v.liquidity != 0) {
        v.withdrawnAmounts = _depositorExit(v.liquidity);
        emit OnDepositorExit(v.liquidity, v.withdrawnAmounts);
      }
    }

    // convert withdrawn assets to the target asset
    if (v.balance + v.withdrawnAmounts[v.indexTheAsset] < amount_) {
      (v.spentAmounts, v.withdrawnAmounts) = ConverterStrategyBaseLib.swapToGivenAmount(
        amount_ - (v.balance + v.withdrawnAmounts[v.indexTheAsset]),
        v.tokens,
        v.indexTheAsset,
        asset, // underlying === main asset
        v.withdrawnAmounts,
        ITetuConverter(v.converter),
        ITetuLiquidator(IController(controller()).liquidator()),
        liquidationThresholds[theAsset_],
        ConverterStrategyBaseLib.OVERSWAP
      );
    }

    // send amount to converter and update baseAmounts
    amountOut = Math.min(v.balance + v.withdrawnAmounts[v.indexTheAsset], amount_);
    IERC20(theAsset_).safeTransfer(v.converter, amountOut);

    // There are two cases of calling requirePayAmountBack by converter:
    // 1) close a borrow: we will receive collateral back and amount of investedAssets almost won't change
    // 2) rebalancing: we have real loss, it will be taken into account at next hard work
    // So, _updateInvestedAssets() is not called here
    emit ReturnAssetToConverter(theAsset_, amountOut);

    // let's leave any leftovers un-invested, they will be reinvested at next hardwork
  }

  /// @notice TetuConverter calls this function when it sends any amount to user's balance
  /// @param assets_ Any asset sent to the balance, i.e. inside repayTheBorrow
  /// @param amounts_ Amount of {asset_} that has been sent to the user's balance
  function onTransferAmounts(address[] memory assets_, uint[] memory amounts_) external override {
    uint len = assets_.length;
    require(len == amounts_.length, AppErrors.INCORRECT_LENGTHS);

    // TetuConverter is able two call this function in two cases:
    // 1) rebalancing (the health factor of some borrow is too low)
    // 2) forcible closing of the borrow
    // In both cases we update invested assets value here
    // and avoid fixing any related losses in hardwork
    _updateInvestedAssets();
  }

  /////////////////////////////////////////////////////////////////////
  ///                Others
  /////////////////////////////////////////////////////////////////////

  /// @notice Unlimited capacity by default
  function capacity() external virtual view returns (uint) {
    return 2 ** 255;
    // almost same as type(uint).max but more gas efficient
  }

  function _getTokens(address asset_) internal view returns (address[] memory tokens, uint indexAsset) {
    tokens = _depositorPoolAssets();
    indexAsset = ConverterStrategyBaseLib.getAssetIndex(tokens, asset_);
  }

  /**
* @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
  uint[46] private __gap;

}
