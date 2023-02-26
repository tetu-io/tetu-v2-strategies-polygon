// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/strategy/StrategyStrictBase.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/ITetuLiquidator.sol";
import "../../integrations/tetu-v1/ISmartVault.sol";
import "../../tools/AppLib.sol";
import "../../tools/ERC20Helpers.sol";

/// @title Simple auto compounding strategy for TETU V1 vaults.
/// @author AlehNat
contract TetuV1SingleTokenStrictStrategy is StrategyStrictBase, ERC20Helpers {
  using SafeERC20 for IERC20;

  string public constant override NAME = "TetuV1 Single Token Strict Strategy";
  string public constant override PLATFORM = "TETU";
  string public constant override STRATEGY_VERSION = "1.0.0";

  uint private constant _ASSET_LIQUIDATION_SLIPPAGE = 500; // 0.5%

  // in this strategy TETU V1 vault is used as a pool
  ISmartVault public immutable pool;
  ITetuLiquidator public immutable liquidator;
  address public immutable xTetuAddress;

  bool public override isReadyToHardWork;

  constructor(address _pool, address _liquidator, address _xTetuAddress) {
    pool = ISmartVault(_pool);
    liquidator = ITetuLiquidator(_liquidator);
    xTetuAddress = _xTetuAddress;
    isReadyToHardWork = true;
  }


  // uint earned, uint lost is it in USD?
  function doHardWork() external override returns (uint earned, uint lost) {
    uint assetBalanceBefore = _balance(asset);
    _claim();
    _unwrapXTetu();
    _liquidateReward();
    uint assetBalance = _balance(asset);
    if (assetBalance > 0) {
      _depositToPool(assetBalance);
    }
    earned = 0;
    lost = 0;
    if(assetBalance > assetBalanceBefore) {
      earned = assetBalance - assetBalanceBefore;
    } else {
      lost = assetBalanceBefore - assetBalance;
    }
  }

  function investedAssets() public view override returns (uint) {
    return pool.underlyingBalanceWithInvestmentForHolder(address(this));
  }

  /// @dev Deposit given amount to the pool.
  function _depositToPool(uint amount) internal override {
    IERC20(asset).safeIncreaseAllowance(address(pool), amount);
    pool.deposit(amount);
  }

  /// @dev Withdraw given amount from the pool.
  /// @return investedAssetsUSD and assetPrice are not used in this strategy (0,0)
  function _withdrawFromPool(uint amount) internal override returns (uint investedAssetsUSD, uint assetPrice) {
    pool.withdraw(amount);
    return (0, 0);
  }

  /// @dev Withdraw all from the pool.
  /// @return investedAssetsUSD and assetPrice are not used in this strategy returns (0,0)
  function _withdrawAllFromPool() internal override returns (uint investedAssetsUSD, uint assetPrice) {
    uint totalBalance = _balance(address (pool));
    return _withdrawFromPool(totalBalance);
  }

  /// @dev If pool support emergency withdraw need to call it for emergencyExit()
  ///      Withdraw assets without impact checking.
  function _emergencyExitFromPool() internal override {
    _withdrawAllFromPool();
  }

  /// @dev Claim all possible rewards.
  function _claim() internal override {
    pool.getAllRewards();
  }

  function _unwrapXTetu() internal {
    uint xTetuBalance = _balance(xTetuAddress);
    if (xTetuBalance > 0) {
      ISmartVault(xTetuAddress).withdraw(xTetuBalance);
    }
  }

  function _liquidateReward() internal {
    address [] memory rewardTokens = pool.rewardTokens();
    for(uint i = 0; i < rewardTokens.length; i = AppLib.uncheckedInc(i)) {
      address rewardToken = rewardTokens[i];
      uint rewardBalance = _balance(rewardToken);
      if (rewardBalance > 0) {
        IERC20(rewardToken).safeIncreaseAllowance(address(liquidator), rewardBalance);
        liquidator.liquidate(rewardToken, asset, rewardBalance, _ASSET_LIQUIDATION_SLIPPAGE);
      }
    }
  }
}
