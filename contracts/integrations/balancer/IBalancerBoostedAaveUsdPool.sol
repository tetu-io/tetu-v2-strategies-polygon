// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

/// @notice Restored from https://polygonscan.com/address/0x48e6b98ef6329f8f0a30ebb8c7c960330d648085
interface IBalancerBoostedAaveUsdPool {
  event AmpUpdateStarted(
    uint256 startValue,
    uint256 endValue,
    uint256 startTime,
    uint256 endTime
  );
  event AmpUpdateStopped(uint256 currentValue);
  event Approval(
    address indexed owner,
    address indexed spender,
    uint256 value
  );
  event PausedStateChanged(bool paused);
  event ProtocolFeePercentageCacheUpdated(
    uint256 indexed feeType,
    uint256 protocolFeePercentage
  );
  event RecoveryModeStateChanged(bool enabled);
  event SwapFeePercentageChanged(uint256 swapFeePercentage);
  event TokenRateCacheUpdated(uint256 indexed tokenIndex, uint256 rate);
  event TokenRateProviderSet(
    uint256 indexed tokenIndex,
    address indexed provider,
    uint256 cacheDuration
  );
  event Transfer(address indexed from, address indexed to, uint256 value);

  function DELEGATE_PROTOCOL_SWAP_FEES_SENTINEL() external view returns (uint256);
  function DOMAIN_SEPARATOR() external view returns (bytes32);

  function allowance(address owner, address spender) external view returns (uint256);
  function approve(address spender, uint256 amount) external returns (bool);
  function balanceOf(address account) external view returns (uint256);
  function decimals() external view returns (uint8);
  function decreaseAllowance(address spender, uint256 amount) external returns (bool);
  function disableRecoveryMode() external;
  function enableRecoveryMode() external;
  function getActionId(bytes4 selector) external view returns (bytes32);
  function getActualSupply() external view returns (uint256);
  function getAmplificationParameter() external view returns (
    uint256 value,
    bool isUpdating,
    uint256 precision
  );
  function getAuthorizer() external view returns (address);
  function getBptIndex() external view returns (uint256);
  function getDomainSeparator() external view returns (bytes32);
  function getLastJoinExitData() external view returns (
    uint256 lastJoinExitAmplification,
    uint256 lastPostJoinExitInvariant
  );
  function getMinimumBpt() external pure returns (uint256);
  function getNextNonce(address account) external view returns (uint256);
  function getOwner() external view returns (address);
  function getPausedState() external view returns (
    bool paused,
    uint256 pauseWindowEndTime,
    uint256 bufferPeriodEndTime
  );
  function getPoolId() external view returns (bytes32);
  function getProtocolFeePercentageCache(uint256 feeType) external view returns (uint256);
  function getProtocolFeesCollector() external view returns (address);
  function getProtocolSwapFeeDelegation() external view returns (bool);
  function getRate() external view returns (uint256);
  function getRateProviders() external view returns (address[] memory);
  function getScalingFactors() external view returns (uint256[] memory);
  function getSwapFeePercentage() external view returns (uint256);
  function getTokenRate(address token) external view returns (uint256);
  function getTokenRateCache(address token) external view returns (
    uint256 rate,
    uint256 oldRate,
    uint256 duration,
    uint256 expires
  );

  function getVault() external view returns (address);
  function inRecoveryMode() external view returns (bool);
  function increaseAllowance(address spender, uint256 addedValue) external returns (bool);
  function isTokenExemptFromYieldProtocolFee(address token) external view returns (bool);
  function name() external view returns (string memory);
  function nonces(address owner) external view returns (uint256);

  function onExitPool(
    bytes32 poolId,
    address sender,
    address recipient,
    uint256[] memory balances,
    uint256 lastChangeBlock,
    uint256 protocolSwapFeePercentage,
    bytes memory userData
  ) external returns (uint256[] memory, uint256[] memory);

  function onJoinPool(
    bytes32 poolId,
    address sender,
    address recipient,
    uint256[] memory balances,
    uint256 lastChangeBlock,
    uint256 protocolSwapFeePercentage,
    bytes memory userData
  ) external returns (uint256[] memory, uint256[] memory);

  function onSwap(
    IPoolSwapStructs.SwapRequest memory swapRequest,
    uint256[] memory balances,
    uint256 indexIn,
    uint256 indexOut
  ) external returns (uint256);

  function pause() external;

  function permit(
    address owner,
    address spender,
    uint256 value,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external;

  function queryExit(
    bytes32 poolId,
    address sender,
    address recipient,
    uint256[] memory balances,
    uint256 lastChangeBlock,
    uint256 protocolSwapFeePercentage,
    bytes memory userData
  ) external returns (uint256 bptIn, uint256[] memory amountsOut);

  function queryJoin(
    bytes32 poolId,
    address sender,
    address recipient,
    uint256[] memory balances,
    uint256 lastChangeBlock,
    uint256 protocolSwapFeePercentage,
    bytes memory userData
  ) external returns (uint256 bptOut, uint256[] memory amountsIn);

  function setAssetManagerPoolConfig(address token, bytes memory poolConfig) external;
  function setSwapFeePercentage(uint256 swapFeePercentage) external;
  function setTokenRateCacheDuration(address token, uint256 duration) external;

  function startAmplificationParameterUpdate(uint256 rawEndValue, uint256 endTime) external;
  function stopAmplificationParameterUpdate() external;
  function symbol() external view returns (string memory);
  function totalSupply() external view returns (uint256);
  function transfer(address recipient, uint256 amount) external returns (bool);
  function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

  function unpause() external;
  function updateProtocolFeePercentageCache() external;
  function updateTokenRateCache(address token) external;
}

interface ComposableStablePool {
  struct NewPoolParams {
    address vault;
    address protocolFeeProvider;
    string name;
    string symbol;
    address[] tokens;
    address[] rateProviders;
    uint256[] tokenRateCacheDurations;
    bool[] exemptFromYieldProtocolFeeFlags;
    uint256 amplificationParameter;
    uint256 swapFeePercentage;
    uint256 pauseWindowDuration;
    uint256 bufferPeriodDuration;
    address owner;
  }
}

interface IPoolSwapStructs {
  struct SwapRequest {
    uint8 kind;
    address tokenIn;
    address tokenOut;
    uint256 amount;
    bytes32 poolId;
    uint256 lastChangeBlock;
    address from;
    address to;
    bytes userData;
  }
}