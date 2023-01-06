// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../interfaces/converter/ITetuConverter.sol";
import "../interfaces/converter/ITetuConverterCallback.sol";
import "../interfaces/IERC20Extended.sol";
import "hardhat/console.sol";

/// @notice Mock of ITetuConverter, each function saves input params and has customizable output value
///         Some functions can be not implemented
/// @dev We assume, that in each test only single function is called, so we can setup behavior before the call
///      and check results after the call on the side of the script
contract MockTetuConverterSingleCall is ITetuConverter {
  //////////////////////////////////////////////////////////
  ///  Controller
  //////////////////////////////////////////////////////////
  address public _controller;
  function controller() external view returns (address) {
    return _controller;
  }
  function setController(address controller_) external {
    _controller = controller_;
  }


  //////////////////////////////////////////////////////////
  ///  findBorrowStrategy
  //////////////////////////////////////////////////////////
  struct FindBorrowStrategyOutputParams {
    address converter;
    uint maxTargetAmount;
    int apr18;

    address sourceToken;
    uint sourceAmount;
    address targetToken;
    uint periodInBlocks;
  }
  FindBorrowStrategyOutputParams public findBorrowStrategyOutputParams;
  function findBorrowStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint /*periodInBlocks_*/
  ) external view returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  ) {
    console.log("MockTetuConverterSingleCall.findBorrowStrategy token,amount", sourceToken_, sourceAmount_);
    if (
      sourceToken_ == findBorrowStrategyOutputParams.sourceToken
      && sourceAmount_ == findBorrowStrategyOutputParams.sourceAmount
      && targetToken_ == findBorrowStrategyOutputParams.targetToken
      // && periodInBlocks_ == findBorrowStrategyOutputParams.periodInBlocks
    ) {
      return (
        findBorrowStrategyOutputParams.converter,
        findBorrowStrategyOutputParams.maxTargetAmount,
        findBorrowStrategyOutputParams.apr18
      );
    } else {
      return (converter, maxTargetAmount, apr18);
    }
  }
  function setFindBorrowStrategyOutputParams(
    address converter_,
    uint maxTargetAmount_,
    int apr18_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_
  ) external {
    findBorrowStrategyOutputParams.converter = converter_;
    findBorrowStrategyOutputParams.maxTargetAmount = maxTargetAmount_;
    findBorrowStrategyOutputParams.apr18 = apr18_;
    findBorrowStrategyOutputParams.sourceAmount = sourceAmount_;
    findBorrowStrategyOutputParams.sourceToken = sourceToken_;
    findBorrowStrategyOutputParams.targetToken = targetToken_;
    findBorrowStrategyOutputParams.periodInBlocks = periodInBlocks_;
  }

  //////////////////////////////////////////////////////////
  ///  findSwapStrategy
  //////////////////////////////////////////////////////////
  struct FindSwapStrategyOutputParams {
    address converter;
    uint maxTargetAmount;
    int apr18;

    address sourceToken;
    uint sourceAmount;
    address targetToken;
    uint periodInBlocks;
  }
  FindSwapStrategyOutputParams public findSwapStrategyOutputParams;
  function findSwapStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external view returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  ) {
    console.log("MockTetuConverterSingleCall.findSwapStrategy token,amount", sourceToken_, sourceAmount_);
    if (
      sourceToken_ == findBorrowStrategyOutputParams.sourceToken
      && sourceAmount_ == findBorrowStrategyOutputParams.sourceAmount
      && targetToken_ == findBorrowStrategyOutputParams.targetToken
    ) {
      return (
        findSwapStrategyOutputParams.converter,
        findSwapStrategyOutputParams.maxTargetAmount,
        findSwapStrategyOutputParams.apr18
      );
    } else {
      return (converter, maxTargetAmount, apr18);
    }
  }

  function setFindSwapStrategyOutputParams(
    address converter_,
    uint maxTargetAmount_,
    int apr18_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external {
    findSwapStrategyOutputParams.converter = converter_;
    findSwapStrategyOutputParams.maxTargetAmount = maxTargetAmount_;
    findSwapStrategyOutputParams.apr18 = apr18_;
    findSwapStrategyOutputParams.sourceToken = sourceToken_;
    findSwapStrategyOutputParams.sourceAmount = sourceAmount_;
    findSwapStrategyOutputParams.targetToken = targetToken_;
  }

  //////////////////////////////////////////////////////////
  ///  findConversionStrategy
  //////////////////////////////////////////////////////////
  struct FindConversionStrategyOutputParams {
    address converter;
    uint maxTargetAmount;
    int apr18;

    address sourceToken;
    uint sourceAmount;
    address targetToken;
    uint periodInBlocks;
  }
  FindConversionStrategyOutputParams public findConversionStrategyOutputParams;
  function findConversionStrategy(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint /*periodInBlocks_*/
  ) external view returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  ) {
    console.log("MockTetuConverterSingleCall.findConversionStrategy token,amount", sourceToken_, sourceAmount_);

    if (
      sourceToken_ == findBorrowStrategyOutputParams.sourceToken
      && sourceAmount_ == findBorrowStrategyOutputParams.sourceAmount
      && targetToken_ == findBorrowStrategyOutputParams.targetToken
      // && periodInBlocks_ == findBorrowStrategyOutputParams.periodInBlocks
    ) {
      return (
        findConversionStrategyOutputParams.converter,
        findConversionStrategyOutputParams.maxTargetAmount,
        findConversionStrategyOutputParams.apr18
      );
    } else {
      return (converter, maxTargetAmount, apr18);
    }
  }
  function setFindConversionStrategyOutputParams(
    address converter_,
    uint maxTargetAmount_,
    int apr18_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_
  ) external {
    findConversionStrategyOutputParams.converter = converter_;
    findConversionStrategyOutputParams.maxTargetAmount = maxTargetAmount_;
    findConversionStrategyOutputParams.apr18 = apr18_;
    findConversionStrategyOutputParams.sourceAmount = sourceAmount_;
    findConversionStrategyOutputParams.sourceToken = sourceToken_;
    findConversionStrategyOutputParams.targetToken = targetToken_;
    findConversionStrategyOutputParams.periodInBlocks = periodInBlocks_;
  }
  //////////////////////////////////////////////////////////
  ///  borrow
  //////////////////////////////////////////////////////////
  struct BorrowParams {
    uint borrowedAmountOut;

    address converter;
    address collateralAsset;
    uint collateralAmount;
    address borrowAsset;
    uint amountToBorrow;
    address receiver;
  }
  BorrowParams public borrowParams;

  function borrow(
    address converter_,
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint amountToBorrow_,
    address receiver_
  ) external returns (
    uint borrowedAmountOut
  ) {
    console.log("MockTetuConverterSingleCall.borrow token,amount", collateralAsset_, collateralAmount_);
    if (
      borrowParams.converter == converter_
    && borrowParams.collateralAsset == collateralAsset_
    && borrowParams.collateralAmount == collateralAmount_
    && borrowParams.borrowAsset == borrowAsset_
    && borrowParams.amountToBorrow == amountToBorrow_
    ) {
      IERC20Extended(collateralAsset_).transferFrom(msg.sender, address(this), collateralAmount_);

      require(IERC20Extended(borrowAsset_).balanceOf(address(this)) >= amountToBorrow_, "MockTetuConverterSingleCall.borrow.balance");
      IERC20Extended(borrowAsset_).transfer(receiver_, amountToBorrow_);

      return borrowParams.borrowedAmountOut;
    } else {
      return 0;
    }
  }
  function setBorrowParams(
    address converter_,
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint amountToBorrow_,
    address receiver_,
    uint borrowedAmountOut_
  ) external {
    borrowParams.converter = converter_;
    borrowParams.collateralAsset = collateralAsset_;
    borrowParams.collateralAmount = collateralAmount_;
    borrowParams.borrowAsset = borrowAsset_;
    borrowParams.amountToBorrow = amountToBorrow_;
    borrowParams.receiver = receiver_;
    borrowParams.borrowedAmountOut = borrowedAmountOut_;
  }

  //////////////////////////////////////////////////////////
  ///  repay
  //////////////////////////////////////////////////////////
  struct RepayParams {
    address collateralAsset;
    address borrowAsset;
    uint amountToRepay;
    address receiver;
    uint collateralAmountOut;
    uint returnedBorrowAmountOut;
    uint swappedLeftoverCollateralOut;
    uint swappedLeftoverBorrowOut;
  }
  RepayParams public repayParams;

  function repay(
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    address receiver_
  ) external returns (
    uint collateralAmountOut,
    uint returnedBorrowAmountOut,
    uint swappedLeftoverCollateralOut,
    uint swappedLeftoverBorrowOut
  ) {
    console.log("MockTetuConverterSingleCall.repay collateral,borrow,amount", collateralAsset_, borrowAsset_, amountToRepay_);

    require(IERC20Extended(borrowAsset_).balanceOf(address(this)) == amountToRepay_, "MockTetuConverterSingleCall.repay.amountToRepay_");

    if (
      repayParams.collateralAsset == collateralAsset_
    && repayParams.borrowAsset == borrowAsset_
    && repayParams.amountToRepay == amountToRepay_
    // && repayParams.receiver == receiver_
    ) {
      require(
        IERC20Extended(collateralAsset_).balanceOf(address(this)) == repayParams.collateralAmountOut,
        "MockTetuConverterSingleCall.repay.collateralAmountOut"
      );
      IERC20Extended(collateralAsset_).transfer(receiver_, repayParams.collateralAmountOut);

      if (repayParams.returnedBorrowAmountOut != 0) {
        require(
          IERC20Extended(borrowAsset_).balanceOf(address(this)) == repayParams.returnedBorrowAmountOut,
          "MockTetuConverterSingleCall.repay.returnedBorrowAmountOut"
        );
        IERC20Extended(borrowAsset_).transfer(receiver_, repayParams.returnedBorrowAmountOut);
      }

      return (
        repayParams.collateralAmountOut,
        repayParams.returnedBorrowAmountOut,
        repayParams.swappedLeftoverCollateralOut,
        repayParams.swappedLeftoverBorrowOut
      );
    } else {
      console.log("MockTetuConverterSingleCall.repay.missed collateral,borrow,amount", repayParams.collateralAsset, repayParams.borrowAsset, repayParams.amountToRepay);
      return (collateralAmountOut, returnedBorrowAmountOut, swappedLeftoverCollateralOut, swappedLeftoverBorrowOut);
    }
  }

  function setRepay(
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    address receiver_,
    uint collateralAmountOut_,
    uint returnedBorrowAmountOut_,
    uint swappedLeftoverCollateralOut_,
    uint swappedLeftoverBorrowOut_
  ) external {
    repayParams.collateralAsset = collateralAsset_;
    repayParams.borrowAsset = borrowAsset_;
    repayParams.amountToRepay = amountToRepay_;
    repayParams.receiver = receiver_;
    repayParams.collateralAmountOut = collateralAmountOut_;
    repayParams.returnedBorrowAmountOut = returnedBorrowAmountOut_;
    repayParams.swappedLeftoverCollateralOut = swappedLeftoverCollateralOut_;
    repayParams.swappedLeftoverBorrowOut = swappedLeftoverBorrowOut_;
  }

  //////////////////////////////////////////////////////////
  ///  quoteRepay
  //////////////////////////////////////////////////////////
  struct QuoteRepayParams {
    address user;
    address collateralAsset;
    address borrowAsset;
    uint amountToRepay;
    uint collateralAmountOut;
  }
  QuoteRepayParams public quoteRepayParams;

  function quoteRepay(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_
  ) external view returns (
    uint collateralAmountOut
  ) {
    console.log("MockTetuConverterSingleCall.quoteRepay collateral,borrow,amount", collateralAsset_, borrowAsset_, amountToRepay_);

    if (
      quoteRepayParams.user == user_
    && quoteRepayParams.collateralAsset == collateralAsset_
    && quoteRepayParams.borrowAsset == borrowAsset_
    && quoteRepayParams.amountToRepay == amountToRepay_
    ) {
      return quoteRepayParams.collateralAmountOut;
    } else {
      return 0;
    }
  }
  function setQuoteRepay(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    uint collateralAmountOut
  ) external {
    quoteRepayParams.user = user_;
    quoteRepayParams.collateralAsset = collateralAsset_;
    quoteRepayParams.borrowAsset = borrowAsset_;
    quoteRepayParams.amountToRepay = amountToRepay_;
    quoteRepayParams.collateralAmountOut = collateralAmountOut;
  }

  //////////////////////////////////////////////////////////
  ///  getDebtAmountCurrent
  //////////////////////////////////////////////////////////
  struct GetDebtAmountParams {
    address user;
    address collateralAsset;
    address borrowAsset;
    uint totalDebtAmountOut;
    uint totalCollateralAmountOut;
  }
  GetDebtAmountParams public getDebtAmountCurrentParams;
  function getDebtAmountCurrent(
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external view returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    console.log("MockTetuConverterSingleCall.getDebtAmountCurrent user,collateral,borrow", user_, collateralAsset_, borrowAsset_);

    if (
      getDebtAmountCurrentParams.user == user_
    && getDebtAmountCurrentParams.collateralAsset == collateralAsset_
    && getDebtAmountCurrentParams.borrowAsset == borrowAsset_
    ) {
      console.log("MockTetuConverterSingleCall.getDebtAmountCurrent totalDebtAmountOut,totalCollateralAmountOut",
        getDebtAmountCurrentParams.totalDebtAmountOut,
        getDebtAmountCurrentParams.totalCollateralAmountOut
      );
      return (
        getDebtAmountCurrentParams.totalDebtAmountOut,
        getDebtAmountCurrentParams.totalCollateralAmountOut
      );
    } else {
      console.log("MockTetuConverterSingleCall.getDebtAmountCurrent.missed user,collateral,borrow", getDebtAmountCurrentParams.user, getDebtAmountCurrentParams.collateralAsset, getDebtAmountCurrentParams.borrowAsset);
      return (0, 0);
    }
  }
  function setGetDebtAmountCurrent(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) external {
    getDebtAmountCurrentParams.user = user_;
    getDebtAmountCurrentParams.collateralAsset = collateralAsset_;
    getDebtAmountCurrentParams.borrowAsset = borrowAsset_;
    getDebtAmountCurrentParams.totalCollateralAmountOut = totalCollateralAmountOut;
    getDebtAmountCurrentParams.totalDebtAmountOut = totalDebtAmountOut;
  }

  //////////////////////////////////////////////////////////
  ///  getDebtAmountStored
  //////////////////////////////////////////////////////////
  GetDebtAmountParams public getDebtAmountStoredParams;
  function getDebtAmountStored(
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external view returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    console.log("MockTetuConverterSingleCall.getDebtAmountStored user,collateral,borrow", user_, collateralAsset_, borrowAsset_);

    if (
      getDebtAmountStoredParams.user == user_
      && getDebtAmountStoredParams.collateralAsset == collateralAsset_
      && getDebtAmountStoredParams.borrowAsset == borrowAsset_
    ) {
      return (
        getDebtAmountStoredParams.totalDebtAmountOut,
        getDebtAmountStoredParams.totalCollateralAmountOut
      );
    } else {
      return (0, 0);
    }
  }
  function setGetDebtAmountStored(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) external {
    getDebtAmountStoredParams.user = user_;
    getDebtAmountStoredParams.collateralAsset = collateralAsset_;
    getDebtAmountStoredParams.borrowAsset = borrowAsset_;
    getDebtAmountStoredParams.totalCollateralAmountOut = totalCollateralAmountOut;
    getDebtAmountStoredParams.totalDebtAmountOut = totalDebtAmountOut;
  }

  //////////////////////////////////////////////////////////
  ///  estimateRepay
  //////////////////////////////////////////////////////////
  function estimateRepay(
    address user_,
    address collateralAsset_,
    uint collateralAmountRequired_,
    address borrowAsset_
  ) external pure returns (
    uint borrowAssetAmount,
    uint unobtainableCollateralAssetAmount
  ) {
    user_;
    collateralAsset_;
    collateralAmountRequired_;
    borrowAsset_;
    borrowAssetAmount;
    unobtainableCollateralAssetAmount;
    revert ("not implemented");
  }

  //////////////////////////////////////////////////////////
  ///  claimRewards
  //////////////////////////////////////////////////////////
  function claimRewards(address receiver_) external pure returns (
    address[] memory rewardTokensOut,
    uint[] memory amountsOut
  ) {
    receiver_;
    rewardTokensOut;
    amountsOut;
    revert ("not implemented");
  }

}