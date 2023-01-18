// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Initializable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../DepositorBase.sol";
import "./BalancerLogicLib.sol";
import "../../tools/TokenAmountsLib.sol";
import "../../tools/AppErrors.sol";
import "../../integrations/balancer/IBVault.sol";
import "../../integrations/balancer/IBalancerHelper.sol";
import "../../integrations/balancer/IBalancerBoostedAavePool.sol";
import "../../integrations/balancer/IBalancerBoostedAaveStablePool.sol";
import "hardhat/console.sol";


/// @title Depositor for the pool Balancer Boosted Aave USD (Polygon)
/// @dev See https://app.balancer.fi/#/polygon/pool/0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b
///      See https://docs.balancer.fi/products/balancer-pools/boosted-pools for explanation of Boosted Pools on BalanceR.
///      Terms
///         Phantom BPT = bb-a-* tokens (In pools that use Phantom BPT all pool tokens are minted at the time of pool creation)
///      Boosted pool:
///            bb-am-DAI (DAI + amDAI) + bb-am-USDC (USDC + amUSDC) + bb-am-USDT (USDT + amUSDT)
abstract contract BalancerComposableStableDepositor is DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant BALANCER_BOOSTED_AAVE_USD_DEPOSITOR_VERSION = "1.0.0";

  /// @dev https://dev.balancer.fi/references/contracts/deployment-addresses
  IBVault public constant BALANCER_VAULT = IBVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

  address public constant BALANCER_HELPER = 0x239e55F427D44C3cc793f49bFB507ebe76638a2b;

  /// @notice Balancer Boosted Aave USD pool ID
  bytes32 public constant BB_AM_USD_POOL_ID = 0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b;
  bytes32 public constant BB_AM_DAI_POOL_ID = 0x178e029173417b1f9c8bc16dcec6f697bc323746000000000000000000000758;
  bytes32 public constant BB_AM_USDC_POOL_ID = 0xf93579002dbe8046c43fefe86ec78b1112247bb8000000000000000000000759;
  bytes32 public constant BB_AM_USDT_POOL_ID = 0xff4ce5aaab5a627bf82f4a571ab1ce94aa365ea600000000000000000000075a;
  address private constant BB_AM_USD = 0x48e6B98ef6329f8f0A30eBB8c7C960330d648085; // TODO: use _getPoolAddress instead?
  address private constant BB_AM_DAI =  0x178E029173417b1F9C8bC16DCeC6f697bC323746; // TODO: use _getPoolAddress instead?
  address private constant BB_AM_USDC = 0xF93579002DBE8046c43FEfE86ec78b1112247BB8; // TODO: use _getPoolAddress instead?
  address private constant BB_AM_USDT = 0xFf4ce5AAAb5a627bf82f4A571AB1cE94Aa365eA6; // TODO: use _getPoolAddress instead?
  address private constant DAI = 0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063;
  address private constant USDC = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
  address private constant USDT = 0xc2132D05D31c914a87C6611C10748AEb04B58e8F;
  address private constant AM_DAI = 0xEE029120c72b0607344f35B17cdD90025e647B00;
  address private constant AM_USDC = 0x221836a597948Dce8F3568E044fF123108aCc42A;
  address private constant AM_USDT = 0x19C60a251e525fa88Cd6f3768416a8024e98fC19;

  /////////////////////////////////////////////////////////////////////
  ///                   Variables
  /////////////////////////////////////////////////////////////////////
  mapping (address => uint) public tokenIndices;

  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  function __BalancerBoostedAaveUsdDepositor_init() internal onlyInitializing {
    tokenIndices[DAI] = 1;
    tokenIndices[USDC] = 2;
    tokenIndices[USDT] = 3;
  }

  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  /// @notice Returns pool assets (DAI, USDC, USDT)
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    poolAssets = new address[](3);
    // todo The order must be exactly the same as in getPoolTokens.tokens, see BalancerLogicLib.getAmountsToDeposit impl
    poolAssets[0] = DAI;
    poolAssets[1] = USDC;
    poolAssets[2] = USDT;
  }

  /// @notice Returns pool weights in percents (DAI, USDC, USDT)
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    weights = new uint[](3);
    weights[0] = 1; // 33.3(3)%
    weights[1] = 1; // 33.3(3)%
    weights[2] = 1; // 33.3(3)%
    totalWeight = 3; // 100%
  }

  /// @notice Total amounts of the assets under control of the pool for DAI, USDC, USDT
  /// @return reserves bb-am-DAI (DAI + amDAI): balance DAI + (balance amDAI recalculated to DAI)
  ///                  bb-am-USDC (USDC + amUSDC): balance USDC + (amUSDC recalculated to USDC)
  ///                  bb-am-USDT (USDT + amUSDT): balance USDT + (amUSDT recalculated to USDT)
  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reserves) {
    // enumerate all bb-am-XXX tokens and return amounts of A, B, C tokens in proper order (A, B, C)
    (IERC20[] memory tokens,,) = BALANCER_VAULT.getPoolTokens(BB_AM_USD_POOL_ID);
    uint len = tokens.length;
    reserves = new uint[](3);
    for (uint i; i < len; i = uncheckedInc(i)) {
      if (address(tokens[i]) != BB_AM_USD) {
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
    console.log("_depositorLiquidity", IBalancerBoostedAaveStablePool(BB_AM_USD).balanceOf(address(this)));
    return IBalancerBoostedAaveStablePool(BB_AM_USD).balanceOf(address(this));
  }

  //// @notice Total amount of liquidity (LP tokens) in the depositor
  function _depositorTotalSupply() override internal view returns (uint) {
    console.log("_depositorTotalSupply", IBalancerBoostedAaveStablePool(BB_AM_USD).getActualSupply());
    return IBalancerBoostedAaveStablePool(BB_AM_USD).getActualSupply();
  }


  /////////////////////////////////////////////////////////////////////
  ///             Enter, exit
  /////////////////////////////////////////////////////////////////////

  /// @notice Swap given {amountIn_} of {assetIn_} to {assetOut_} using the given BalanceR pool
  function _swap(
    bytes32 poolId_,
    address assetIn_,
    address assetOut_,
    uint amountIn_,
    IBVault.FundManagement memory funds_
  ) internal returns (uint) {
    console.log("_swap, asset, balance", assetIn_, IERC20(assetIn_).balanceOf(address(this)));
    console.log("_swap, amountIn", amountIn_);
    IERC20(assetIn_).approve(address(BALANCER_VAULT), amountIn_);
    BALANCER_VAULT.swap(
      IBVault.SingleSwap({
        poolId: poolId_,
        kind: IBVault.SwapKind.GIVEN_IN,
        assetIn: IAsset(assetIn_),
        assetOut: IAsset(assetOut_),
        amount: amountIn_,
        userData: bytes("")
      }),
      funds_,
      1,
      block.timestamp
    );

    return IERC20(assetOut_).balanceOf(address(this));
  }

  /// @notice Deposit given amount to the pool.
  /// @param amountsDesired_ Amounts of assets on the balance of the depositor
  ///         The order of assets is DAI, USDC, USDT - same as in getPoolTokens, but there is no BB-AM-USD
  /// @return amountsConsumedOut Amounts of assets deposited to balanceR pool
  ///         The order of assets is DAI, USDC, USDT - same as in getPoolTokens, but there is no BB-AM-USD
  /// @return liquidityOut Total amount of liquidity added to balanceR pool in terms of BB-AM-USD tokens
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumedOut,
    uint liquidityOut
  ) {
    // The implementation below assumes, that getPoolTokens returns the assets in following order:
    //    bb-am-dai, bb-am-usd, bb-am-usdc, bb-am-usdt
    (IERC20[] memory tokens, uint[] memory balances,) = BALANCER_VAULT.getPoolTokens(BB_AM_USD_POOL_ID);
    uint len = tokens.length;
    console.log("Token and balance 0", address(tokens[0]), balances[0]);
    console.log("Token and balance 1", address(tokens[1]), balances[1]);
    console.log("Token and balance 2", address(tokens[2]), balances[2]);
    console.log("Token and balance 3", address(tokens[3]), balances[3]);

    // temporary save current liquidity
    liquidityOut = IBalancerBoostedAaveStablePool(BB_AM_USD).balanceOf(address(this));
    console.log("Current liquidityOut", liquidityOut);

    uint indexBpt = IBalancerBoostedAaveStablePool(BB_AM_USD).getBptIndex();

    // Original amounts can have any values. But we need amounts in proportions according to the current balances
    uint[] memory underlying = BalancerLogicLib.getTotalAssetAmounts(BALANCER_VAULT, tokens, indexBpt);
    amountsConsumedOut = BalancerLogicLib.getAmountsToDeposit(amountsDesired_, tokens, balances, underlying, indexBpt);
    console.log("amountsConsumedOut 0", amountsConsumedOut[0]);
    console.log("amountsConsumedOut 1", amountsConsumedOut[1]);
    console.log("amountsConsumedOut 2", amountsConsumedOut[2]);

    // we can create funds_ once and use it several times
    IBVault.FundManagement memory funds_ = IBVault.FundManagement({
      sender: address(this),
      fromInternalBalance: false,
      recipient: payable(address(this)),
      toInternalBalance: false
    });

    // swap all tokens XX => bb-am-XX
    // we need two arrays with same amounts: amountsToDeposit (with 0 for BB-AM-USD) and userDataAmounts (no BB-AM-USD)
    uint[] memory amountsToDeposit = new uint[](4);
    amountsToDeposit[0] = _swap(BB_AM_DAI_POOL_ID, DAI, BB_AM_DAI, amountsConsumedOut[0], funds_);
    amountsToDeposit[2] = _swap(BB_AM_USDC_POOL_ID, USDC, BB_AM_USDC, amountsConsumedOut[1], funds_);
    amountsToDeposit[3] = _swap(BB_AM_USDT_POOL_ID, USDT, BB_AM_USDT, amountsConsumedOut[2], funds_);
    console.log("amountsToDeposit DAI 0", amountsToDeposit[0]);
    console.log("amountsToDeposit USDC 2", amountsToDeposit[2]);
    console.log("amountsToDeposit USDT 3", amountsToDeposit[3]);

    uint[] memory userDataAmounts = new uint[](3);
    userDataAmounts[0] = amountsToDeposit[0];
    userDataAmounts[1] = amountsToDeposit[2];
    userDataAmounts[2] = amountsToDeposit[3];
    console.log("userDataAmounts DAI 0", userDataAmounts[0]);
    console.log("userDataAmounts USDC 1", userDataAmounts[1]);
    console.log("userDataAmounts USDT 2", userDataAmounts[2]);

    // add liquidity to balancer
    _approveIfNeeded(BB_AM_DAI, amountsToDeposit[0], address(BALANCER_VAULT));
    _approveIfNeeded(BB_AM_USDC, amountsToDeposit[2], address(BALANCER_VAULT));
    _approveIfNeeded(BB_AM_USDT, amountsToDeposit[3], address(BALANCER_VAULT));

//    uint j;
//    for (uint i; i < len; ++i) {
//      if (address(tokens[i]) != BB_AM_USD) {
//        _approveIfNeeded(BB_AM_DAI, amountsToDeposit[i], address(BALANCER_VAULT));
//        userDataAmounts[j] = amountsToDeposit[i];
//        j++;
//      }
//    }

    BALANCER_VAULT.joinPool(
      BB_AM_USD_POOL_ID,
      address(this),
      address(this),
      IBVault.JoinPoolRequest({
        assets: _asIAsset(tokens), // must have the same length and order as the array returned by `getPoolTokens`
        maxAmountsIn: amountsToDeposit,
        userData: abi.encode(IBVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, userDataAmounts, 0),
        fromInternalBalance: false
      })
    );

    uint liquidityAfter = IERC20(BB_AM_USD).balanceOf(address(this));
    console.log("balance", BB_AM_USD, address(this), liquidityAfter);

    liquidityOut = liquidityAfter > liquidityOut
      ? liquidityAfter - liquidityOut
      : 0;
    console.log("liquidityAfter", liquidityAfter);
    console.log("liquidityOut", liquidityOut);
  }

  /// @notice Withdraw given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  /// @param liquidityAmount_ Amount to withdraw in bpt
  /// @return amountsOut TODO
  function _depositorExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    console.log("_depositorExit.liquidityAmount_", liquidityAmount_);

    require(liquidityAmount_ <= IERC20(BB_AM_USD).balanceOf(address(this)), AppErrors.NOT_ENOUGH_BALANCE);
    uint[] memory minAmountsOut = new uint[](4); // todo: no limits?

    (IERC20[] memory tokens, uint[] memory balances,) = BALANCER_VAULT.getPoolTokens(BB_AM_USD_POOL_ID);
    uint[] memory bptAmountsOut = getBtpAmountsOut(liquidityAmount_, balances);

    BALANCER_VAULT.exitPool(
      BB_AM_USD_POOL_ID,
      address(this),
      payable(address(this)),
      IBVault.ExitPoolRequest({
        assets: _asIAsset(tokens), // must have the same length and order as the array returned by `getPoolTokens`
        minAmountsOut: minAmountsOut,
        userData: abi.encode(IBVault.ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT, bptAmountsOut, liquidityAmount_),
        toInternalBalance: false
      })
    );

    // now we have amBbXXX tokens; swap them to XXX assets

    // we can create funds_ once and use it several times
    IBVault.FundManagement memory funds_ = IBVault.FundManagement({
      sender: address(this),
      fromInternalBalance: false,
      recipient: payable(address(this)),
      toInternalBalance: false
    });

    amountsOut = new uint[](3);
    amountsOut[0] = _swap(BB_AM_DAI_POOL_ID, BB_AM_DAI, DAI, IERC20(BB_AM_DAI).balanceOf(address(this)), funds_);
    amountsOut[1] = _swap(BB_AM_USDC_POOL_ID, BB_AM_USDC, USDC, IERC20(BB_AM_USDC).balanceOf(address(this)), funds_);
    amountsOut[2] = _swap(BB_AM_USDT_POOL_ID, BB_AM_USDT, USDT, IERC20(BB_AM_USDT).balanceOf(address(this)), funds_);

    return amountsOut;
  }

  /// @notice Quotes output for given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorQuoteExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    (IERC20[] memory tokens, uint[] memory balances,) = BALANCER_VAULT.getPoolTokens(BB_AM_USD_POOL_ID);
    uint[] memory bptAmountsOut = getBtpAmountsOut(liquidityAmount_, balances);
    uint[] memory minAmountsOut = new uint[](4);
    require(liquidityAmount_ <= IERC20(BB_AM_USD).balanceOf(address(this)), AppErrors.NOT_ENOUGH_BALANCE);

    (, amountsOut) = IBalancerHelper(BALANCER_HELPER).queryExit(
      BB_AM_USD_POOL_ID,
      address(this),
      payable(address(this)),
      IBVault.ExitPoolRequest({
        assets: _asIAsset(tokens), // must have the same length and order as the array returned by `getPoolTokens`
        minAmountsOut: minAmountsOut,
        userData: abi.encode(IBVault.ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT, bptAmountsOut, liquidityAmount_),
        toInternalBalance: false
      })
    );
  }

  /// @notice Split {liquidityAmount_} by assets according to proportions of their total balances
  /// @param liquidityAmount_ Amount to withdraw in bpt
  /// @param balances_ Balances received from getPoolTokens
  function getBtpAmountsOut(uint liquidityAmount_, uint[] memory balances_) internal pure returns (uint[] memory) {
    uint totalBalances = balances_[0] + balances_[2] + balances_[3];

    uint[] memory bptAmountsOut = new uint[](3);
    for (uint i; i < 3; i = uncheckedInc(i)) {
      bptAmountsOut[i] = liquidityAmount_ * balances_[i] / totalBalances;
    }

    return bptAmountsOut;
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

  /// @dev see balancer-labs, ERC20Helpers.sol
  function _asIAsset(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }

  /// @dev This empty reserved space is put in place to allow future versions to add new
  /// variables without shifting down storage in the inheritance chain.
  /// See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
  uint[16] private __gap;
}
