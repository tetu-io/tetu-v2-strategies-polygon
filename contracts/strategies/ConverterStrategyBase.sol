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

//!! import "hardhat/console.sol";

/// @title Abstract contract for base Converter strategy functionality
/// @notice All depositor assets must be correlated (ie USDC/USDT/DAI)
/// @author bogdoslav
abstract contract ConverterStrategyBase is ITetuConverterCallback, DepositorBase, StrategyBaseV2 {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  ///                        CONSTANTS
  /////////////////////////////////////////////////////////////////////

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant CONVERTER_STRATEGY_BASE_VERSION = "1.0.0";

  uint private constant _REWARD_LIQUIDATION_SLIPPAGE = 5_000; // 5%
  uint private constant _ASSET_LIQUIDATION_SLIPPAGE = 500; // 0.5%

  uint private constant REINVEST_THRESHOLD_PERCENT_DENOMINATOR = 100_000;
  /////////////////////////////////////////////////////////////////////
  //                        VARIABLES
  //                Keep names and ordering!
  //                 Add only in the bottom.
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
    //!! console.log("__ConverterStrategyBase_init, totalSupply", _depositorTotalSupply());
  }

  function setLiquidationThreshold(address token, uint amount) external {
    _onlyOperators();
    liquidationThresholds[token] = amount;
    emit LiquidationThresholdChanged(token, amount);
  }

  /// @param percent_ New value of the percent, decimals = {REINVEST_THRESHOLD_PERCENT_DENOMINATOR}
  function setReinvestThresholdPercent(uint percent_) external {
    //!! console.log("setReinvestThresholdPercent", percent_, REINVEST_THRESHOLD_PERCENT_DENOMINATOR);
    _onlyOperators();
    require(percent_ <= REINVEST_THRESHOLD_PERCENT_DENOMINATOR, AppErrors.WRONG_VALUE);

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
    if (amount_ > reinvestThresholdPercent * _investedAssets / REINVEST_THRESHOLD_PERCENT_DENOMINATOR) {
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
      _afterDeposit(tokens, indexAsset, consumedAmounts, borrowedAmounts, collateral);

      // adjust _investedAssets
      _updateInvestedAssets();
    }
  }

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
        borrowedAmounts[i] = ConverterStrategyBaseLib.borrowPosition(
          tetuConverter_,
          tokens_[indexAsset_],
          tokenAmounts[i],
          tokens_[i]
        );
        spentCollateral += tokenAmounts[i];
      }
      tokenAmounts[i] = IERC20(tokens_[i]).balanceOf(address(this));
    }

    return (tokenAmounts, borrowedAmounts, spentCollateral);
  }

  /// @notice Update base amounts after deposit
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @param amountsConsumed_ Amounts deposited to the internal pool
  /// @param borrowed_ Amounts borrowed before the deposit
  /// @param collateral_ Amount of main {asset} spent to get {borrowed} amounts
  function _afterDeposit(
    address[] memory tokens_,
    uint indexAsset_,
    uint[] memory amountsConsumed_,
    uint[] memory borrowed_,
    uint collateral_
  ) internal {
    // update base-amounts
    uint len = tokens_.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset_) {
        _decreaseBaseAmount(tokens_[i], collateral_);
      } else {
        if (borrowed_[i] >= amountsConsumed_[i]) {
          _increaseBaseAmount(tokens_[i], borrowed_[i] - amountsConsumed_[i], _balance(tokens_[i]));
        } else {
          _decreaseBaseAmount(tokens_[i], amountsConsumed_[i] - borrowed_[i]);
        }
      }
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///                     Withdraw from the pool
  /////////////////////////////////////////////////////////////////////

  function _getExpectedWithdrawnAmountUSD(uint liquidityAmount) internal view returns (
    uint investedAssetsUSD,
    uint assetPrice
  ) {
    // predict expected amount to be withdrawn (in USD)
    return ConverterStrategyBaseLib.getExpectedWithdrawnAmountUSD(
      _depositorPoolAssets(),
      _depositorPoolReserves(),
      asset,
      liquidityAmount,
      _depositorTotalSupply(),
      IPriceOracle(IConverterController(tetuConverter.controller()).priceOracle())
    );
  }

  /// @notice Withdraw given amount from the pool.
  /// @param amount Amount to be withdrawn in terms of the asset.
  /// @return investedAssetsUSD The value that we should receive after withdrawing (in USD, decimals of the {asset})
  /// @return assetPrice Price of the {asset} from the price oracle
  function _withdrawFromPool(uint amount) override internal virtual returns (uint investedAssetsUSD, uint assetPrice) {
    require(_investedAssets != 0, "CSB: no investments");
    if (amount != 0 && _investedAssets != 0) {
      uint liquidityAmount = _depositorLiquidity()  // total amount of LP tokens owned by the strategy
        * 101 // add 1% on top...
        * amount / _investedAssets // a part of amount that we are going to withdraw
        / 100; // .. add 1% on top

      (investedAssetsUSD, assetPrice) = _getExpectedWithdrawnAmountUSD(liquidityAmount);
      uint collateralOut = _withdrawFromPoolUniversal(liquidityAmount, false, false);

      // we cannot predict collateral amount that is returned after closing position, so we use actual collateral value
      investedAssetsUSD += collateralOut * assetPrice / 1e18;
    }

    return (investedAssetsUSD, assetPrice);
  }

  /// @notice Withdraw all from the pool.
  /// @return investedAssetsUSD The value that we should receive after withdrawing
  /// @return assetPrice Price of the {asset} taken from the price oracle
  function _withdrawAllFromPool() override internal virtual returns (uint investedAssetsUSD, uint assetPrice) {
    // total amount of LP-tokens deposited by the strategy
    uint liquidityAmount = _depositorLiquidity();

    // predict expected amount to be withdrawn (in USD)
    (investedAssetsUSD, assetPrice) = _getExpectedWithdrawnAmountUSD(liquidityAmount);
    uint collateralOut = _withdrawFromPoolUniversal(liquidityAmount, false, true);

    // we cannot predict collateral amount that is returned after closing position, so we use actual collateral value
    investedAssetsUSD += collateralOut * assetPrice / 1e18;
  }

  /// @notice If pool support emergency withdraw need to call it for emergencyExit()
  function _emergencyExitFromPool() override internal virtual {
    _withdrawFromPoolUniversal(0, true, true);
  }

  /// @param repayAll_ After withdraw convert (all available on balance OR withdrawn only) amounts to the main asset
  function _withdrawFromPoolUniversal(uint liquidityAmount_, bool emergency_, bool repayAll_) internal returns (
    uint collateralOut
  ) {
    address _asset = asset; //gas saving
    // withdraw the amount from the depositor to balance of the strategy
    uint[] memory withdrawnAmounts = emergency_
      ? _depositorEmergencyExit()
      : _depositorExit(liquidityAmount_);

    address[] memory tokens = _depositorPoolAssets();
    uint indexAsset = ConverterStrategyBaseLib.getAssetIndex(tokens, _asset);
    uint len = tokens.length;

    // get amounts that should be converted to the main asset
    uint[] memory amountsToConvert;
    if (repayAll_) {
      amountsToConvert = new uint[](len);
      for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
        if (i == indexAsset) continue;
        amountsToConvert[i] = _balance(tokens[i]);
      }
    } else {
      amountsToConvert = withdrawnAmounts;
    }

    // convert amounts to the main asset
    uint[] memory repaidAmounts;
    (collateralOut, repaidAmounts) = _afterWithdraw(
      tokens,
      indexAsset,
      amountsToConvert
    );
    for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == indexAsset) {
        _increaseBaseAmount(_asset, collateralOut + withdrawnAmounts[indexAsset], _balance(_asset));
      } else {
        if (withdrawnAmounts[i] > repaidAmounts[i]) {
          _increaseBaseAmount(tokens[i], withdrawnAmounts[i] - repaidAmounts[i], _balance(tokens[i]));
        } else {
          _decreaseBaseAmount(tokens[i], repaidAmounts[i] - withdrawnAmounts[i]);
        }
      }
    }
    _updateInvestedAssets();
  }

  /// @notice Convert given amounts to the main {asset}
  /// @param tokens_ Results of _depositorPoolAssets() call (list of depositor's asset in proper order)
  /// @param indexAsset_ Index of main {asset} in {tokens}
  /// @return collateralOut Total amount of collateral returned after closing positions
  function _afterWithdraw(
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
          if (receivedAmountOut > 0) {
            collateralOut += receivedAmountOut;
          }
          if (spentAmountIn > 0) {
            repaidAmountsOut[i] += spentAmountIn;
          }
        }
      }
    }

    return (collateralOut, repaidAmountsOut);
  }

  /////////////////////////////////////////////////////////////////////
  ///                 Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @notice Claim all possible rewards.
  function _claim() override internal virtual {
    // get rewards from the Depositor
    (address[] memory rewardTokens, uint[] memory amounts) = _depositorClaimRewards();

    _processClaims(
      tetuConverter,
      rewardTokens,
      amounts
    );
  }

  /// @notice Claim rewards from tetuConverter, make list of all available rewards, do post-processing
  /// @dev The post-processing is rewards conversion to the main asset
  /// @param tokens_ List of rewards claimed from the internal pool
  /// @param amounts_ Amounts of rewards claimed from the internal pool
  function _processClaims(
    ITetuConverter tetuConverter_,
    address[] memory tokens_,
    uint[] memory amounts_
  ) internal {
    // Rewards from TetuConverter
    (address[] memory tokens2, uint[] memory amounts2) = tetuConverter_.claimRewards(address(this));

    // Join arrays and recycle tokens
    (address[] memory tokens, uint[] memory amounts) = TokenAmountsLib.unite(tokens_, amounts_, tokens2, amounts2);

    // {amounts} contain just received values, but probably we already had some tokens on balance
    uint len = tokens.length;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      amounts[i] = IERC20(tokens[i]).balanceOf(address(this)) - baseAmounts[tokens[i]];
    }

    if (len > 0) {
      _recycle(tokens, amounts);
    }
  }

  /// @notice Recycle the amounts: liquidate a part of each amount, send the other part to the forwarder.
  /// We have two kinds of rewards:
  /// 1) rewards in depositor's assets (the assets returned by _depositorPoolAssets)
  /// 2) any other rewards
  /// All received rewards are immediately "recycled".
  /// It means, they are divided on two parts: to forwarder, to compound
  ///   Compound-part of Rewards-2 can be liquidated
  ///   Compound part of Rewards-1 should be just added to baseAmounts
  /// All forwarder-parts are just transferred to the forwarder.
  function _recycle(address[] memory tokens, uint[] memory amounts) internal {
    require(tokens.length == amounts.length, "SB: Arrays mismatch");
    address _asset = asset; // gas saving
    uint _compoundRatio = compoundRatio; // gas saving
    IForwarder forwarder = IForwarder(IController(controller()).forwarder());

    uint len = tokens.length;
    uint[] memory amountsToForward = new uint[](len);
    uint liquidationThreshold = liquidationThresholds[_asset];

    // split each amount on two parts: a part-to-compound and a part-to-transfer-to-the-forwarder
    for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
      address token = tokens[i];

      uint amountToCompound = amounts[i] * _compoundRatio / COMPOUND_DENOMINATOR;

      if (amountToCompound > 0) {
        if (ConverterStrategyBaseLib.getAssetIndex(tokens, token) == type(uint).max
          || amounts[i] < liquidationThresholds[token]
        ) {
          uint baseAmountIn = baseAmounts[token];
          (uint spentAmountIn, uint receivedAmountOut) = ConverterStrategyBaseLib.liquidate(
            ITetuLiquidator(IController(controller()).liquidator()),
            token,
            _asset,
            amountToCompound,
            _REWARD_LIQUIDATION_SLIPPAGE,
            liquidationThreshold
          );
          if (receivedAmountOut > 0) {
            _increaseBaseAmount(_asset, receivedAmountOut, 0);
          }
          if (spentAmountIn > baseAmountIn) {
            _decreaseBaseAmount(token, baseAmountIn);
          } else {
            _decreaseBaseAmount(token, baseAmountIn);
          }
        } else {
          _increaseBaseAmount(token, amountToCompound, 0);
        }
      }

      uint amountToForward = amounts[i] - amountToCompound;
      amountsToForward[i] = amountToForward;
      AppLib.approveIfNeeded(token, amountToForward, address(forwarder));
    }

    forwarder.registerIncome(tokens, amountsToForward, ISplitter(splitter).vault(), true);
  }

  /////////////////////////////////////////////////////////////////////
  ///                   Hardwork
  /////////////////////////////////////////////////////////////////////

  /// @notice A virtual handler to make any action before hardwork
  function _preHardWork(bool reInvest) internal virtual {}

  /// @notice A virtual handler to make any action after hardwork
  function _postHardWork() internal virtual {}

  /// @notice Is strategy ready to hard work
  function isReadyToHardWork() override external virtual pure returns (bool) {
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
    _preHardWork(reInvest);
    (earned, lost) = _handleRewards();
    uint assetBalance = _balance(asset);

    // re-invest income
    if (reInvest
      && assetBalance > reinvestThresholdPercent * _investedAssets / REINVEST_THRESHOLD_PERCENT_DENOMINATOR
    ) {
      uint investedBefore = _investedAssets;
      _depositToPool(assetBalance);
      uint investedAfter = _investedAssets;
      uint assetBalanceAfterDeposit = _balance(asset);

      int delta = (int(assetBalanceAfterDeposit) + int(investedAfter)) - (int(assetBalance) + int(investedBefore));

      if (delta > 0) {
        earned += uint(delta);
      } else {
        lost -= uint(-delta);
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
    //!! console.log('_updateInvestedAssets _investedAssets BEFORE', _investedAssets);
    _investedAssets = calcInvestedAssets();
    //!! console.log('_updateInvestedAssets _investedAssets AFTER', _investedAssets);
  }

  /// @notice Calculate amount we will receive when we withdraw all from pool
  /// @dev This is writable function because quoteRepay is writable (it updates current balances in the internal pools)
  /// @return estimatedAssets Invested asset amount under control (in terms of {asset})
  function calcInvestedAssets() public returns (uint estimatedAssets) {
    //!! console.log("calcInvestedAssets.start");
    uint liquidity = _depositorLiquidity();
    if (liquidity == 0) {
      estimatedAssets = 0;
    } else {
      uint[] memory amountsOut = _depositorQuoteExit(liquidity);
      address[] memory tokens = _depositorPoolAssets();

      address _asset = asset;
      estimatedAssets = 0;
      //!! console.log("calcInvestedAssets._asset", _asset);

      uint len = tokens.length;
      for (uint i = 0; i < len; i = AppLib.uncheckedInc(i)) {
        address borrowedToken = tokens[i];
        estimatedAssets += _asset == borrowedToken
          ? amountsOut[i]
          : tetuConverter.quoteRepay(address(this), _asset, borrowedToken, _balance(borrowedToken) + amountsOut[i]);
        //!! console.log("_balance(borrowedToken)", _balance(borrowedToken));
        //!! console.log("amountsOut[i]", amountsOut[i]);
        //!! console.log("estimatedAssets", estimatedAssets);
      }
    }
    //!! console.log("calcInvestedAssets.estimatedAssets", estimatedAssets);
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
    //!! console.log("requireAmountBack");
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

    //!! console.log(">>> Asset balance after requireAmountBack", _balance(asset));
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
