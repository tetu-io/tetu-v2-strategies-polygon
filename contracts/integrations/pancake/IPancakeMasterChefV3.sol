// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

/// @notice Restored from base-chain: 0xC6A2Db661D5a5690172d8eB0a7DEA2d3008665A3, events were removed
interface IPancakeMasterChefV3 {
    function BOOST_PRECISION() external view returns (uint256);

    function CAKE() external view returns (address);

    function FARM_BOOSTER() external view returns (address);

    function LMPoolDeployer() external view returns (address);

    function MAX_BOOST_PRECISION() external view returns (uint256);

    function MAX_DURATION() external view returns (uint256);

    function MIN_DURATION() external view returns (uint256);

    function PERIOD_DURATION() external view returns (uint256);

    function PRECISION() external view returns (uint256);

    function WETH() external view returns (address);

    function add(uint256 _allocPoint, address _v3Pool, bool _withUpdate) external;

    function balanceOf(address owner) external view returns (uint256);

    function burn(uint256 _tokenId) external;

    function cakeAmountBelongToMC() external view returns (uint256);

    function collect(INonfungiblePositionManagerStruct.CollectParams memory params) external returns (uint256 amount0, uint256 amount1);

    function collectTo(INonfungiblePositionManagerStruct.CollectParams memory params, address to) external returns (uint256 amount0, uint256 amount1);

    function decreaseLiquidity(INonfungiblePositionManagerStruct.DecreaseLiquidityParams memory params) external returns (uint256 amount0, uint256 amount1);

    function emergency() external view returns (bool);

    function getLatestPeriodInfo(address _v3Pool) external view returns (uint256 cakePerSecond, uint256 endTime);

    function getLatestPeriodInfoByPid(uint256 _pid) external view returns (uint256 cakePerSecond, uint256 endTime);

    function harvest(uint256 _tokenId, address _to) external returns (uint256 reward);

    function increaseLiquidity(INonfungiblePositionManagerStruct.IncreaseLiquidityParams memory params) external payable returns (
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    function latestPeriodCakePerSecond() external view returns (uint256);

    function latestPeriodEndTime() external view returns (uint256);

    function latestPeriodNumber() external view returns (uint256);

    function latestPeriodStartTime() external view returns (uint256);

    function multicall(bytes[] memory data) external payable returns (bytes[] memory results);

    function nonfungiblePositionManager() external view returns (address);

    function onERC721Received(address, address _from, uint256 _tokenId, bytes memory) external returns (bytes4);

    function operatorAddress() external view returns (address);

    function owner() external view returns (address);

    function pendingCake(uint256 _tokenId) external view returns (uint256 reward);

    function poolInfo(uint256) external view returns (
        uint256 allocPoint,
        address v3Pool,
        address token0,
        address token1,
        uint24 fee,
        uint256 totalLiquidity,
        uint256 totalBoostLiquidity
    );

    function poolLength() external view returns (uint256);

    function receiver() external view returns (address);

    function renounceOwnership() external;

    function set(uint256 _pid, uint256 _allocPoint, bool _withUpdate) external;

    function setEmergency(bool _emergency) external;

    function setLMPoolDeployer(address _LMPoolDeployer) external;

    function setOperator(address _operatorAddress) external;

    function setPeriodDuration(uint256 _periodDuration) external;

    function setReceiver(address _receiver) external;

    function sweepToken(address token, uint256 amountMinimum, address recipient) external;

    function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256);

    function totalAllocPoint() external view returns (uint256);

    function transferOwnership(address newOwner) external;

    function unwrapWETH9(uint256 amountMinimum, address recipient) external;

    function updateBoostMultiplier(uint256 _tokenId, uint256 _newMultiplier) external;

    function updateFarmBoostContract(address _newFarmBoostContract) external;

    function updateLiquidity(uint256 _tokenId) external;

    function updatePools(uint256[] memory pids) external;

    function upkeep(uint256 _amount, uint256 _duration, bool _withUpdate) external;

    function userPositionInfos(uint256) external view returns (
        uint128 liquidity,
        uint128 boostLiquidity,
        int24 tickLower,
        int24 tickUpper,
        uint256 rewardGrowthInside,
        uint256 reward,
        address user,
        uint256 pid,
        uint256 boostMultiplier
    );

    function v3PoolAddressPid(address) external view returns (uint256);

    function withdraw(uint256 _tokenId, address _to) external returns (uint256 reward);

    receive() external payable;
}

interface INonfungiblePositionManagerStruct {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }
}
