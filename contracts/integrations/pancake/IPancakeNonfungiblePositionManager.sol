// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

/// @notice Wraps Pancake V3 positions in the ERC721 non-fungible token interface
/// @dev Restored from base-chain:0x46A15B0b27311cedF172AB29E4f4766fbE7F4364, events were removed
interface IPancakeNonfungiblePositionManager {
    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function PERMIT_TYPEHASH() external view returns (bytes32);

    function WETH9() external view returns (address);

    function approve(address to, uint256 tokenId) external;

    function balanceOf(address owner) external view returns (uint256);

    function baseURI() external pure returns (string memory);

    function burn(uint256 tokenId) external payable;

    function collect(INonfungiblePositionManager.CollectParams memory params) external payable returns (uint256 amount0, uint256 amount1);

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool);

    function decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams memory params) external payable returns (uint256 amount0, uint256 amount1);

    function deployer() external view returns (address);

    function factory() external view returns (address);

    function getApproved(uint256 tokenId) external view returns (address);

    function increaseLiquidity(INonfungiblePositionManager.IncreaseLiquidityParams memory params) external payable returns (
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    function isApprovedForAll(address owner, address operator) external view returns (bool);

    function mint(INonfungiblePositionManager.MintParams memory params) external payable returns (
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    function multicall(bytes[] memory data) external payable returns (bytes[] memory results);

    function name() external view returns (string memory);

    function ownerOf(uint256 tokenId) external view returns (address);

    function pancakeV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes memory data) external;

    function permit(address spender, uint256 tokenId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external payable;

    function positions(uint256 tokenId) external view returns (
        uint96 nonce,
        address operator,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    );

    function refundETH() external payable;

    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory _data) external;

    function selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external payable;

    function selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) external payable;

    function selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) external payable;

    function selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external payable;

    function setApprovalForAll(address operator, bool approved) external;

    function supportsInterface(bytes4 interfaceId) external view returns (bool);

    function sweepToken(address token, uint256 amountMinimum, address recipient) external payable;

    function symbol() external view returns (string memory);

    function tokenByIndex(uint256 index) external view returns (uint256);

    function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256);

    function tokenURI(uint256 tokenId) external view returns (string memory);

    function totalSupply() external view returns (uint256);

    function transferFrom(address from, address to, uint256 tokenId) external;

    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable;

    receive() external payable;
}

interface INonfungiblePositionManager {
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

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }
}
