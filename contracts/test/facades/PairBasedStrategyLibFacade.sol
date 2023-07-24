// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../strategies/uniswap/UniswapV3Lib.sol";
import "@tetu_io/tetu-converter/contracts/interfaces/ITetuConverter.sol";
import "../../strategies/pair/PairBasedStrategyLib.sol";
import "hardhat/console.sol";

/// @notice Provide direct access to UniswapV3Lib functions for unit tests
contract PairBasedStrategyLibFacade is IPoolProportionsProvider {
  function quoteWithdrawStep(
    address[2] memory converterLiquidator_,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    uint[] memory amountsFromPool,
    uint planKind,
    uint propNotUnderlying18
  ) external returns (
    address tokenToSwap,
    uint amountToSwap
  ) {
    return PairBasedStrategyLib.quoteWithdrawStep(converterLiquidator_, tokens, liquidationThresholds, amountsFromPool, planKind, propNotUnderlying18);
  }

  function withdrawStep(
    address[2] memory converterLiquidator_,
    address[] memory tokens,
    uint[] memory liquidationThresholds,
    address tokenToSwap_,
    uint amountToSwap_,
    address aggregator_,
    bytes memory swapData_,
    bool useLiquidator_,
    uint planKind,
    uint propNotUnderlying18
  ) external returns (
    bool completed
  ) {
    return PairBasedStrategyLib.withdrawStep(
      converterLiquidator_,
      tokens,
      liquidationThresholds,
      tokenToSwap_,
      amountToSwap_,
      aggregator_,
      swapData_,
      useLiquidator_,
      planKind,
      propNotUnderlying18
    );
  }

  function _swap(
    IterationPlanLib.SwapRepayPlanParams memory p,
    PairBasedStrategyLib.SwapByAggParams memory aggParams,
    uint indexIn,
    uint indexOut,
    uint amountIn
  ) external returns (
    uint spentAmountIn,
    uint updatedPropNotUnderlying18
  ) {
    return PairBasedStrategyLib._swap(p, aggParams, indexIn, indexOut, amountIn);
  }

  function _getAmountToRepay2(
    IterationPlanLib.SwapRepayPlanParams memory p,
    uint indexCollateral,
    uint indexBorrow
  ) external view returns (
    uint amountToRepay,
    bool borrowInsteadRepay
  ) {
    return PairBasedStrategyLib._getAmountToRepay2(p, indexCollateral, indexBorrow);
  }

  function borrowToProportions(
    IterationPlanLib.SwapRepayPlanParams memory p,
    uint indexCollateral,
    uint indexBorrow
  ) external {
    return PairBasedStrategyLib.borrowToProportions(p, indexCollateral, indexBorrow);
  }


  //region ---------------------------------------------- IPoolProportionsProvider implementation

  uint[] internal valuesPropNotUnderlying18;
  /// @notice getPropNotUnderlying18() uses a value of balance of this token to detect what value should be returned
  address switchToken;
  function setPropNotUnderlying18(uint[] memory valuesPropNotUnderlying18_, address switchToken_) external {
    require(valuesPropNotUnderlying18_.length == 2, "Incorrect length array in setPropNotUnderlying18");
    valuesPropNotUnderlying18 = valuesPropNotUnderlying18_;
    switchToken = switchToken_;
  }

  /// @notice Take next proportions of not-underlying from array
  ///         First call should return valuesPropNotUnderlying18[0], second call - valuesPropNotUnderlying18[1]
  ///         The function is view, so we cannot use counter. So we detect required value implicitly
  ///         through the value of balance of the {switchToken} of the sender.
  /// @return Proportion of the not-underlying [0...1e18]
  function getPropNotUnderlying18() external view returns (uint) {
    uint ret = IERC20(switchToken).balanceOf(msg.sender) == 0
      ? valuesPropNotUnderlying18[1]
      : valuesPropNotUnderlying18[0];
    console.log("getPropNotUnderlying18.ret", ret);
    return ret;
  }
  //endregion ---------------------------------------------- IPoolProportionsProvider implementation

  function _extractProp(uint planKind, bytes memory planEntryData) external pure returns(uint propNotUnderlying18) {
    return PairBasedStrategyLib._extractProp(planKind, planEntryData);
  }

  //region ------------------------------------------------ Fuse functions
  PairBasedStrategyLib.FuseStateParams internal _fuse;
  function setUpFuse(uint status, uint[4] memory thresholds) external {
    _fuse.status = PairBasedStrategyLib.FuseStatus(status);
    _fuse.thresholds = thresholds;
  }
  function getFuseData() external view returns (uint status, uint[4] memory thresholds) {
    return (uint(_fuse.status), _fuse.thresholds);
  }

  function setFuseStatus(uint status) external {
    PairBasedStrategyLib.setFuseStatus(_fuse, PairBasedStrategyLib.FuseStatus(status));
  }

  function setFuseThresholds(uint[4] memory values) external {
    PairBasedStrategyLib.setFuseThresholds(_fuse, values);
  }

  function needChangeFuseStatus(PairBasedStrategyLib.FuseStateParams memory fuse_, uint price) external view returns (
    bool needToChange,
    PairBasedStrategyLib.FuseStatus status
  ) {
    return PairBasedStrategyLib.needChangeFuseStatus(fuse_, price);
  }
  //endregion ------------------------------------------------ Fuse functions
}
