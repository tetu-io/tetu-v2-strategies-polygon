// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../ConverterStrategyBase.sol";
import "./KyberDepositor.sol";
import "./KyberConverterStrategyLogicLib.sol";
import "../../libs/AppPlatforms.sol";
import "../../interfaces/IRebalancingV2Strategy.sol";
import "../../interfaces/IFarmingStrategy.sol";
import "./KyberStrategyErrors.sol";
import "../pair/PairBasedStrategyLogicLib.sol";

contract KyberConverterStrategyEmergency is KyberDepositor, ConverterStrategyBase, IRebalancingV2Strategy, IFarmingStrategy {

  //region ------------------------------------------------- Constants

  string public constant override NAME = "Kyber Converter Strategy Emergency";
  string public constant override PLATFORM = AppPlatforms.KYBER;
  string public constant override STRATEGY_VERSION = "3.0.0";
  //endregion ------------------------------------------------- Constants

  ////////////////////////////////////////////////////////////////////////////////////////////////

  /// @dev RETURN ZERO BALANCE!
  function investedAssets() public pure override returns (uint) {
    return 0;
  }

  function salvage(address token, uint amount) external {
    StrategyLib2.onlyOperators(controller());
    IERC20(token).transfer(IController(controller()).governance(), amount);
  }

  ////////////////////////////////////////////////////////////////////////////////////////////////

  function _withdrawFromPool(uint) override internal pure virtual returns (uint, uint, uint) {
    return (0, 0, 0);
  }

  function withdrawByAggStep(
    address,
    address,
    uint,
    bytes memory,
    bytes memory,
    uint
  ) external pure returns (bool) {
    return false;
  }

  function setFuseThresholds(uint[4] memory) external pure {
  }

  function getPropNotUnderlying18() external pure returns (uint) {
    return 0;
  }

  function quoteWithdrawByAgg(bytes memory) external pure returns (address, uint) {
    return (address(0), 0);
  }

  function rebalanceNoSwaps(bool) external pure {
  }

  function setFuseStatus(uint) external pure {
  }

  function setStrategyProfitHolder(address) external pure {
  }

  function setWithdrawDone(uint) external pure {
  }

  function isReadyToHardWork() override external virtual pure returns (bool) {
    return false;
  }

  function needRebalance() public pure returns (bool) {
    return false;
  }

  function canFarm() external pure returns (bool) {
    return false;
  }

  function getDefaultState() external override view returns (
    address[] memory addr,
    int24[] memory tickData,
    uint[] memory nums,
    bool[] memory boolValues
  ) {
    return PairBasedStrategyLogicLib.getDefaultState(state.pair);
  }

  function onERC721Received(
    address,
    address,
    uint256,
    bytes memory
  ) external pure returns (bytes4) {
    return this.onERC721Received.selector;
  }

  function _beforeDeposit(
    ITetuConverter,
    uint,
    address[] memory,
    uint /*indexAsset_*/
  ) override internal virtual pure returns (
    uint[] memory
  ) {
    return new uint[](0);
  }

  function _handleRewards() override internal virtual pure returns (uint, uint, uint) {
    return (0, 0, 0);
  }

  function _depositToPool(uint, bool) override internal virtual pure returns (
    uint
  ) {
    return 0;
  }

  function _beforeWithdraw(uint /*amount*/) internal pure override {
  }

  function _preHardWork(bool) internal pure override returns (bool) {
    return false;
  }

  function _rebalanceBefore() internal pure returns (uint, uint) {
    return (0, 0);
  }

  function _rebalanceAfter(uint[] memory) internal pure {
  }

  function _isFuseTriggeredOn() internal pure returns (bool) {
    return false;
  }
}
