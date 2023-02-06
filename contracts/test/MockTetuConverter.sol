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
contract MockTetuConverter is ITetuConverter {
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
  /// @notice keccak256(sourceToken, targetToken) => results
  mapping(bytes32 => FindBorrowStrategyOutputParams) public findBorrowStrategyOutputParams;
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
    bytes32 key = keccak256(abi.encodePacked(sourceToken_, targetToken_));
    FindBorrowStrategyOutputParams memory p = findBorrowStrategyOutputParams[key];
    if (sourceToken_ == p.sourceToken && targetToken_ == p.targetToken) {
      return (
        p.converter,
        p.maxTargetAmount,
        p.apr18
      );
    } else {
      console.log("findBorrowStrategy.missed", sourceToken_, sourceAmount_, targetToken_);
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
    console.log("setFindBorrowStrategyOutputParams", sourceToken_, sourceAmount_, targetToken_);
    bytes32 key = keccak256(abi.encodePacked(sourceToken_, targetToken_));
    findBorrowStrategyOutputParams[key] = FindBorrowStrategyOutputParams({
      converter: converter_,
      maxTargetAmount: maxTargetAmount_,
      apr18: apr18_,
      sourceAmount: sourceAmount_,
      sourceToken: sourceToken_,
      targetToken: targetToken_,
      periodInBlocks: periodInBlocks_
    });
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
  }
  /// @notice keccak256(sourceToken, targetToken) => results
  mapping(bytes32 => FindSwapStrategyOutputParams) public findSwapStrategyOutputParams;
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
    bytes32 key = keccak256(abi.encodePacked(sourceToken_, targetToken_));
    FindSwapStrategyOutputParams memory p = findSwapStrategyOutputParams[key];
    if (sourceToken_ == p.sourceToken && targetToken_ == p.targetToken) {
      return (p.converter, p.maxTargetAmount, p.apr18);
    } else {
      console.log("findSwapStrategy.missed", sourceToken_, sourceAmount_, targetToken_);
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
    console.log("setFindSwapStrategyOutputParams", sourceToken_, sourceAmount_, targetToken_);
    bytes32 key = keccak256(abi.encodePacked(sourceToken_, targetToken_));
    findSwapStrategyOutputParams[key] = FindSwapStrategyOutputParams({
      converter: converter_,
      maxTargetAmount: maxTargetAmount_,
      apr18: apr18_,
      sourceToken: sourceToken_,
      sourceAmount: sourceAmount_,
      targetToken: targetToken_
    });
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
  /// @notice keccak256(sourceToken, targetToken) => results
  mapping(bytes32 => FindConversionStrategyOutputParams) public findConversionStrategyOutputParams;
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

    bytes32 key = keccak256(abi.encodePacked(sourceToken_, targetToken_));
    FindConversionStrategyOutputParams memory p = findConversionStrategyOutputParams[key];
    if (sourceToken_ == p.sourceToken && targetToken_ == p.targetToken) {
      return (p.converter, p.maxTargetAmount, p.apr18);
    } else {
      console.log("findConversionStrategy.missed", sourceToken_, sourceAmount_, targetToken_);
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
    console.log("setFindConversionStrategyOutputParams", sourceToken_, sourceAmount_, targetToken_);
    bytes32 key = keccak256(abi.encodePacked(sourceToken_, targetToken_));
    findConversionStrategyOutputParams[key] = FindConversionStrategyOutputParams({
      converter: converter_,
      maxTargetAmount: maxTargetAmount_,
      apr18: apr18_,
      sourceAmount: sourceAmount_,
      sourceToken: sourceToken_,
      targetToken: targetToken_,
      periodInBlocks: periodInBlocks_
    });
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
  /// @notice keccak256(converter_, collateralAsset_, collateralAmount_, borrowAsset_) => results
  mapping(bytes32 => BorrowParams) public borrowParams;

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
    bytes32 key = keccak256(abi.encodePacked(converter_, collateralAsset_, collateralAmount_, borrowAsset_));
    BorrowParams memory p = borrowParams[key];
    if (converter_ == p.converter
      && collateralAsset_ == p.collateralAsset
      && collateralAmount_ == p.collateralAmount
      && borrowAsset_ == p.borrowAsset
    ) {
      IERC20Extended(collateralAsset_).transferFrom(msg.sender, address(this), collateralAmount_);

      uint balance = IERC20Extended(borrowAsset_).balanceOf(address(this));
      console.log("MockTetuConverterSingleCall.borrow.balance, amountToBorrow_", balance, amountToBorrow_);
      require(balance >= amountToBorrow_, "MockTetuConverterSingleCall.borrow.balance");
      IERC20Extended(borrowAsset_).transfer(receiver_, amountToBorrow_);

      return p.borrowedAmountOut;
    } else {
      console.log("MockTetuConverterSingleCall.borrow.missed, amountToBorrow_", collateralAsset_, collateralAmount_, borrowAsset_);
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
    console.log("setBorrowParams", collateralAsset_, collateralAmount_, borrowAsset_);
    bytes32 key = keccak256(abi.encodePacked(converter_, collateralAsset_, collateralAmount_, borrowAsset_));
    borrowParams[key] = BorrowParams({
      converter: converter_,
      collateralAsset: collateralAsset_,
      collateralAmount: collateralAmount_,
      borrowAsset: borrowAsset_,
      amountToBorrow: amountToBorrow_,
      receiver: receiver_,
      borrowedAmountOut: borrowedAmountOut_
    });
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
  /// @notice keccak256(collateralAsset_, borrowAsset_, amountToRepay_) => results
  mapping(bytes32 => RepayParams) public repayParams;

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

    bytes32 key = keccak256(abi.encodePacked(collateralAsset_, borrowAsset_, amountToRepay_));
    RepayParams memory p = repayParams[key];
    if (collateralAsset_ == p.collateralAsset
      && borrowAsset_ == p.borrowAsset
      && amountToRepay_ == p.amountToRepay
    ) {
      // transfer collateral back to the strategy
      uint balanceCollateral = IERC20Extended(collateralAsset_).balanceOf(address(this));
      console.log("MockTetuConverterSingleCall.repay balanceCollateral, collateralAmountOut", balanceCollateral, p.collateralAmountOut);
      require(
        balanceCollateral >= p.collateralAmountOut,
        "MockTetuConverterSingleCall.repay.collateralAmountOut"
      );
      IERC20Extended(collateralAsset_).transfer(receiver_, p.collateralAmountOut);

      // needToRepay was bigger than amountRepaid
      // we need to return the leftover back to the strategy
      uint balanceBorrow = IERC20Extended(borrowAsset_).balanceOf(address(this));
      console.log("MockTetuConverterSingleCall.repay balanceBorrow, returnedBorrowAmountOut", balanceBorrow, p.returnedBorrowAmountOut);
      if (p.returnedBorrowAmountOut != 0) {
        require(
          balanceBorrow >= p.returnedBorrowAmountOut,
          "MockTetuConverterSingleCall.repay.returnedBorrowAmountOut"
        );
        IERC20Extended(borrowAsset_).transfer(receiver_, p.returnedBorrowAmountOut);
      }

      return (
        p.collateralAmountOut,
        p.returnedBorrowAmountOut,
        p.swappedLeftoverCollateralOut,
        p.swappedLeftoverBorrowOut
      );
    } else {
      console.log("MockTetuConverterSingleCall.repay.missed collateral,borrow,amountToRepay", collateralAsset_, borrowAsset_, amountToRepay_);
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
    bytes32 key = keccak256(abi.encodePacked(collateralAsset_, borrowAsset_, amountToRepay_));
    repayParams[key] = RepayParams({
      collateralAsset: collateralAsset_,
      borrowAsset: borrowAsset_,
      amountToRepay: amountToRepay_,
      receiver: receiver_,
      collateralAmountOut: collateralAmountOut_,
      returnedBorrowAmountOut: returnedBorrowAmountOut_,
      swappedLeftoverCollateralOut: swappedLeftoverCollateralOut_,
      swappedLeftoverBorrowOut: swappedLeftoverBorrowOut_
    });
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
    console.log("MockTetuConverterSingleCall.quoteRepay user_", user_);

    if (
      quoteRepayParams.user == user_
    && quoteRepayParams.collateralAsset == collateralAsset_
    && quoteRepayParams.borrowAsset == borrowAsset_
    && quoteRepayParams.amountToRepay == amountToRepay_
    ) {
      console.log("MockTetuConverterSingleCall.quoteRepay collateralAmountOut", quoteRepayParams.collateralAmountOut);
      return quoteRepayParams.collateralAmountOut;
    } else {
      console.log("MockTetuConverterSingleCall.quoteRepay.quoteRepayParams.user == user_", quoteRepayParams.user == user_);
      console.log("MockTetuConverterSingleCall.quoteRepay.quoteRepayParams.collateralAsset == collateralAsset_", quoteRepayParams.collateralAsset == collateralAsset_);
      console.log("MockTetuConverterSingleCall.quoteRepay.quoteRepayParams.borrowAsset == borrowAsset_", quoteRepayParams.borrowAsset == borrowAsset_);
      console.log("MockTetuConverterSingleCall.quoteRepay.quoteRepayParams.amountToRepay == amountToRepay_", quoteRepayParams.amountToRepay == amountToRepay_);
      console.log("MockTetuConverterSingleCall.quoteRepay.missed collateralAsset,borrowAsset", quoteRepayParams.collateralAsset, quoteRepayParams.borrowAsset);
      console.log("MockTetuConverterSingleCall.quoteRepay.missed amountToRepay_,user,collateralAmountOut", quoteRepayParams.amountToRepay, quoteRepayParams.user, quoteRepayParams.collateralAmountOut);
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

  /// @notice keccak256(user_, collateralAsset_, borrowAsset_) => results
  mapping(bytes32 => GetDebtAmountParams) public getDebtAmountCurrentParams;
  function getDebtAmountCurrent(
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external view returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    console.log("MockTetuConverterSingleCall.getDebtAmountCurrent user,collateral,borrow", user_, collateralAsset_, borrowAsset_);

    bytes32 key = keccak256(abi.encodePacked(user_, collateralAsset_, borrowAsset_));
    GetDebtAmountParams memory p = getDebtAmountCurrentParams[key];
    if (
      p.user == user_
      && p.collateralAsset == collateralAsset_
      && p.borrowAsset == borrowAsset_
    ) {
      console.log("MockTetuConverterSingleCall.getDebtAmountCurrent totalDebtAmountOut,totalCollateralAmountOut",
        p.totalDebtAmountOut,
        p.totalCollateralAmountOut
      );
      return (
        p.totalDebtAmountOut,
        p.totalCollateralAmountOut
      );
    } else {
      console.log("MockTetuConverterSingleCall.getDebtAmountCurrent.missed user,collateral,borrow", user_, collateralAsset_, borrowAsset_);
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
    bytes32 key = keccak256(abi.encodePacked(user_, collateralAsset_, borrowAsset_));
    getDebtAmountCurrentParams[key] = GetDebtAmountParams({
      user: user_,
      collateralAsset: collateralAsset_,
      borrowAsset: borrowAsset_,
      totalCollateralAmountOut: totalCollateralAmountOut,
      totalDebtAmountOut: totalDebtAmountOut
    });
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
  struct ClaimRewardsParams {
    address[] rewardTokensOut;
    uint[] amountsOut;
  }
  ClaimRewardsParams private claimRewardsParams;

  function claimRewards(address receiver_) external returns (
    address[] memory rewardTokensOut,
    uint[] memory amountsOut
  ) {
    for (uint i = 0; i < claimRewardsParams.rewardTokensOut.length; ++i) {
      uint balance = IERC20Extended(claimRewardsParams.rewardTokensOut[i]).balanceOf(address(this));
      console.log("claimRewards asset, balance, amountOut", claimRewardsParams.rewardTokensOut[i], balance, claimRewardsParams.amountsOut[i]);
      IERC20Extended(claimRewardsParams.rewardTokensOut[i]).transfer(receiver_, claimRewardsParams.amountsOut[i]);
    }
    return (claimRewardsParams.rewardTokensOut, claimRewardsParams.amountsOut);
  }

  function setClaimRewards(address[] memory rewardTokensOut, uint[] memory amountsOut) external {
    claimRewardsParams = ClaimRewardsParams({
      rewardTokensOut: rewardTokensOut,
      amountsOut: amountsOut
    });
  }

}