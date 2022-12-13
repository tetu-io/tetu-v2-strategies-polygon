// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyBaseV2.sol";
import "../interfaces/converter/ITetuConverter.sol";
import "../interfaces/converter/ITetuConverterCallback.sol";
import "../interfaces/IERC20Extended.sol";
import "./depositors/DepositorBase.sol";
import "../tools/TokenAmountsLib.sol";

import "hardhat/console.sol";

/// @title Abstract contract for base Converter strategy functionality
/// @notice All depositor assets must be correlated (ie USDC/USDT/DAI)
/// @author bogdoslav
abstract contract ConverterStrategyBase is ITetuConverterCallback, DepositorBase, StrategyBaseV2 {
  using SafeERC20 for IERC20;

  // *************************************************************
  //                        CONSTANTS
  // *************************************************************

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant CONVERTER_STRATEGY_BASE_VERSION = "1.0.0";

  // approx one month for average block time 2 sec
  uint private constant _LOAN_PERIOD_IN_BLOCKS = 30 days / 2;

  uint private constant _LIQUIDATION_SLIPPAGE = 5_000; // 5%

  uint private constant _COLLATERAL_RATE = 2; // Collateral to debt target rate 200%

  // *************************************************************
  //                        VARIABLES
  //                Keep names and ordering!
  //                 Add only in the bottom.
  // *************************************************************

  /// @dev Amount of underlying assets invested to the pool.
  uint private _investedAssets;

  /// @dev Linked Tetu Converter
  ITetuConverter public tetuConverter;

  /// @dev Minimum token amounts to liquidate etc.
  mapping (address => uint) public thresholds;

  bool private _isReadyToHardWork;

  event ThresholdChanged(address token, uint amount);


  // *************************************************************
  //                        INIT
  // *************************************************************

  /// @notice Initialize contract after setup it as proxy implementation
  function __ConverterStrategyBase_init(
    address controller_,
    address splitter_,
    address[] memory rewardTokens_,
    address converter_,
    address[] memory thresholdTokens_,
    uint[] memory thresholdAmounts_
  ) internal onlyInitializing {
    __StrategyBase_init(controller_, splitter_, rewardTokens_);
    tetuConverter = ITetuConverter(converter_);


    // Set threshold for asset
    address _asset = asset;
    uint8 decimals = IERC20Extended(_asset).decimals();
    thresholds[_asset] = 10**(decimals-2); // 1 cent

    _setThresholds(thresholdTokens_, thresholdAmounts_);

    _isReadyToHardWork = true;

  }

  // *************************************************************
  //                     RESTRICTIONS
  // *************************************************************

  /// @dev Restrict access only for TetuConverter
  function _onlyTetuConverter() internal view {
    require(msg.sender == address(tetuConverter), "CSB: Only TetuConverter");
  }


  // *************************************************************
  //                     OPERATORS
  // *************************************************************

  function setThreshold(address token, uint amount) public {
    _onlyOperators();
    thresholds[token] = amount;
    emit ThresholdChanged(token, amount);
  }

  function setThresholds(address[] memory tokens, uint[] memory amounts) external {
    _onlyOperators();
    _setThresholds(tokens, amounts);
  }

  function _setThresholds(address[] memory tokens, uint[] memory amounts) internal {
    require(tokens.length == amounts.length, 'CSB: Arrays mismatch');
    for (uint i = 0; i < tokens.length; ++i) {
      address token = tokens[i];
      uint amount = amounts[i];
      thresholds[token] = amount;
      emit ThresholdChanged(token, amount);
    }
  }

  // *************************************************************
  //                       OVERRIDES StrategyBase
  // *************************************************************

  /// @dev Amount of underlying assets converted to pool assets and invested to the pool.
  function investedAssets() override public view virtual returns (uint) {
    return _investedAssets;
  }

  /// @dev Deposit given amount to the pool.
  function _depositToPool(uint amount) override internal virtual {
    console.log('_depositToPoolUniversal... amount', amount);
    _doHardWork(false);
    _depositToPoolUniversal(amount);
  }

  /// @dev Deposit given amount to the pool.
  function _depositToPoolUniversal(uint amount) internal virtual {
    console.log('_depositToPoolUniversal... amount', amount);

    address _asset = asset;
    // skip deposit for small amounts
    if (amount < thresholds[_asset]) return;

    address[] memory tokens = _depositorPoolAssets();
    (uint[] memory weights, uint totalWeight) = _depositorPoolWeights();
    uint len = tokens.length;
    uint[] memory tokenAmounts = new uint[](len);

    // we need twice (_COLLATERAL_RATE) more weight for non-asset tokens to borrow target amount
    for (uint i = 0; i < len; ++i) {
      if (tokens[i] != _asset) {
        totalWeight += weights[i] * (_COLLATERAL_RATE - 1);
        weights[i] *= _COLLATERAL_RATE;
      }
    }
    console.log('Weights:');
    TokenAmountsLib.print(tokens, weights);

    for (uint i = 0; i < len; ++i) {
      uint assetAmountForToken = amount * weights[i] / totalWeight;
      address token = tokens[i];

      if (token == _asset) {
        tokenAmounts[i] = assetAmountForToken;

      } else {
        uint tokenBalance = _balance(token);

        if (tokenBalance >= assetAmountForToken) { // we already have enough tokens
          tokenAmounts[i] = tokenBalance;

        } else { // we do not have enough tokens - borrow
          uint collateral = assetAmountForToken - tokenBalance;
          console.log('collateral', collateral);
         _borrowPosition(_asset, collateral, token);
          tokenAmounts[i] = _balance(token);
        }
      }
    }
    console.log('Amounts:');
    TokenAmountsLib.print(tokens, tokenAmounts);

    _depositorEnter(tokenAmounts);

    // TODO remove - check result amounts
    for (uint i = 0; i < len; ++i) {
      tokenAmounts[i] = _balance(tokens[i]);
    }
    console.log('Balance after:');
    TokenAmountsLib.print(tokens, tokenAmounts);

    _updateInvestedAssets();
  }

  /// @dev Withdraw given amount from the pool.
  function _withdrawFromPoolUniversal(uint amount, bool emergency) internal {
    console.log('_withdrawFromPoolUniversal amount, emergency', amount, emergency);
    if (amount == 0) return;

    if (!emergency) {
      _doHardWork(false);
    }

    address _asset = asset;

    if (emergency) {
      _depositorEmergencyExit();

    } else {
      uint liquidityAmount;

      if (amount == type(uint).max) {
        liquidityAmount = _depositorLiquidity();

      } else {
        liquidityAmount = amount * _depositorLiquidity() / _investedAssets;
        liquidityAmount += liquidityAmount / 100; // add 1% on top
      }

      _depositorExit(liquidityAmount);
    }

    address[] memory tokens = _depositorPoolAssets();
    uint len = tokens.length;

    for (uint i = 0; i < len; ++i) {
      address borrowedToken = tokens[i];
      if (_asset != borrowedToken) {
        _closePosition(_asset, borrowedToken, _balance(borrowedToken));
      }
    }
  }

  /// @dev Withdraw given amount from the pool.
  function _withdrawFromPool(uint amount) override internal virtual {
    _withdrawFromPoolUniversal(amount, false);
    _updateInvestedAssets();

  }

  /// @dev Withdraw all from the pool.
  function _withdrawAllFromPool() override internal virtual {
    _withdrawFromPoolUniversal(type(uint).max, false);
    _investedAssets = 0;

  }

  /// @dev If pool support emergency withdraw need to call it for emergencyExit()
  function _emergencyExitFromPool() override internal virtual {
    _withdrawFromPoolUniversal(type(uint).max, true);
    _investedAssets = 0;

  }


  function _recycle(address[] memory tokens, uint[] memory amounts) internal {
    require(tokens.length == amounts.length, "SB: Arrays mismatch");

    ITetuLiquidator _tetuLiquidator = ITetuLiquidator(IController(controller()).liquidator());
    IForwarder _forwarder = IForwarder(IController(controller()).forwarder());

    address _asset = asset;
    uint len = tokens.length;
    uint _compoundRatio = compoundRatio;
    console.log('_compoundRatio', _compoundRatio);
    uint[] memory amountsToForward = new uint[](len);

    for (uint i = 0; i < len; ++i) {
      address token = tokens[i];
      uint amount = amounts[i];

      console.log('token, amount', token, amount);
      if (amount != 0 && amount > thresholds[token]) {
        uint amountToCompound = amount * _compoundRatio / COMPOUND_DENOMINATOR;
        if (amountToCompound > 0) {
          _liquidate(_tetuLiquidator, token, _asset, amountToCompound, _LIQUIDATION_SLIPPAGE);
        }

        uint amountToForward = amount - amountToCompound;
        console.log('amountToCompound', amountToCompound);
        amountsToForward[i] = amountToForward;
        console.log('amountToForward ', amountToForward);

        _approveIfNeeded(token, amountToForward, address(_forwarder));
      }
    }

    _forwarder.registerIncome(tokens, amountsToForward, ISplitter(splitter).vault(), true);

  }

  /// @dev Claim all possible rewards.
  function _claim() override internal virtual {
    console.log('_claim...');

    // Rewards from the Depositor
    address[] memory tokens1;
    uint[] memory amounts1;
    (tokens1, amounts1) = _depositorClaimRewards();

    // Rewards from TetuConverter
    address[] memory tokens2;
    uint[] memory amounts2;
    (tokens2, amounts2) =  tetuConverter.claimRewards(address(this));

    address[] memory tokens;
    uint[] memory amounts;
    // Join arrays and recycle tokens
    (tokens, amounts) = TokenAmountsLib.unite(tokens1, amounts1, tokens2, amounts2);
    TokenAmountsLib.print(tokens, amounts); // TODO remove
    if (tokens.length > 0) {
      _recycle(tokens, amounts);
    }

  }

  /// @dev Is strategy ready to hard work
  function isReadyToHardWork()
  override external view returns (bool) {
    return _isReadyToHardWork;
  }

  /// @dev Do hard work
  function doHardWork()
  override public returns (uint, uint) {
    return _doHardWork(true);
  }

  function _doHardWork(bool reInvest)
  internal returns (uint earned, uint lost) {
    console.log('doHardWork...');
    uint assetBalanceBefore = _balance(asset);
    _claim();
    uint assetBalanceAfter = _balance(asset);
    earned = assetBalanceAfter - assetBalanceBefore;

    lost = 0;

    if (reInvest && assetBalanceAfter > 0) { // re-invest income
      uint investedBefore = _investedAssets;
      _depositToPoolUniversal(assetBalanceAfter);
      _updateInvestedAssets();
      uint investedAfter = _investedAssets;

      if (investedAfter > investedBefore) {
        earned += investedAfter - investedBefore;
      } else {
        lost = investedBefore - investedAfter;
      }

    }

  }


  // *************************************************************
  //               InvestedAssets Calculations
  // *************************************************************

  /// @dev Function to calculate amount we will receive when we withdraw all from pool
  ///      Return amountOut in revert message
  function getInvestedAssetsReverted() public {
    uint assetsBefore = _balance(asset);
    _withdrawFromPoolUniversal(type(uint).max, true);
    uint assetsAfter = _balance(asset);
    uint amountOut = assetsAfter - assetsBefore;

    // store answer in revert message data
    assembly {
      let ptr := mload(0x40)
      mstore(ptr, amountOut)
      revert(ptr, 32)
    }
  }

  /// @dev Returns invested asset amount (when we withdraw amountIn most underlying tokens to pipe with specified index)
  function _getInvestedAssets() internal returns (uint) {
    try ConverterStrategyBase(address(this)).getInvestedAssetsReverted()
    {} catch (bytes memory reason) {
      return parseRevertReason(reason);
    }
    return 0;
  }

  /// @dev Updates cached _investedAssets to actual value
  /// @notice Should be called after deposit / withdraw / claim
  function _updateInvestedAssets() internal {
    _investedAssets = _getInvestedAssets();
    console.log('_updateInvestedAssets _investedAssets', _investedAssets);
  }

  /// @dev Parses a revert reason that should contain the numeric answer
  /// @param reason encoded revert reason
  /// @return numeric answer
  function parseRevertReason(bytes memory reason) private pure returns (uint) {
    if (reason.length != 32) {
      if (reason.length < 68) {
        revert('CSB: Unexpected');
      }
      assembly {
        reason := add(reason, 0x04)
      }
      revert(abi.decode(reason, (string)));
    }
    return abi.decode(reason, (uint256));
  }


  // *************************************************************
  //               OVERRIDES ITetuConverterCallback
  // *************************************************************


  function requireAmountBack (
    address collateralAsset_,
    uint requiredAmountCollateralAsset_,
    address /*borrowAsset_*/,
    uint /*requiredAmountBorrowAsset_*/
  ) external override returns (
    uint amountOut,
    bool isCollateral
  ) {
    _onlyTetuConverter();
    require(collateralAsset_ == asset, 'CSB: Wrong asset');

    amountOut = 0;
    uint assetBalance = _balance(collateralAsset_);

    if (assetBalance >=  requiredAmountCollateralAsset_) {
      amountOut = requiredAmountCollateralAsset_;

    } else {
      // we assume if withdraw less amount then requiredAmountCollateralAsset_
      // it will be rebalanced in the next call
      _withdrawFromPool(requiredAmountCollateralAsset_ - assetBalance);
      amountOut = _balance(collateralAsset_);
    }

    IERC20(collateralAsset_).safeTransfer(address(tetuConverter), amountOut);
    isCollateral = true;
  }

  function onTransferBorrowedAmount (
    address /*collateralAsset_*/,
    address /*borrowAsset_*/,
    uint /*amountBorrowAssetSentToBorrower_*/
  ) override pure external {
    // noop; will deposit amount received at the next hardwork
  }


  // *************************************************************
  //                        HELPERS
  // *************************************************************

  function _borrowPosition(
    address collateralAsset,
    uint collateralAmount,
    address borrowAsset
  ) internal returns (uint borrowedAmount) {
    console.log('_openPosition col, amt, bor', collateralAsset, collateralAmount, borrowAsset);
    ITetuConverter _tetuConverter = tetuConverter;
    _approveIfNeeded(collateralAsset, collateralAmount, address(_tetuConverter));
    (
      address converter,
      uint maxTargetAmount,
      /*int aprForPeriod36*/
    ) = _tetuConverter.findBorrowStrategy(
      collateralAsset,
      collateralAmount,
      borrowAsset,
      _LOAN_PERIOD_IN_BLOCKS
    );
    console.log('converter, maxTargetAmount', converter, maxTargetAmount);
    if (converter == address(0) || maxTargetAmount == 0) {
      borrowedAmount = 0;

    } else {
      IERC20(collateralAsset).safeTransfer(address(_tetuConverter), collateralAmount);
      borrowedAmount = _tetuConverter.borrow(
        converter, collateralAsset, collateralAmount, borrowAsset, maxTargetAmount, address(this));
    }
  }

  function _estimateRepay(
    address collateralAsset_,
    uint collateralAmountRequired_,
    address borrowAsset_
  ) internal view returns (
    uint borrowAssetAmount,
    uint unobtainableCollateralAssetAmount
  ){
    return tetuConverter.estimateRepay(collateralAsset_, collateralAmountRequired_, borrowAsset_);
  }

  function _closePosition(address collateralAsset, address borrowAsset, uint amountToRepay)
  internal returns (uint returnedAssetAmount) {
  console.log('_closePosition... collateralAsset, borrowAsset, amountToRepay', collateralAsset, borrowAsset, amountToRepay);
    IERC20(borrowAsset).safeTransfer(address(tetuConverter), amountToRepay);
    uint returnedBorrowAmountOut;
    (returnedAssetAmount, returnedBorrowAmountOut) = tetuConverter.repay(
      collateralAsset, borrowAsset, amountToRepay, address(this)
    );
    require(returnedBorrowAmountOut == 0, 'CSB: Can not convert back');

  }

  function _liquidate(ITetuLiquidator _liquidator, address tokenIn, address tokenOut, uint amountIn, uint slippage) internal {
    (ITetuLiquidator.PoolData[] memory route,/* string memory error*/)
    = _liquidator.buildRoute(tokenIn, tokenOut);

    if (route.length == 0) {
      revert('CSB: No liquidation route');
    }

    // calculate balance in out value for check threshold
    uint amountOut = _liquidator.getPriceForRoute(route, amountIn);

    // if the value higher than threshold distribute to destinations
    if (amountOut > thresholds[tokenOut]) {
      // we need to approve each time, liquidator address can be changed in controller
      _approveIfNeeded(tokenIn, amountIn, address(_liquidator));
      _liquidator.liquidateWithRoute(route, amountIn, slippage);
    }
  }

  /**
* @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
  uint[16] private __gap;

}
