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
import "../../integrations/aave/IAaveFlashLoanReceiver.sol";
import "../../integrations/aave/IAavePool.sol";
import "../../integrations/aave/IAaveAddressesProvider.sol";

contract KyberConverterStrategyEmergency is KyberDepositor, ConverterStrategyBase, IRebalancingV2Strategy, IFarmingStrategy, IAaveFlashLoanReceiver {
  using SafeERC20 for IERC20;

  //region ------------------------------------------------- Constants

  string public constant override NAME = "Kyber Converter Strategy Emergency";
  string public constant override PLATFORM = AppPlatforms.KYBER;
  string public constant override STRATEGY_VERSION = "3.0.1";

  address internal constant USDC_TOKEN = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
  address internal constant TOKEN_USDT = 0xc2132D05D31c914a87C6611C10748AEb04B58e8F;
  address internal constant AAVE_V3_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
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
  function emergencyGetDebtAmount() external view returns (uint amountToPay, uint collateral) {
    return _emergencyGetDebtAmount(USDC_TOKEN, TOKEN_USDT);
  }
  function _emergencyGetDebtAmount(address collateralAsset, address borrowAsset) public view returns (uint amountToPay, uint collateral) {
    return _csbs.converter.getDebtAmountStored(address(this), collateralAsset, borrowAsset, true);
  }
  function balanceOf(address token) public view returns (uint) {
    return IERC20(token).balanceOf(address(this));
  }
  function emergencyCloseDirectDebtsUsingFlashLoan() external {
    StrategyLib2.onlyOperators(controller());
    IAavePool pool = IAavePool(AAVE_V3_POOL);

    (uint amountToPay, uint collateral) = _csbs.converter.getDebtAmountStored(address(this), USDC_TOKEN, TOKEN_USDT, true);

    pool.flashLoanSimple(
      address(this),
      TOKEN_USDT,
      amountToPay,
      abi.encode(amountToPay, collateral),
      0 // referralCode
    );
  }

  function executeOperation(
    address asset,
    uint256 amount,
    uint256 premium,
    address /* initiator */,
    bytes calldata params
  ) external override returns (bool) {
    require(msg.sender == AAVE_V3_POOL, "#0");
    require(asset == TOKEN_USDT, "#1");
    (uint amountToPay, uint collateral) = abi.decode(params, (uint, uint));

    require(amount == amountToPay, "#2");
    ITetuConverter converter = _csbs.converter;

    // use borrowed USDT to pay the debt
    IERC20(TOKEN_USDT).safeTransfer(address(converter), amountToPay);
    converter.repay(USDC_TOKEN, TOKEN_USDT, amountToPay, address(this));
    require(IERC20(USDC_TOKEN).balanceOf(address(this)) >= collateral, "#7");

    amountToPay += premium;

    // now we have USDC, but we need USDT
    uint balanceUsdc = IERC20(USDC_TOKEN).balanceOf(address(this));

    uint usdcPrice = ConverterStrategyBaseLib2.getAssetPriceFromConverter(converter, USDC_TOKEN);
    uint usdtPrice = ConverterStrategyBaseLib2.getAssetPriceFromConverter(converter, TOKEN_USDT);
    uint amountToConvert = amountToPay * usdcPrice / usdtPrice * 101/100; // add 1% on top // decimals of USDC and USDT are the same

    require(balanceUsdc > amountToConvert, "#3");
    ConverterStrategyBaseLib.liquidate(
      converter,
      AppLib._getLiquidator(controller()),
      USDC_TOKEN,
      TOKEN_USDT,
      amountToConvert,
      300,
      1000,
      true // skip validation
    );
    uint balanceUsdt = IERC20(TOKEN_USDT).balanceOf(address(this));
    require(balanceUsdt >= amountToPay, "#3");

    // we need to approve "amounts + fee" to the pool to complete flesh loan
    IERC20(TOKEN_USDT).approve(AAVE_V3_POOL, amountToPay);

    // leave all assets on balance for salvage
    return true;
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
