// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../interfaces/converter/ITetuConverter.sol";
import "../interfaces/converter/ITetuConverterCallback.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/FixedPointMathLib.sol";
import "@tetu_io/tetu-contracts-v2/contracts/lib/InterfaceIds.sol";
import "@tetu_io/tetu-contracts-v2/contracts/test/IMockToken.sol";

/// @title Mock Tetu Converter contract.
/// @author bogdoslav
contract MockTetuConverter is ITetuConverter {
  using SafeERC20 for IERC20;
  using FixedPointMathLib for uint;

  address public controller;

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant TETU_CONVERTER_MOCK_VERSION = "1.0.0";

  /// @dev half of this will be applied on swap on borrow and half on swap on repay
  int public swapAprForPeriod36 = 0;

  /// @dev this apr will be added to debt on borrow
  int public borrowAprForPeriod36 = 0;

  /// @dev percentage of how much tokens will be borrowed from collateral
  uint public borrowRate2 = 50;

  /// @dev reward tokens and amounts to send to borrower on claimRewards()
  address[] public rewardTokens;
  uint[] public rewardAmounts;

  /// @dev msg.sender, collateral, borrow token, amounts
  mapping(address => mapping(address => mapping(address => uint))) public collaterals;
  mapping(address => mapping(address => mapping(address => uint))) public debts;

  constructor(address[] memory rewardTokens_, uint[] memory rewardAmounts_) {
    require(rewardTokens_.length == rewardAmounts_.length);

    for (uint i = 0; i < rewardTokens_.length; ++i) {
      rewardTokens.push(rewardTokens_[i]);
      rewardAmounts.push(rewardAmounts_[i]);
    }
  }

  /// @dev See {IERC165-supportsInterface}.
  function supportsInterface(bytes4 interfaceId) external view virtual returns (bool) {
    return interfaceId == InterfaceIds.I_TETU_CONVERTER;
    // || super.supportsInterface(interfaceId);
  }

  /// SETTERS

  function setSwapAprForPeriod36(int aprForPeriod36_) external {
    swapAprForPeriod36 = aprForPeriod36_;
  }

  function setBorrowAprForPeriod36(int aprForPeriod36_) external {
    borrowAprForPeriod36 = aprForPeriod36_;
  }

  function setBorrowRate2(uint borrowRate2_) external {
    borrowRate2 = borrowRate2_;
  }

  /// MATH

  function _calcMaxTargetAmount(address sourceToken, uint sourceAmount, address targetToken)
  internal view returns (uint maxTargetAmount) {
    maxTargetAmount = sourceAmount * borrowRate2 / 10 ** 2;
    maxTargetAmount = _convertDecimals(sourceToken, maxTargetAmount, targetToken);
  }

  function _calcSourceAmount(address sourceToken, address targetToken, uint targetAmount)
  internal view returns (uint sourceAmount) {
    sourceAmount = targetAmount * 10 ** 2 / borrowRate2;
    sourceAmount = _convertDecimals(targetToken, sourceAmount, sourceToken);
  }

  function _convertDecimals(address sourceToken, uint sourceAmount, address targetToken)
  internal view returns (uint targetAmount) {
    uint sourceDecimals = IMockToken(sourceToken).decimals();
    uint targetDecimals = IMockToken(targetToken).decimals();
    targetAmount = sourceDecimals == targetDecimals
    ? sourceAmount
    : sourceAmount * 10 ** targetDecimals / 10 ** sourceDecimals;
  }

  function findBorrowStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint /*periodInBlocks_*/
  ) override public view returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  ) {
    converter = address(1);
    maxTargetAmount = _calcMaxTargetAmount(sourceToken_, sourceAmount_, targetToken_);
    aprForPeriod36 = /*conversionMode == ConversionMode.SWAP_1 ? swapAprForPeriod36 :*/ borrowAprForPeriod36;
  }

  function findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_
  ) override external view returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  ) {
    return findBorrowStrategy(sourceToken_, sourceAmount_, targetToken_, periodInBlocks_);
  }

  function findSwapStrategy(
    address /*sourceToken_*/,
    uint /*sourceAmount_*/,
    address /*targetToken_*/
  ) override external pure returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  ) {
    converter = address(0);
    maxTargetAmount = 0;
    apr18 = 0;

    revert('MTC: Not implemented');
  }

  function borrow(
    address converter_,
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint amountToBorrow_,
    address receiver_
  ) override external returns (
    uint borrowedAmountTransferred
  ) {
    IMockToken(collateralAsset_).burn(address(this), collateralAmount_);

    uint maxTargetAmount = _calcMaxTargetAmount(collateralAsset_, collateralAmount_, borrowAsset_);

    require(converter_ == address(1), 'MTC: Wrong converter');
    require(amountToBorrow_ <= maxTargetAmount, 'MTC: amountToBorrow too big');
    borrowedAmountTransferred = amountToBorrow_;
    collaterals[msg.sender][collateralAsset_][borrowAsset_] += collateralAmount_;
    debts[msg.sender][collateralAsset_][borrowAsset_] += uint(int(borrowedAmountTransferred)
      + int(borrowedAmountTransferred) * borrowAprForPeriod36 / 10 ** 36);
    // apply apr

    IMockToken(borrowAsset_).mint(receiver_, borrowedAmountTransferred);

  }

  function repay(
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    address collateralReceiver_
  ) override external returns (
    uint collateralAmountTransferred,
    uint returnedBorrowAmountOut
  ) {
    IMockToken(borrowAsset_).burn(address(this), amountToRepay_);
    collateralAmountTransferred = 0;
    uint debt = debts[msg.sender][collateralAsset_][borrowAsset_];

    if (amountToRepay_ >= debt) {// close full debt
      delete debts[msg.sender][collateralAsset_][borrowAsset_];
      collateralAmountTransferred = collaterals[msg.sender][collateralAsset_][borrowAsset_];
      delete collaterals[msg.sender][collateralAsset_][borrowAsset_];
      // swap excess
      /*uint excess = amountToRepay_ - debt;
      if (excess > 0) {
        collateralAmountTransferred += _calcSourceAmount(uint(ConversionMode.SWAP_1), collateralAsset_, borrowAsset_, excess);
      }*/

    } else {// partial repay
      debts[msg.sender][collateralAsset_][borrowAsset_] -= amountToRepay_;
      collateralAmountTransferred = _calcSourceAmount(collateralAsset_, borrowAsset_, amountToRepay_);
      collaterals[msg.sender][collateralAsset_][borrowAsset_] -= collateralAmountTransferred;
    }

    IMockToken(collateralAsset_).mint(collateralReceiver_, collateralAmountTransferred);
    returnedBorrowAmountOut = 0;
    // stub
  }

  function estimateRepay(
    address /*collateralAsset_*/,
    uint /*collateralAmountRequired_*/,
    address /*borrowAsset_*/
  ) override external pure returns (
    uint borrowAssetAmount,
    uint unobtainableCollateralAssetAmount
  ) {
    borrowAssetAmount = 0;
    // stub for now
    unobtainableCollateralAssetAmount = 0;
    // stub for now

    revert('MTC: Not implemented');
  }

  function claimRewards(address receiver_) override external returns (
    address[] memory,
    uint[] memory
  ) {
    uint len = rewardTokens.length;
    for (uint i = 0; i < len; ++i) {
      IMockToken token = IMockToken(rewardTokens[i]);
      uint amount = rewardAmounts[i];
      token.mint(receiver_, amount);
    }
    return (rewardTokens, rewardAmounts);
  }

  ////////////////////////
  ///     CALLBACKS
  ////////////////////////

  function callRequireAmountBack(
    address borrower,
    address collateralAsset_,
    uint requiredAmountCollateralAsset_,
    address borrowAsset_,
    uint requiredAmountBorrowAsset_
  ) external returns (
    uint amountOut,
    bool isCollateral
  ) {
    (amountOut, isCollateral) = ITetuConverterCallback(borrower).requireAmountBack(
      collateralAsset_,
      requiredAmountCollateralAsset_,
      borrowAsset_,
      requiredAmountBorrowAsset_
    );

    if (isCollateral) {
      collaterals[borrower][collateralAsset_][borrowAsset_] += amountOut;
    } else {
      debts[borrower][collateralAsset_][borrowAsset_] -= amountOut;
    }
  }

  function callOnTransferBorrowedAmount(
    address borrower,
    address collateralAsset_,
    address borrowAsset_,
    uint amountBorrowAssetSentToBorrower_
  ) external {
    debts[borrower][collateralAsset_][borrowAsset_] += amountBorrowAssetSentToBorrower_;
    IMockToken(borrowAsset_).mint(borrower, amountBorrowAssetSentToBorrower_);

    ITetuConverterCallback(borrower).onTransferBorrowedAmount(
      collateralAsset_, borrowAsset_, amountBorrowAssetSentToBorrower_
    );
  }

  function getDebtAmountCurrent(
    address collateralAsset_,
    address borrowAsset_
  ) external override view returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    totalDebtAmountOut = debts[msg.sender][collateralAsset_][borrowAsset_];
    totalCollateralAmountOut = collaterals[msg.sender][collateralAsset_][borrowAsset_];
  }

  function getDebtAmountStored(
    address collateralAsset_,
    address borrowAsset_
  ) external override view returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    totalDebtAmountOut = debts[msg.sender][collateralAsset_][borrowAsset_];
    totalCollateralAmountOut = collaterals[msg.sender][collateralAsset_][borrowAsset_];
  }

  function quoteRepay(
    address /*collateralAsset_*/,
    address /*borrowAsset_*/,
    uint /*amountToRepay_*/
  ) external pure returns (
    uint collateralAmountOut
  ) {
    return 0;
  }


}
