// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverterCallback.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/IConverterController.sol";
import "../../libs/AppErrors.sol";

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
    bytes entryData;
    address[] converters;
    uint[] collateralAmountsOut;
    uint[] amountsToBorrowOut;
    int[] aprs18;

    address sourceToken;
    uint sourceAmount;
    address targetToken;
    uint periodInBlocks;
  }
  /// @notice keccak256(entryData, sourceToken, targetToken) => results
  mapping(bytes32 => FindBorrowStrategyOutputParams) public findBorrowStrategyOutputParams;

  function findBorrowStrategies(
    bytes memory entryData_,
    address sourceToken_,
    uint amountIn_,
    address targetToken_,
    uint periodInBlocks_
  ) external view returns (
    address[] memory converters,
    uint[] memory collateralAmountsOut,
    uint[] memory amountsToBorrowOut,
    int[] memory aprs18
  ) {
    periodInBlocks_;
    console.log("MockTetuConverter.findBorrowStrategies token,amountIn", sourceToken_, amountIn_);
    bytes32 key = keccak256(abi.encodePacked(entryData_, sourceToken_, targetToken_));
    FindBorrowStrategyOutputParams memory p = findBorrowStrategyOutputParams[key];
    console.log("MockTetuConverter.p.sourceToken", p.sourceToken);
    if (sourceToken_ == p.sourceToken) {
      return (
      p.converters,
      p.collateralAmountsOut,
      p.amountsToBorrowOut,
      p.aprs18
      );
    } else {
      console.log("findBorrowStrategy.missed", _tokenName(sourceToken_), amountIn_, _tokenName(targetToken_));
      return (converters, collateralAmountsOut, amountsToBorrowOut, aprs18);
    }
  }

  function setFindBorrowStrategyOutputParams(
    bytes memory entryData_,
    address[] memory converters_,
    uint[] memory collateralAmountsOut_,
    uint[] memory amountToBorrowsOut_,
    int[] memory aprs18_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_
  ) external {
    console.log("setFindBorrowStrategyOutputParams", sourceToken_, sourceAmount_, targetToken_);
    bytes32 key = keccak256(abi.encodePacked(entryData_, sourceToken_, targetToken_));
    findBorrowStrategyOutputParams[key] = FindBorrowStrategyOutputParams({
    entryData : entryData_,
    converters : converters_,
    collateralAmountsOut : collateralAmountsOut_,
    amountsToBorrowOut : amountToBorrowsOut_,
    aprs18 : aprs18_,
    sourceAmount : sourceAmount_,
    sourceToken : sourceToken_,
    targetToken : targetToken_,
    periodInBlocks : periodInBlocks_
    });
  }

  //////////////////////////////////////////////////////////
  ///  findSwapStrategy
  //////////////////////////////////////////////////////////
  struct FindSwapStrategyOutputParams {
    bytes entryData;
    address converter;
    uint sourceAmountOut;
    uint targetAmountOut;
    int apr18;

    address sourceToken;
    uint sourceAmount;
    address targetToken;
  }
  /// @notice keccak256(entryData_, sourceToken, targetToken) => results
  mapping(bytes32 => FindSwapStrategyOutputParams) public findSwapStrategyOutputParams;

  function findSwapStrategy(
    bytes memory entryData_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external view returns (
    address converter,
    uint sourceAmountOut,
    uint targetAmountOut,
    int apr18
  ) {
    console.log("MockTetuConverter.findSwapStrategy token,amount", sourceToken_, sourceAmount_);
    bytes32 key = keccak256(abi.encodePacked(entryData_, sourceToken_, targetToken_));
    FindSwapStrategyOutputParams memory p = findSwapStrategyOutputParams[key];
    if (sourceToken_ == p.sourceToken) {
      return (p.converter, p.sourceAmountOut, p.targetAmountOut, p.apr18);
    } else {
      console.log("findSwapStrategy.missed", _tokenName(sourceToken_), sourceAmount_, _tokenName(targetToken_));
      return (converter, sourceAmountOut, targetAmountOut, apr18);
    }
  }

  function setFindSwapStrategyOutputParams(
    bytes memory entryData_,
    address converter_,
    uint sourceAmountOut_,
    uint targetAmountOut_,
    int apr18_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external {
    console.log("setFindSwapStrategyOutputParams", sourceToken_, sourceAmount_, targetToken_);
    bytes32 key = keccak256(abi.encodePacked(sourceToken_, targetToken_));
    findSwapStrategyOutputParams[key] = FindSwapStrategyOutputParams({
    entryData : entryData_,
    converter : converter_,
    sourceAmountOut : sourceAmountOut_,
    targetAmountOut : targetAmountOut_,
    apr18 : apr18_,
    sourceToken : sourceToken_,
    sourceAmount : sourceAmount_,
    targetToken : targetToken_
    });
  }

  //////////////////////////////////////////////////////////
  ///  findConversionStrategy
  //////////////////////////////////////////////////////////
  struct FindConversionStrategyOutputParams {
    bytes entryData;
    address converter;
    uint amountToBorrowOut;
    uint collateralAmountOut;
    int apr18;

    address sourceToken;
    uint sourceAmount;
    address targetToken;
    uint periodInBlocks;
  }
  /// @notice keccak256(entryData, sourceToken, targetToken) => results
  mapping(bytes32 => FindConversionStrategyOutputParams) public findConversionStrategyOutputParams;

  function findConversionStrategy(
    bytes memory entryData_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_
  ) external view returns (
    address converter,
    uint collateralAmountOut,
    uint amountToBorrowOut,
    int apr18
  ) {
    periodInBlocks_;
    console.log("MockTetuConverter.findConversionStrategy token,amount", sourceToken_, sourceAmount_);

    bytes32 key = keccak256(abi.encodePacked(entryData_, sourceToken_, targetToken_));
    FindConversionStrategyOutputParams memory p = findConversionStrategyOutputParams[key];
    if (sourceToken_ == p.sourceToken) {
      return (p.converter, p.collateralAmountOut, p.amountToBorrowOut, p.apr18);
    } else {
      console.log("findConversionStrategy.missed", _tokenName(sourceToken_), sourceAmount_, _tokenName(targetToken_));
      return (converter, collateralAmountOut, amountToBorrowOut, apr18);
    }
  }

  function setFindConversionStrategyOutputParams(
    bytes memory entryData_,
    address converter_,
    uint collateralAmountOut_,
    uint amountToBorrowOut_,
    int apr18_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint periodInBlocks_
  ) external {
    console.log("setFindConversionStrategyOutputParams", sourceToken_, sourceAmount_, targetToken_);
    bytes32 key = keccak256(abi.encodePacked(entryData_, sourceToken_, targetToken_));
    findConversionStrategyOutputParams[key] = FindConversionStrategyOutputParams({
    entryData : entryData_,
    converter : converter_,
    collateralAmountOut : collateralAmountOut_,
    amountToBorrowOut : amountToBorrowOut_,
    apr18 : apr18_,
    sourceAmount : sourceAmount_,
    sourceToken : sourceToken_,
    targetToken : targetToken_,
    periodInBlocks : periodInBlocks_
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
    console.log("MockTetuConverter.borrow token,amount", _tokenName(collateralAsset_), collateralAmount_);
    bytes32 key = keccak256(abi.encodePacked(converter_, collateralAsset_, collateralAmount_, borrowAsset_));
    BorrowParams memory p = borrowParams[key];
    if (converter_ == p.converter
    && collateralAsset_ == p.collateralAsset
    && collateralAmount_ == p.collateralAmount
      && borrowAsset_ == p.borrowAsset
    ) {
      IERC20Metadata(collateralAsset_).transferFrom(msg.sender, address(this), collateralAmount_);

      uint balance = IERC20Metadata(borrowAsset_).balanceOf(address(this));
      console.log("MockTetuConverter.borrow.balance, amountToBorrow_", balance, amountToBorrow_);
      require(balance >= amountToBorrow_, "MockTetuConverter.borrow.balance");
      IERC20Metadata(borrowAsset_).transfer(receiver_, amountToBorrow_);

      return p.borrowedAmountOut;
    } else {
      console.log("MockTetuConverter.borrow.missed.collateralAsset_", _tokenName(collateralAsset_));
      console.log("MockTetuConverter.borrow.missed.collateralAmount_", collateralAmount_);
      console.log("MockTetuConverter.borrow.missed.borrowAsset_", _tokenName(borrowAsset_));
      console.log("MockTetuConverter.borrow.missed.amountToBorrow_", amountToBorrow_);
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
    converter : converter_,
    collateralAsset : collateralAsset_,
    collateralAmount : collateralAmount_,
    borrowAsset : borrowAsset_,
    amountToBorrow : amountToBorrow_,
    receiver : receiver_,
    borrowedAmountOut : borrowedAmountOut_
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
    uint debtGapValue;
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
    console.log("MockTetuConverter.repay collateral,borrow,amount", _tokenName(collateralAsset_), _tokenName(borrowAsset_), amountToRepay_);

    require(IERC20Metadata(borrowAsset_).balanceOf(address(this)) == amountToRepay_, "MockTetuConverter.repay.amountToRepay_");

    bytes32 key = keccak256(abi.encodePacked(collateralAsset_, borrowAsset_, amountToRepay_));
    RepayParams memory p = repayParams[key];
    if (collateralAsset_ == p.collateralAsset && borrowAsset_ == p.borrowAsset && amountToRepay_ == p.amountToRepay) {
      // transfer collateral back to the strategy
      uint balanceCollateral = IERC20Metadata(collateralAsset_).balanceOf(address(this));
      console.log("MockTetuConverter.repay balanceCollateral, collateralAmountOut", balanceCollateral, p.collateralAmountOut);
      require(balanceCollateral >= p.collateralAmountOut, "MockTetuConverter.repay.collateralAmountOut");
      IERC20Metadata(collateralAsset_).transfer(receiver_, p.collateralAmountOut);

      // return debtGap if any
      uint balanceBorrow = IERC20Metadata(borrowAsset_).balanceOf(address(this));
      if (p.debtGapValue != 0) {
        require(balanceBorrow >= p.debtGapValue, "MockTetuConverter.repay.debtGapValue");
        IERC20Metadata(borrowAsset_).transfer(receiver_, p.debtGapValue);
      }

      // needToRepay was bigger than amountRepaid, we need to return the leftover back to the strategy
      balanceBorrow = IERC20Metadata(borrowAsset_).balanceOf(address(this));
      console.log("MockTetuConverter.repay balanceBorrow, returnedBorrowAmountOut", balanceBorrow, p.returnedBorrowAmountOut);
      if (p.returnedBorrowAmountOut != 0) {
        require(balanceBorrow >= p.returnedBorrowAmountOut, "MockTetuConverter.repay.returnedBorrowAmountOut");
        IERC20Metadata(borrowAsset_).transfer(receiver_, p.returnedBorrowAmountOut);
      }

      return (
        p.collateralAmountOut,
        p.returnedBorrowAmountOut,
        p.swappedLeftoverCollateralOut,
        p.swappedLeftoverBorrowOut
      );
    } else {
      console.log("MockTetuConverter.repay.missed collateral,borrow,amountToRepay", _tokenName(collateralAsset_), _tokenName(borrowAsset_), amountToRepay_);
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
    uint swappedLeftoverBorrowOut_,
    uint debtGapValue
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
      swappedLeftoverBorrowOut: swappedLeftoverBorrowOut_,
      debtGapValue: debtGapValue
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
    uint swappedAmountOut;
  }
  /// @notice keccak256(collateralAsset_, borrowAsset_, amountToRepay_) => results
  mapping(bytes32 => QuoteRepayParams) public quoteRepayParams;

  function quoteRepay(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_
  ) external view returns (
    uint collateralAmountOut,
    uint swappedAmountOut
  ) {
    user_;
    // hide warning
    console.log("MockTetuConverter.quoteRepay collateral,borrow,amount", _tokenName(collateralAsset_), _tokenName(borrowAsset_), amountToRepay_);

    bytes32 key = keccak256(abi.encodePacked(collateralAsset_, borrowAsset_, amountToRepay_));
    QuoteRepayParams memory p = quoteRepayParams[key];
    if (p.collateralAsset == collateralAsset_) {
      return (p.collateralAmountOut, p.swappedAmountOut);
    } else {
      console.log("MockTetuConverter.quoteRepay.missed amountToRepay_,collateralAsset_,borrowAsset_", amountToRepay_, _tokenName(collateralAsset_), _tokenName(borrowAsset_));
      return (0, 0);
    }
  }

  function setQuoteRepay(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    uint amountToRepay_,
    uint collateralAmountOut,
    uint swappedAmountOut
  ) external {
    bytes32 key = keccak256(abi.encodePacked(collateralAsset_, borrowAsset_, amountToRepay_));
    quoteRepayParams[key] = QuoteRepayParams({
      user: user_,
      collateralAsset: collateralAsset_,
      borrowAsset: borrowAsset_,
      amountToRepay: amountToRepay_,
      collateralAmountOut: collateralAmountOut,
      swappedAmountOut: swappedAmountOut
    });
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
    bool useDebtGap;
  }

  /// @notice keccak256(user_, collateralAsset_, borrowAsset_, useDebtGap_) => results
  mapping(bytes32 => GetDebtAmountParams) public getDebtAmountCurrentParams;

  function getDebtAmountCurrent(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    bool useDebtGap_
  ) external view returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    console.log("MockTetuConverter.getDebtAmountCurrent user,collateral,borrow", user_, _tokenName(collateralAsset_), _tokenName(borrowAsset_));

    bytes32 key = keccak256(abi.encodePacked(user_, collateralAsset_, borrowAsset_, useDebtGap_));
    GetDebtAmountParams memory p = getDebtAmountCurrentParams[key];
    if (
      p.user == user_
      && p.collateralAsset == collateralAsset_
      && p.borrowAsset == borrowAsset_
    ) {
      console.log("MockTetuConverter.getDebtAmountCurrent totalDebtAmountOut,totalCollateralAmountOut",
        p.totalDebtAmountOut,
        p.totalCollateralAmountOut
      );
      return (
        p.totalDebtAmountOut,
        p.totalCollateralAmountOut
      );
    } else {
      console.log("MockTetuConverter.getDebtAmountCurrent.missed user,collateral,borrow", user_, _tokenName(collateralAsset_), _tokenName(borrowAsset_));
      console.log("MockTetuConverter.getDebtAmountCurrent.missed useDebtGap", useDebtGap_);
      return (0, 0);
    }
  }

  function setGetDebtAmountCurrent(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut,
    bool useDebtGap
  ) external {
    bytes32 key = keccak256(abi.encodePacked(user_, collateralAsset_, borrowAsset_, useDebtGap));
    getDebtAmountCurrentParams[key] = GetDebtAmountParams({
      user: user_,
      collateralAsset: collateralAsset_,
      borrowAsset: borrowAsset_,
      totalCollateralAmountOut: totalCollateralAmountOut,
      totalDebtAmountOut: totalDebtAmountOut,
      useDebtGap: useDebtGap
    });
  }

  //////////////////////////////////////////////////////////
  ///  getDebtAmountStored
  //////////////////////////////////////////////////////////
  /// @notice keccak256(user_, collateralAsset_, borrowAsset_, useDebtGap_) => results
  mapping(bytes32 => GetDebtAmountParams) public getDebtAmountStoredParams;

  function getDebtAmountStored(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    bool useDebtGap_
  ) external view returns (
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut
  ) {
    console.log("MockTetuConverter.getDebtAmountStored user,collateral,borrow", user_, _tokenName(collateralAsset_), _tokenName(borrowAsset_));

    bytes32 key = keccak256(abi.encodePacked(user_, collateralAsset_, borrowAsset_, useDebtGap_));
    GetDebtAmountParams memory p = getDebtAmountCurrentParams[key];
    if (p.user == user_) {
      console.log("MockTetuConverter.getDebtAmountStored totalDebtAmountOut,totalCollateralAmountOut,useDebtGap_",
        p.totalDebtAmountOut,
        p.totalCollateralAmountOut,
        useDebtGap_
      );
      return (
        p.totalDebtAmountOut,
        p.totalCollateralAmountOut
      );
    } else {
      console.log("MockTetuConverter.getDebtAmountStored.missed user,collateral,borrow", user_, _tokenName(collateralAsset_), _tokenName(borrowAsset_));
      console.log("MockTetuConverter.getDebtAmountStored.missed useDebtGap_", useDebtGap_);
      return (0, 0);
    }
  }

  function setGetDebtAmountStored(
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    uint totalDebtAmountOut,
    uint totalCollateralAmountOut,
    bool useDebtGap
  ) external {
    bytes32 key = keccak256(abi.encodePacked(user_, collateralAsset_, borrowAsset_, useDebtGap));
    getDebtAmountStoredParams[key] = GetDebtAmountParams({
      user: user_,
      collateralAsset: collateralAsset_,
      borrowAsset: borrowAsset_,
      totalCollateralAmountOut: totalCollateralAmountOut,
      totalDebtAmountOut: totalDebtAmountOut,
      useDebtGap: useDebtGap
    });
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
    revert ("estimateRepay is not implemented");
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
      uint balance = IERC20Metadata(claimRewardsParams.rewardTokensOut[i]).balanceOf(address(this));
      console.log("claimRewards asset, balance, amountOut", claimRewardsParams.rewardTokensOut[i], balance, claimRewardsParams.amountsOut[i]);
      IERC20Metadata(claimRewardsParams.rewardTokensOut[i]).transfer(receiver_, claimRewardsParams.amountsOut[i]);
    }
    return (claimRewardsParams.rewardTokensOut, claimRewardsParams.amountsOut);
  }

  function setClaimRewards(address[] memory rewardTokensOut, uint[] memory amountsOut) external {
    claimRewardsParams = ClaimRewardsParams({
    rewardTokensOut : rewardTokensOut,
    amountsOut : amountsOut
    });
  }

  //////////////////////////////////////////////////////////
  ///  Safe liquidation
  //////////////////////////////////////////////////////////
  function safeLiquidate(
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    address receiver_,
    uint priceImpactToleranceSource_,
    uint priceImpactToleranceTarget_
  ) external pure returns (
    uint amountOut
  ) {
    assetIn_;
    amountIn_;
    assetOut_;
    receiver_;
    priceImpactToleranceSource_;
    priceImpactToleranceTarget_;
    amountOut;
    revert("safeLiquidate is not implemented");
  }

  //region ----------------------------------------------  isConversionValid
  enum SetIsConversionValidResult {
    FAILED_0,
    SUCCESS_1,
    PRICE_ZERO_ERROR_2
  }

  struct IsConversionValidParams {
    address assetIn;
    uint amountIn;
    address assetOut;
    uint amountOut;
    SetIsConversionValidResult result;
  }
  /// @notice keccak256(assetIn_, amountIn_, assetOut_, amountOut_) => results
  mapping(bytes32 => IsConversionValidParams) public isConversionValidParams;

  function isConversionValid(
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    uint amountOut_,
    uint priceImpactTolerance_
  ) external view returns (bool) {
    bytes32 key = keccak256(abi.encodePacked(assetIn_, amountIn_, assetOut_, amountOut_));
    priceImpactTolerance_;
    IsConversionValidParams memory p = isConversionValidParams[key];
    if (p.assetIn == assetIn_) {
      if (p.result == SetIsConversionValidResult.FAILED_0) {
        return false;
      } else if (p.result == SetIsConversionValidResult.SUCCESS_1) {
        return true;
      } else {
        revert(AppErrors.ZERO_PRICE);
      }
    } else {
      console.log("isConversionValid assetIn", _tokenName(assetIn_), amountIn_);
      console.log("isConversionValid assetOut", _tokenName(assetOut_), amountOut_);
      revert("isConversionValid is missed");
    }
  }

  function setIsConversionValid(
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    uint amountOut_,
    SetIsConversionValidResult result_
  ) external {
    console.log("setIsConversionValid assetIn", assetIn_, amountIn_);
    console.log("setIsConversionValid assetOut", assetOut_, amountOut_);
    bytes32 key = keccak256(abi.encodePacked(assetIn_, amountIn_, assetOut_, amountOut_));
    isConversionValidParams[key] = IsConversionValidParams({
      assetIn: assetIn_,
      amountIn: amountIn_,
      assetOut: assetOut_,
      amountOut: amountOut_,
      result: result_
    });
  }
  //endregion ----------------------------------------------  isConversionValid


  function repayTheBorrow(address poolAdapter_, bool closePosition) external pure returns (
    uint collateralAmountOut,
    uint repaidAmountOut
  ) {
    poolAdapter_;
    closePosition;
    return (collateralAmountOut, repaidAmountOut);
  }

  function _tokenName(address token) internal view returns (string memory) {
    return IERC20Metadata(token).symbol();
  }

  function getPositions(address user_, address collateralToken_, address borrowedToken_) external pure returns (
    address[] memory poolAdaptersOut
  ) {
    user_; // hide warning
    collateralToken_; // hide warning
    borrowedToken_; // hide warning

    return poolAdaptersOut;
  }

  function salvage(address receiver, address token, uint amount) external pure {
    receiver;
    token;
    amount;
    // not implemented
  }

}
