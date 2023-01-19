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


/// @title Depositor for Composable Stable Pool with several embedded linear pools like "Balancer Boosted Aave USD"
/// @dev See https://app.balancer.fi/#/polygon/pool/0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b
///            bb-am-DAI (DAI + amDAI) + bb-am-USDC (USDC + amUSDC) + bb-am-USDT (USDT + amUSDT)
///      See https://docs.balancer.fi/products/balancer-pools/boosted-pools for explanation of Boosted Pools on BalanceR.
///      Terms
///         bb-a-USD = pool bpt
///         bb-a-DAI, bb-a-USDC, etc = underlying bpt
abstract contract BalancerComposableStableDepositor is DepositorBase, Initializable {
  using SafeERC20 for IERC20;

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant BALANCER_COMPOSABLE_STABLE_DEPOSITOR_VERSION = "1.0.0";

  /// @dev https://dev.balancer.fi/references/contracts/deployment-addresses
  IBVault private constant BALANCER_VAULT = IBVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
  address private constant BALANCER_HELPER = 0x239e55F427D44C3cc793f49bFB507ebe76638a2b;

  /// @notice For "Balancer Boosted Aave USD": 0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b
  bytes32 public poolId;

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

  /////////////////////////////////////////////////////////////////////
  ///                   Initialization
  /////////////////////////////////////////////////////////////////////

  function __BalancerBoostedAaveUsdDepositor_init(bytes32 poolId_) internal onlyInitializing {
    poolId = poolId_;
  }

  /////////////////////////////////////////////////////////////////////
  ///                       View
  /////////////////////////////////////////////////////////////////////

  /// @notice Returns pool assets, same as getPoolTokens but without pool-bpt
  function _depositorPoolAssets() override internal virtual view returns (address[] memory poolAssets) {
    (IERC20[] memory tokens,,) = BALANCER_VAULT.getPoolTokens(poolId);
    uint bptIndex = IBalancerBoostedAaveStablePool(_getPoolAddress(poolId)).getBptIndex();
    uint len = tokens.length;

    poolAssets = new address[](len - 1);
    uint k;
    for (uint i; i < len; i = uncheckedInc(i)) {
      if (i == bptIndex) continue;

      poolAssets[k] = IBalancerBoostedAavePool(address(tokens[i])).getMainToken();
      ++k;
    }
  }

  /// @notice Returns pool weights
  /// @return weights Array with weights, length = getPoolTokens.tokens - 1 (all assets except BPT)
  /// @return totalWeight Total sum of all items of {weights}
  function _depositorPoolWeights() override internal virtual view returns (uint[] memory weights, uint totalWeight) {
    (IERC20[] memory tokens,,) = BALANCER_VAULT.getPoolTokens(poolId);
    totalWeight = tokens.length - 1; // totalWeight is equal to length of output array here
    weights = new uint[](totalWeight);
    for (uint i; i < totalWeight; i = uncheckedInc(i)) {
      weights[i] = 1;
    }
  }

  /// @notice Total amounts of the main assets under control of the pool, i.e amounts of DAI, USDC, USDT
  /// @return reservesOut Total amounts of embedded assets, i.e. for "Balancer Boosted Aave USD" we return:
  ///                     0: balance DAI + (balance amDAI recalculated to DAI)
  ///                     1: balance USDC + (amUSDC recalculated to USDC)
  ///                     2: balance USDT + (amUSDT recalculated to USDT)
  function _depositorPoolReserves() override internal virtual view returns (uint[] memory reservesOut) {
    (IERC20[] memory tokens,,) = BALANCER_VAULT.getPoolTokens(poolId);
    uint bptIndex = IBalancerBoostedAaveStablePool(_getPoolAddress(poolId)).getBptIndex();
    uint len = tokens.length;
    reservesOut = new uint[](len - 1); // exclude pool-BPT

    uint k;
    for (uint i; i < len; i = uncheckedInc(i)) {
      if (i == bptIndex) continue;
      IBalancerBoostedAavePool linearPool = IBalancerBoostedAavePool(address(tokens[i]));

      // Each bb-am-* returns (main-token, wrapped-token, bb-am-itself), the order of tokens is arbitrary
      // i.e. (DAI + amDAI + bb-am-DAI) or (bb-am-USDC, amUSDC, USDC)

      // get balances of all tokens of bb-am-XXX token, i.e. balances of (DAI, amDAI, bb-am-DAI)
      (, uint256[] memory balances,) = BALANCER_VAULT.getPoolTokens(linearPool.getPoolId());
      uint mainIndex = linearPool.getMainIndex(); // DAI
      uint wrappedIndex = linearPool.getWrappedIndex(); // amDAI

      reservesOut[k] = balances[mainIndex] + balances[wrappedIndex] * linearPool.getWrappedTokenRate() / 1e18;
      ++k;
    }
  }

  /// @notice Returns depositor's pool shares / lp token amount
  function _depositorLiquidity() override internal virtual view returns (uint) {
    console.log("_depositorLiquidity", IBalancerBoostedAaveStablePool(_getPoolAddress(poolId)).balanceOf(address(this)));
    return IBalancerBoostedAaveStablePool(_getPoolAddress(poolId)).balanceOf(address(this));
  }

  //// @notice Total amount of liquidity (LP tokens) in the depositor
  function _depositorTotalSupply() override internal view returns (uint) {
    console.log("_depositorTotalSupply", IBalancerBoostedAaveStablePool(_getPoolAddress(poolId)).getActualSupply());
    return IBalancerBoostedAaveStablePool(_getPoolAddress(poolId)).getActualSupply();
  }


  /////////////////////////////////////////////////////////////////////
  ///             Enter, exit
  /////////////////////////////////////////////////////////////////////

  /// @notice Deposit given amount to the pool.
  /// @param amountsDesired_ Amounts of assets on the balance of the depositor
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  ///         i.e. for "Balancer Boosted Aave USD" we have DAI, USDC, USDT
  /// @return amountsConsumedOut Amounts of assets deposited to balanceR pool
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  /// @return liquidityOut Total amount of liquidity added to balanceR pool in terms of pool-bpt tokens
  function _depositorEnter(uint[] memory amountsDesired_) override internal virtual returns (
    uint[] memory amountsConsumedOut,
    uint liquidityOut
  ) {
    bytes32 _poolId = poolId; // gas saving
    uint bptIndex = IBalancerBoostedAaveStablePool(_getPoolAddress(_poolId)).getBptIndex();

    // The implementation below assumes, that getPoolTokens returns the assets in following order:
    //    bb-am-dai, bb-am-usd, bb-am-usdc, bb-am-usdt
    (IERC20[] memory tokens, uint[] memory balances,) = BALANCER_VAULT.getPoolTokens(_poolId);
    uint len = tokens.length;

    // temporary save current liquidity
    liquidityOut = IBalancerBoostedAaveStablePool(address(tokens[bptIndex])).balanceOf(address(this));
    console.log("Current liquidityOut", liquidityOut);

    // Original amounts can have any values.
    // But we need amounts in such proportions that won't move the current balances
    {
      uint[] memory underlying = BalancerLogicLib.getTotalAssetAmounts(BALANCER_VAULT, tokens, bptIndex);
      amountsConsumedOut = BalancerLogicLib.getAmountsToDeposit(amountsDesired_, tokens, balances, underlying, bptIndex);
    }

    // we can create funds_ once and use it several times
    IBVault.FundManagement memory funds_ = IBVault.FundManagement({
      sender: address(this),
      fromInternalBalance: false,
      recipient: payable(address(this)),
      toInternalBalance: false
    });

    // swap all tokens XX => bb-am-XX
    // we need two arrays with same amounts: amountsToDeposit (with 0 for BB-AM-USD) and userDataAmounts (no BB-AM-USD)
    uint[] memory amountsToDeposit = new uint[](len);
    uint[] memory userDataAmounts = new uint[](len - 1); // no bpt
    uint k;
    for (uint i; i < len; i = uncheckedInc(i)) {
      if (i == bptIndex) continue;
      amountsToDeposit[i] = _swap(
        IBalancerBoostedAavePool(address(tokens[i])).getPoolId(),
        IBalancerBoostedAavePool(address(tokens[i])).getMainToken(),
        address(tokens[i]),
        amountsConsumedOut[k],
        funds_
      );
      userDataAmounts[k] = amountsToDeposit[i];
      _approveIfNeeded(address(tokens[i]), amountsToDeposit[i], address(BALANCER_VAULT));
      ++k;
    }

    // add liquidity to balancer
    BALANCER_VAULT.joinPool(
      _poolId,
      address(this),
      address(this),
      IBVault.JoinPoolRequest({
        assets: _asIAsset(tokens), // must have the same length and order as the array returned by `getPoolTokens`
        maxAmountsIn: amountsToDeposit,
        userData: abi.encode(IBVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, userDataAmounts, 0),
        fromInternalBalance: false
      })
    );

    uint liquidityAfter = IERC20(address(tokens[bptIndex])).balanceOf(address(this));
    console.log("balance", address(tokens[bptIndex]), address(this), liquidityAfter);

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
    console.log("_depositorExit.liquidityAmount_ available", _depositorLiquidity());

    bytes32 _poolId = poolId; // gas saving
    (IERC20[] memory tokens, uint[] memory balances,) = BALANCER_VAULT.getPoolTokens(_poolId);

    uint bptIndex = IBalancerBoostedAaveStablePool(_getPoolAddress(_poolId)).getBptIndex();
    {
      uint[] memory bpt = _getBtpAmountsOut(liquidityAmount_, tokens, balances, bptIndex);
      console.log("bpt[0]", bpt[0]);
      console.log("bpt[1]", bpt[1]);
      console.log("bpt[2]", bpt[2]);
    }
    uint len = tokens.length;

    console.log("tokens[bptIndex].balanceOf(address(this)", tokens[bptIndex].balanceOf(address(this)));
    require(liquidityAmount_ <= tokens[bptIndex].balanceOf(address(this)), AppErrors.NOT_ENOUGH_BALANCE);

    console.log("Exit pool start");
    BALANCER_VAULT.exitPool(
      _poolId,
      address(this),
      payable(address(this)),
      IBVault.ExitPoolRequest({
        assets: _asIAsset(tokens), // must have the same length and order as the array returned by `getPoolTokens`
        minAmountsOut: new uint[](len), // todo: no limits?
        userData: abi.encode(
          IBVault.ExitKindComposableStable.BPT_IN_FOR_EXACT_TOKENS_OUT,
          _getBtpAmountsOut(liquidityAmount_, tokens, balances, bptIndex),
          liquidityAmount_
        ),
        toInternalBalance: false
      })
    );
    console.log("Exit pool done");
    console.log("now liquidityAmount_ available", _depositorLiquidity());

    // now we have amBbXXX tokens; swap them to XXX assets

    // we can create funds_ once and use it several times
    IBVault.FundManagement memory funds_ = IBVault.FundManagement({
      sender: address(this),
      fromInternalBalance: false,
      recipient: payable(address(this)),
      toInternalBalance: false
    });

    amountsOut = new uint[](len - 1);
    uint k;
    for (uint i; i < len; i = uncheckedInc(i)) {
      if (i == bptIndex) continue;
      amountsOut[k] = _swap(
        IBalancerBoostedAavePool(address(tokens[i])).getPoolId(),
        address(tokens[i]),
        IBalancerBoostedAavePool(address(tokens[i])).getMainToken(),
        tokens[i].balanceOf(address(this)),
        funds_
      );
      ++k;
    }
  }

  /// @notice Quotes output for given amount of LP-tokens from the pool.
  /// @dev if requested liquidityAmount >= invested, then should make full exit
  function _depositorQuoteExit(uint liquidityAmount_) override internal virtual returns (uint[] memory amountsOut) {
    bytes32 _poolId = poolId; // gas saving
    uint bptIndex = IBalancerBoostedAaveStablePool(_getPoolAddress(_poolId)).getBptIndex();

    (IERC20[] memory tokens, uint[] memory balances,) = BALANCER_VAULT.getPoolTokens(_poolId);
    require(liquidityAmount_ <= tokens[bptIndex].balanceOf(address(this)), AppErrors.NOT_ENOUGH_BALANCE);

    (, amountsOut) = IBalancerHelper(BALANCER_HELPER).queryExit(
      _poolId,
      address(this),
      payable(address(this)),
      IBVault.ExitPoolRequest({
        assets: _asIAsset(tokens), // must have the same length and order as the array returned by `getPoolTokens`
        minAmountsOut: new uint[](tokens.length),
        userData: abi.encode(
          IBVault.ExitKindComposableStable.BPT_IN_FOR_EXACT_TOKENS_OUT,
          _getBtpAmountsOut(liquidityAmount_, tokens, balances, bptIndex),
          liquidityAmount_
        ),
        toInternalBalance: false
      })
    );
  }

  function _getBtpAmountsOut(
    uint liquidityAmount_,
    IERC20[] memory tokens_,
    uint[] memory balances_,
    uint bptIndex_
  ) internal view returns (uint[] memory bptAmountsOut) {
    IBalancerBoostedAaveStablePool pool = IBalancerBoostedAaveStablePool(_getPoolAddress(poolId));
    uint len = tokens_.length;
    uint[] memory tokenRates = new uint[](len);
    for (uint i = 0; i < len; i = uncheckedInc(i)) {
      if (i == bptIndex_) continue;
      tokenRates[i] = pool.getTokenRate(address(tokens_[i]));
    }
    return BalancerLogicLib.getBtpAmountsOut(liquidityAmount_, balances_, tokenRates, bptIndex_);
  }

  /////////////////////////////////////////////////////////////////////
  ///             Utils for enter/exist
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

    uint balanceBefore = IERC20(assetOut_).balanceOf(address(this));

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

    // we assume here, that the balance cannot be decreased
    return IERC20(assetOut_).balanceOf(address(this)) - balanceBefore;
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

  /// @dev Returns the address of a Pool's contract.
  ///      Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
  function _getPoolAddress(bytes32 id) internal pure returns (address) {
    // 12 byte logical shift left to remove the nonce and specialization setting. We don't need to mask,
    // since the logical shift already sets the upper bits to zero.
    return address(uint160(uint(id) >> (12 * 8)));
  }

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
