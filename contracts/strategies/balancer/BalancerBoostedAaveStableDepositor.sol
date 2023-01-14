// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "../DepositorBase.sol";
import "../../tools/TokenAmountsLib.sol";
import "../../tools/AppErrors.sol";
import "../../integrations/balancer/IBVault.sol";
import "../../integrations/balancer/IBalancerBoostedAavePool.sol";
import "../../integrations/balancer/IBalancerBoostedAaveStablePool.sol";


/// @title Depositor for the pool Balancer Boosted Aave USD (Polygon)
/// @dev See https://app.balancer.fi/#/polygon/pool/0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b
///      See https://docs.balancer.fi/products/balancer-pools/boosted-pools for explanation of Boosted Pools on BalanceR.
///      Terms
///         Phantom BPT = bb-a-* tokens (In pools that use Phantom BPT all pool tokens are minted at the time of pool creation)
///      Boosted pool:
///            bb-am-DAI (DAI + amDAI) + bb-am-USDC (USDC + amUSDC) + bb-am-USDT (USDT + amUSDT)
abstract contract BalancerBoostedAaveStabledDepositor is DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant BALANCER_BOOSTED_AAVE_USD_DEPOSITOR_VERSION = "1.0.0";

  /// @dev https://dev.balancer.fi/references/contracts/deployment-addresses
  IBVault public constant BALANCER_VAULT = IBVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

  /// @notice Balancer Boosted Aave USD pool ID
  bytes32 public constant POOL_ID = 0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b;
  address private constant BB_AM_USD_TOKEN = 0x48e6B98ef6329f8f0A30eBB8c7C960330d648085; // TODO: use _getPoolAddress instead?

  /////////////////////////////////////////////////////////////////////
  ///                   Variables
  /////////////////////////////////////////////////////////////////////
  address public tokenA;
  address public tokenB;
  address public tokenC;
  /// @notice Token => index + 1 (tokenA => 1, tokenB => 2, tokenC => 3)
  mapping (address => uint) public tokenIndices;

  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  function __BalancerBoostedAaveUsdDepositor_init() internal onlyInitializing {
    tokenA = 0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063; // dai
    tokenB = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174; // usdc
    tokenC = 0xc2132D05D31c914a87C6611C10748AEb04B58e8F; // usdt

    // infinity approve,  2**255 is more gas-efficient than type(uint).max
    // IERC20(address(depositorPair)).approve(_rewardsPool, 2**255);
    tokenIndices[tokenA] = 1;
    tokenIndices[tokenB] = 2;
    tokenIndices[tokenC] = 3;
  }

  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  /// @notice Returns pool assets (token A, token B, token C)
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    poolAssets = new address[](2);
    poolAssets[0] = tokenA;
    poolAssets[1] = tokenB;
    poolAssets[2] = tokenC;
  }

  /// @notice Returns pool weights in percents (token A, token B, token C)
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    weights = new uint[](3);
    weights[0] = 1; // 50%
    weights[1] = 1; // 50%
    weights[2] = 1; // 50%
    totalWeight = 3; // 100%
  }

  /// @notice Total amounts of the assets under control of the pool for token A, token B, token C
  /// @return reserves bb-am-DAI (DAI + amDAI): balance DAI + (balance amDAI recalculated to DAI)
  ///                  bb-am-USDC (USDC + amUSDC): balance USDC + (amUSDC recalculated to USDC)
  ///                  bb-am-USDT (USDT + amUSDT): balance USDT + (amUSDT recalculated to USDT)
  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
    // enumerate all bb-am-XXX tokens and return amounts of A, B, C tokens in proper order (A, B, C)
    (IERC20[] memory tokens,,) = BALANCER_VAULT.getPoolTokens(POOL_ID);
    uint len = tokens.length;
    uint[] memory reserves = new uint[](3);
    for (uint i; i < len; i = uncheckedInc(i)) {
      if (address(tokens[i]) != BB_AM_USD_TOKEN) {
        IBalancerBoostedAavePool poolBbAm = IBalancerBoostedAavePool(address(tokens[i]));

        uint indexInReserves1;
        uint totalReserveAmount;

        // Each bb-am-* returns (main-token, wrapped-token, bb-am-itself), the order of tokens in undetermined
        // i.e. (DAI + amDAI + bb-am-DAI) or (bb-am-USDC, amUSDC, USDC)

        // enumerate all tokens inside bb-am-XXX token, i.e. (DAI, amDAI, bb-am-DAI)
        (IERC20[] memory subTokens, uint256[] memory balances,) = BALANCER_VAULT.getPoolTokens(poolBbAm.getPoolId());
        uint lenSubTokens = subTokens.length;
        for (uint j; j < len; j = uncheckedInc(j)) {
          if (address(subTokens[j]) == address(tokens[i])) {
            // this is bb-am-* token itself, we should ignore it
          } else {
            uint tokenIndex = tokenIndices[address(subTokens[j])];
            if (tokenIndex == 0) {
              // this is a wrapped token, i.e. amDAI, amUSDC, amUSDT
              // wrappedTokenRate = The conversion rate between the wrapped and main tokens, decimals 18

              // TODO we assume here, that main and wrapped tokens have same decimals
              // TODO it's true for Balancer Boosted Aave USD, but probably in general case we need a recalculation
              totalReserveAmount += balances[j] * poolBbAm.getWrappedTokenRate() / 1e18;
              indexInReserves1 = tokenIndex + 1;
            } else {
              // this is a main token, i.e. DAI, USDC .. take the amount as is
              totalReserveAmount += balances[j];
            }
          }
        }

        require(indexInReserves1 != 0, AppErrors.BB_AM_POOL_DOESNT_RETURN_MAIN_TOKEN);
        reserves[indexInReserves1 - 1] = totalReserveAmount;
      }
    }

    return reserves;
  }

  /// @notice Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override internal virtual view returns (uint) {
    console.log("_depositorLiquidity", IBalancerBoostedAaveStablePool(BB_AM_USD_TOKEN).balanceOf(address(this)));
    return IBalancerBoostedAaveStablePool(BB_AM_USD_TOKEN).balanceOf(address(this));
  }

  //// @notice Total amount of liquidity (LP tokens) in the depositor
  function _depositorTotalSupply() override internal view returns (uint) {
    console.log("_depositorTotalSupply", IBalancerBoostedAaveStablePool(BB_AM_USD_TOKEN).getActualSupply());
    return IBalancerBoostedAaveStablePool(BB_AM_USD_TOKEN).getActualSupply();
  }


  /////////////////////////////////////////////////////////////////////
  ///             Enter, exit
  /////////////////////////////////////////////////////////////////////

  /// @notice Deposit given amount to the pool.
  /// @param amountsDesired_ Amounts of token A and B on the balance of the depositor
  /// @return amountsConsumedOut Amounts of token A and B deposited to the internal pool
  /// @return liquidityOut Total amount of liquidity added to the internal pool
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumedOut,
    uint liquidityOut
  ) {
    return (amountsConsumedOut, liquidityOut);
  }

  /// @notice Withdraw given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    console.log("_depositorExit.liquidityAmount_", liquidityAmount_);
    return amountsOut;
  }

  /// @notice Quotes output for given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorQuoteExit(uint liquidityAmount_) override internal virtual view returns (uint[] memory amountsOut) {
    return amountsOut;
  }

  /////////////////////////////////////////////////////////////////////
  ///             Claim rewards
  /////////////////////////////////////////////////////////////////////

  /// @dev Claim all possible rewards.
  function _depositorClaimRewards() override internal virtual returns (
    address[] memory tokensOut,
    uint[] memory amountsOut
  ) {
    return (tokensOut, amountsOut);
  }


  /////////////////////////////////////////////////////////////////////
  ///             Utils
  /////////////////////////////////////////////////////////////////////

//  /// @dev Returns the address of a Pool's contract.
//  ///      Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
//  function _getPoolAddress(bytes32 id) internal pure returns (address) {
//    // 12 byte logical shift left to remove the nonce and specialization setting. We don't need to mask,
//    // since the logical shift already sets the upper bits to zero.
//    return address(uint160(uint(id) >> (12 * 8)));
//  }

  function uncheckedInc(uint i) internal pure returns (uint) {
  unchecked {
    return i + 1;
  }
  }

  /// @dev This empty reserved space is put in place to allow future versions to add new
  /// variables without shifting down storage in the inheritance chain.
  /// See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
  uint[16] private __gap;
}
