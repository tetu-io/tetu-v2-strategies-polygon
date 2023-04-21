// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "../../libs/AppErrors.sol";
import "../../libs/AppLib.sol";
import "../../libs/TokenAmountsLib.sol";
import "../../integrations/balancer/IComposableStablePool.sol";
import "../../integrations/balancer/ILinearPool.sol";
import "../../integrations/balancer/IBVault.sol";
import "../../integrations/balancer/IBalancerHelper.sol";
import "../../integrations/balancer/IBalancerGauge.sol";

/// @notice Functions of BalancerBoostedDepositor
/// @dev Many of functions are declared as external to reduce contract size
library BalancerLogicLib {
  using SafeERC20 for IERC20;

  /////////////////////////////////////////////////////////////////////
  ///             Types
  /////////////////////////////////////////////////////////////////////

  /// @dev local vars in getAmountsToDeposit to avoid stack too deep
  struct LocalGetAmountsToDeposit {
    /// @notice Decimals of {tokens_}, 0 for BPT
    uint[] decimals;
    /// @notice Length of {tokens_} array
    uint len;
    /// @notice amountBPT / underlyingAmount, decimals 18, 0 for BPT
    uint[] rates;
  }

  /// @notice Local variables required inside _depositorEnter/Exit/QuoteExit, avoid stack too deep
  struct DepositorLocal {
    uint bptIndex;
    uint len;
    IERC20[] tokens;
    uint[] balances;
  }

  /////////////////////////////////////////////////////////////////////
  ///             Asset related utils
  /////////////////////////////////////////////////////////////////////

  /// @notice Calculate amounts of {tokens} to be deposited to POOL_ID in proportions according to the {balances}
  /// @param amountsDesired_ Desired amounts of tokens. The order of the tokens is exactly the same as in {tokens}.
  ///                        But the array has length 3, not 4, because there is no amount for bb-am-USD here.
  /// @param tokens_ All bb-am-* tokens (including bb-am-USD) received through getPoolTokens
  ///                           The order of the tokens is exactly the same as in getPoolTokens-results
  /// @param balances_ Balances of bb-am-* pools in terms of bb-am-USD tokens (received through getPoolTokens)
  ///                           The order of the tokens is exactly the same as in {tokens}
  /// @param totalUnderlying_ Total amounts of underlying assets (DAI, USDC, etc) in embedded linear pools.
  ///                         The array should have same order of tokens as {tokens_}, value for BPT token is not used
  /// @param indexBpt_ Index of BPT token inside {balances_}, {tokens_} and {totalUnderlying_} arrays
  /// @return amountsOut Desired amounts in proper proportions for depositing.
  ///         The order of the tokens is exactly the same as in results of getPoolTokens, 0 for BPT
  ///         i.e. DAI, BB-AM-USD, USDC, USDT
  function getAmountsToDeposit(
    uint[] memory amountsDesired_,
    IERC20[] memory tokens_,
    uint[] memory balances_,
    uint[] memory totalUnderlying_,
    uint indexBpt_
  ) internal view returns (
    uint[] memory amountsOut
  ) {
    LocalGetAmountsToDeposit memory p;
    // check not zero balances, cache index of bbAmUSD, save 10**decimals to array
    p.len = tokens_.length;
    require(p.len == balances_.length, AppErrors.WRONG_LENGTHS);
    require(p.len == amountsDesired_.length || p.len - 1 == amountsDesired_.length, AppErrors.WRONG_LENGTHS);

    p.decimals = new uint[](p.len);
    p.rates = new uint[](p.len);
    for (uint i = 0; i < p.len; i = AppLib.uncheckedInc(i)) {
      if (i != indexBpt_) {
        require(balances_[i] != 0, AppErrors.ZERO_BALANCE);
        p.decimals[i] = 10 ** IERC20Metadata(address(tokens_[i])).decimals();

        // Let's calculate a rate: amountBPT / underlyingAmount, decimals 18
        p.rates[i] = balances_[i] * 1e18 / totalUnderlying_[i];
      }
    }

    amountsOut = new uint[](p.len - 1);

    // The balances set proportions of underlying-bpt, i.e. bb-am-DAI : bb-am-USDC : bb-am-USDT
    // Our task is find amounts of DAI : USDC : USDT that won't change that proportions after deposit.
    // We have arbitrary desired amounts, i.e. DAI = X, USDC = Y, USDT = Z
    // For each token: assume that it can be used in full.
    // If so, what amounts will have other tokens in this case according to the given proportions?
    // i.e. DAI = X = 100.0 => USDC = 200.0, USDT = 400.0. We need: Y >= 200, Z >= 400
    // or   USDC = Y = 100.0 => DAI = 50.0, USDT = 200.0. We need: X >= 50, Z >= 200
    // If any amount is less then expected, the token cannot be used in full.
    // A token with min amount can be used in full, let's try to find its index.
    // [0 : len - 1]
    uint i3;
    for (uint i; i < p.len; i = AppLib.uncheckedInc(i)) {
      if (indexBpt_ == i) continue;

      uint amountInBpt18 = amountsDesired_[i3] * p.rates[i];

      // [0 : len]
      uint j;
      // [0 : len - 1]
      uint j3;
      for (; j < p.len; j = AppLib.uncheckedInc(j)) {
        if (indexBpt_ == j) continue;

        // alpha = balancesDAI / balancesUSDC * decimalsDAI / decimalsUSDC
        // amountDAI = amountUSDC * alpha * rateUSDC / rateDAI
        amountsOut[j3] = amountInBpt18 * balances_[j] / p.rates[j] * p.decimals[j] / balances_[i] / p.decimals[i];
        if (amountsOut[j3] > amountsDesired_[j3]) break;
        j3++;
      }

      if (j == p.len) break;
      i3++;
    }
  }


  /// @notice Calculate total amount of underlying asset for each token except BPT
  /// @dev Amount is calculated as MainTokenAmount + WrappedTokenAmount * WrappedTokenRate, see AaveLinearPool src
  function getTotalAssetAmounts(IBVault vault_, IERC20[] memory tokens_, uint indexBpt_) internal view returns (
    uint[] memory amountsOut
  ) {
    uint len = tokens_.length;
    amountsOut = new uint[](len);
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i != indexBpt_) {
        ILinearPool linearPool = ILinearPool(address(tokens_[i]));
        (, uint[] memory balances,) = vault_.getPoolTokens(linearPool.getPoolId());

        amountsOut[i] =
        balances[linearPool.getMainIndex()]
        + balances[linearPool.getWrappedIndex()] * linearPool.getWrappedTokenRate() / 1e18;
      }
    }
  }

  /// @notice Split {liquidityAmount_} by assets according to proportions of their total balances
  /// @param liquidityAmount_ Amount to withdraw in bpt
  /// @param balances_ Balances received from getPoolTokens
  /// @param bptIndex_ Index of pool-pbt inside {balances_}
  /// @return bptAmountsOut Amounts of underlying-BPT. The array doesn't include an amount for pool-bpt
  ///         Total amount of {bptAmountsOut}-items is equal to {liquidityAmount_}
  function getBtpAmountsOut(
    uint liquidityAmount_,
    uint[] memory balances_,
    uint bptIndex_
  ) internal pure returns (uint[] memory bptAmountsOut) {
    // we assume here, that len >= 2
    // we don't check it because StableMath.sol in balancer has _MIN_TOKENS = 2;
    uint len = balances_.length;
    bptAmountsOut = new uint[](len - 1);

    // compute total balance, skip pool-bpt
    uint totalBalances;
    uint k;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == bptIndex_) continue;
      totalBalances += balances_[i];
      // temporary save incomplete amounts to bptAmountsOut
      bptAmountsOut[k] = liquidityAmount_ * balances_[i];
      ++k;
    }

    // finalize computation of bptAmountsOut using known totalBalances
    uint total;
    for (k = 0; k < len - 1; k = AppLib.uncheckedInc(k)) {
      if (k == len - 2) {
        // leftovers => last item
        bptAmountsOut[k] = total > liquidityAmount_
        ? 0
        : liquidityAmount_ - total;
      } else {
        bptAmountsOut[k] /= totalBalances;
        total += bptAmountsOut[k];
      }
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///             Depositor view logic
  /////////////////////////////////////////////////////////////////////
  /// @notice Total amounts of the main assets under control of the pool, i.e amounts of USDT, USDC, DAI
  /// @return reservesOut Total amounts of embedded assets, i.e. for "Balancer Boosted Tetu USD" we return:
  ///                     0: balance USDT + (tUSDT recalculated to USDT)
  ///                     1: balance USDC + (tUSDC recalculated to USDC)
  ///                     2: balance DAI + (balance tDAI recalculated to DAI)
  function depositorPoolReserves(IBVault vault_, bytes32 poolId_) external view returns (uint[] memory reservesOut) {
    (IERC20[] memory tokens,,) = vault_.getPoolTokens(poolId_);
    uint bptIndex = IComposableStablePool(getPoolAddress(poolId_)).getBptIndex();
    uint len = tokens.length;
    // exclude pool-BPT
    reservesOut = new uint[](len - 1);

    uint k;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == bptIndex) continue;
      ILinearPool linearPool = ILinearPool(address(tokens[i]));

      // Each bb-t-* returns (main-token, wrapped-token, bb-t-itself), the order of tokens is arbitrary
      // i.e. (DAI + tDAI + bb-t-DAI) or (bb-t-USDC, tUSDC, USDC)

      // get balances of all tokens of bb-am-XXX token, i.e. balances of (DAI, amDAI, bb-am-DAI)
      (, uint256[] memory balances,) = vault_.getPoolTokens(linearPool.getPoolId());
      // DAI
      uint mainIndex = linearPool.getMainIndex();
      // tDAI
      uint wrappedIndex = linearPool.getWrappedIndex();

      reservesOut[k] = balances[mainIndex] + balances[wrappedIndex] * linearPool.getWrappedTokenRate() / 1e18;
      ++k;
    }
  }

  /// @notice Returns pool assets, same as getPoolTokens but without pool-bpt
  function depositorPoolAssets(IBVault vault_, bytes32 poolId_) external view returns (address[] memory poolAssets) {
    (IERC20[] memory tokens,,) = vault_.getPoolTokens(poolId_);
    uint bptIndex = IComposableStablePool(getPoolAddress(poolId_)).getBptIndex();
    uint len = tokens.length;

    poolAssets = new address[](len - 1);
    uint k;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i == bptIndex) continue;

      poolAssets[k] = ILinearPool(address(tokens[i])).getMainToken();
      ++k;
    }
  }

  /// @notice Returns pool weights
  /// @return weights Array with weights, length = getPoolTokens.tokens - 1 (all assets except BPT)
  /// @return totalWeight Total sum of all items of {weights}
  function depositorPoolWeights(IBVault vault_, bytes32 poolId_) external view returns (
    uint[] memory weights,
    uint totalWeight
  ) {
    (IERC20[] memory tokens,uint256[] memory balances,) = vault_.getPoolTokens(poolId_);
    uint len = tokens.length;
    uint bptIndex = IComposableStablePool(getPoolAddress(poolId_)).getBptIndex();
    weights = new uint[](len - 1);
    uint j;
    for (uint i; i < len; i = AppLib.uncheckedInc(i)) {
      if (i != bptIndex) {
        totalWeight += balances[i];
        weights[j] = balances[i];
        j = AppLib.uncheckedInc(j);
      }
    }
  }

  /////////////////////////////////////////////////////////////////////
  ///             Depositor enter, exit logic
  /////////////////////////////////////////////////////////////////////
  /// @notice Deposit given amount to the pool.
  /// @param amountsDesired_ Amounts of assets on the balance of the depositor
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  ///         i.e. for "Balancer Boosted Aave USD" we have DAI, USDC, USDT
  /// @return amountsConsumedOut Amounts of assets deposited to balanceR pool
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  /// @return liquidityOut Total amount of liquidity added to balanceR pool in terms of pool-bpt tokens
  function depositorEnter(IBVault vault_, bytes32 poolId_, uint[] memory amountsDesired_) external returns (
    uint[] memory amountsConsumedOut,
    uint liquidityOut
  ) {
    DepositorLocal memory p;

    // The implementation below assumes, that getPoolTokens returns the assets in following order:
    //    bb-am-dai, bb-am-usd, bb-am-usdc, bb-am-usdt
    (p.tokens, p.balances,) = vault_.getPoolTokens(poolId_);
    p.len = p.tokens.length;
    p.bptIndex = IComposableStablePool(getPoolAddress(poolId_)).getBptIndex();

    // temporary save current liquidity
    liquidityOut = IComposableStablePool(address(p.tokens[p.bptIndex])).balanceOf(address(this));

    // Original amounts can have any values.
    // But we need amounts in such proportions that won't move the current balances
    {
      uint[] memory underlying = BalancerLogicLib.getTotalAssetAmounts(vault_, p.tokens, p.bptIndex);
      amountsConsumedOut = BalancerLogicLib.getAmountsToDeposit(amountsDesired_, p.tokens, p.balances, underlying, p.bptIndex);
    }

    // we can create funds_ once and use it several times
    IBVault.FundManagement memory funds = IBVault.FundManagement({
      sender : address(this),
      fromInternalBalance : false,
      recipient : payable(address(this)),
      toInternalBalance : false
    });

    // swap all tokens XX => bb-am-XX
    // we need two arrays with same amounts: amountsToDeposit (with 0 for BB-AM-USD) and userDataAmounts (no BB-AM-USD)
    uint[] memory amountsToDeposit = new uint[](p.len);
    // no bpt
    uint[] memory userDataAmounts = new uint[](p.len - 1);
    uint k;
    for (uint i; i < p.len; i = AppLib.uncheckedInc(i)) {
      if (i == p.bptIndex) continue;
      amountsToDeposit[i] = BalancerLogicLib.swap(
        vault_,
        ILinearPool(address(p.tokens[i])).getPoolId(),
        ILinearPool(address(p.tokens[i])).getMainToken(),
        address(p.tokens[i]),
        amountsConsumedOut[k],
        funds
      );
      userDataAmounts[k] = amountsToDeposit[i];
      AppLib.approveIfNeeded(address(p.tokens[i]), amountsToDeposit[i], address(vault_));
      ++k;
    }

    // add liquidity to balancer
    vault_.joinPool(
      poolId_,
      address(this),
      address(this),
      IBVault.JoinPoolRequest({
        assets : asIAsset(p.tokens), // must have the same length and order as the array returned by `getPoolTokens`
        maxAmountsIn : amountsToDeposit,
        userData : abi.encode(IBVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, userDataAmounts, 0),
        fromInternalBalance : false
      })
    );

    uint liquidityAfter = IERC20(address(p.tokens[p.bptIndex])).balanceOf(address(this));

    liquidityOut = liquidityAfter > liquidityOut
    ? liquidityAfter - liquidityOut
    : 0;
  }

  /// @notice Withdraw given amount of LP-tokens from the pool.
  /// @param liquidityAmount_ Amount to withdraw in bpt
  /// @return amountsOut Result amounts of underlying (DAI, USDC..) that will be received from BalanceR
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  function depositorExit(IBVault vault_, bytes32 poolId_, uint liquidityAmount_) external returns (
    uint[] memory amountsOut
  ) {
    DepositorLocal memory p;

    p.bptIndex = IComposableStablePool(getPoolAddress(poolId_)).getBptIndex();
    (p.tokens, p.balances,) = vault_.getPoolTokens(poolId_);
    p.len = p.tokens.length;

    require(liquidityAmount_ <= p.tokens[p.bptIndex].balanceOf(address(this)), AppErrors.NOT_ENOUGH_BALANCE);

    // BalancerR can spend a bit less amount of liquidity than {liquidityAmount_}
    // i.e. we if liquidityAmount_ = 2875841, we can have leftovers = 494 after exit
    vault_.exitPool(
      poolId_,
      address(this),
      payable(address(this)),
      IBVault.ExitPoolRequest({
        assets : asIAsset(p.tokens), // must have the same length and order as the array returned by `getPoolTokens`
        minAmountsOut : new uint[](p.len), // no limits
        userData : abi.encode(IBVault.ExitKindComposableStable.EXACT_BPT_IN_FOR_ALL_TOKENS_OUT, liquidityAmount_),
        toInternalBalance : false
      })
    );

    // now we have amBbXXX tokens; swap them to XXX assets

    // we can create funds_ once and use it several times
    IBVault.FundManagement memory funds = IBVault.FundManagement({
    sender : address(this),
    fromInternalBalance : false,
    recipient : payable(address(this)),
    toInternalBalance : false
    });

    amountsOut = new uint[](p.len - 1);
    uint k;
    for (uint i; i < p.len; i = AppLib.uncheckedInc(i)) {
      if (i == p.bptIndex) continue;
      uint amountIn = p.tokens[i].balanceOf(address(this));
      if (amountIn != 0) {
        amountsOut[k] = swap(
          vault_,
          ILinearPool(address(p.tokens[i])).getPoolId(),
          address(p.tokens[i]),
          ILinearPool(address(p.tokens[i])).getMainToken(),
          amountIn,
          funds
        );
      }
      ++k;
    }
  }

  /// @notice Withdraw all available amount of LP-tokens from the pool
  ///         BalanceR doesn't allow to withdraw exact amount, so it's allowed to leave dust amount on the balance
  /// @dev We make at most N attempts to withdraw (not more, each attempt takes a lot of gas).
  ///      Each attempt reduces available balance at ~1e4 times.
  /// @return amountsOut Result amounts of underlying (DAI, USDC..) that will be received from BalanceR
  ///                    The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  function depositorExitFull(IBVault vault_, bytes32 poolId_) external returns (
    uint[] memory amountsOut
  ) {
    DepositorLocal memory p;

    p.bptIndex = IComposableStablePool(getPoolAddress(poolId_)).getBptIndex();
    (p.tokens, p.balances,) = vault_.getPoolTokens(poolId_);
    p.len = p.tokens.length;
    amountsOut = new uint[](p.len - 1);

    // we can create funds_ once and use it several times
    IBVault.FundManagement memory funds = IBVault.FundManagement({
      sender : address(this),
      fromInternalBalance : false,
      recipient : payable(address(this)),
      toInternalBalance : false
    });

    uint liquidityAmount = p.tokens[p.bptIndex].balanceOf(address(this));
    if (liquidityAmount > 0) {
      uint liquidityThreshold = 10 ** IERC20Metadata(address(p.tokens[p.bptIndex])).decimals() / 100;

      // we can make at most N attempts to withdraw amounts from the balanceR pool
      for (uint i = 0; i < 2; ++i) {
        vault_.exitPool(
          poolId_,
          address(this),
          payable(address(this)),
          IBVault.ExitPoolRequest({
            assets : asIAsset(p.tokens),
            minAmountsOut : new uint[](p.len), // no limits
            userData : abi.encode(IBVault.ExitKindComposableStable.EXACT_BPT_IN_FOR_ALL_TOKENS_OUT, liquidityAmount),
            toInternalBalance : false
          })
        );
        liquidityAmount = p.tokens[p.bptIndex].balanceOf(address(this));
        if (liquidityAmount < liquidityThreshold || i == 1) {
          break;
        }
        (, p.balances,) = vault_.getPoolTokens(poolId_);
      }

      // now we have amBbXXX tokens; swap them to XXX assets
      uint k;
      for (uint i; i < p.len; i = AppLib.uncheckedInc(i)) {
        if (i == p.bptIndex) continue;

        uint amountIn = p.tokens[i].balanceOf(address(this));
        if (amountIn != 0) {
          amountsOut[k] = swap(
            vault_,
            ILinearPool(address(p.tokens[i])).getPoolId(),
            address(p.tokens[i]),
            ILinearPool(address(p.tokens[i])).getMainToken(),
            amountIn,
            funds
          );
        }
        ++k;
      }
    }

    uint depositorBalance = p.tokens[p.bptIndex].balanceOf(address(this));
    if (depositorBalance > 0) {
      uint k = 0;
      for (uint i; i < p.len; i = AppLib.uncheckedInc(i)) {
        if (i == p.bptIndex) continue;

        // we assume here, that the depositorBalance is small
        // so we can directly swap it to any single asset without changing of pool resources proportions
        amountsOut[k] += _convertSmallBptRemainder(vault_, poolId_, p, funds, depositorBalance, i);
        break;
      }
    }

    return amountsOut;
  }

  /// @notice convert remained SMALL amount of bpt => am-bpt => main token of the am-bpt
  /// @return amountOut Received amount of am-bpt's main token
  function _convertSmallBptRemainder(
    IBVault vault_,
    bytes32 poolId_,
    DepositorLocal memory p,
    IBVault.FundManagement memory funds,
    uint bptAmountIn_,
    uint indexTargetAmBpt_
  ) internal returns (uint amountOut) {
    uint amountAmBpt = BalancerLogicLib.swap(
      vault_,
      poolId_,
      address(p.tokens[p.bptIndex]),
      address(p.tokens[indexTargetAmBpt_]),
      bptAmountIn_,
      funds
    );
    amountOut = swap(
      vault_,
      ILinearPool(address(p.tokens[indexTargetAmBpt_])).getPoolId(),
      address(p.tokens[indexTargetAmBpt_]),
      ILinearPool(address(p.tokens[indexTargetAmBpt_])).getMainToken(),
      amountAmBpt,
      funds
    );
  }

  /// @notice Quotes output for given amount of LP-tokens from the pool.
  /// @return amountsOut Result amounts of underlying (DAI, USDC..) that will be received from BalanceR
  ///         The order of assets is the same as in getPoolTokens, but there is no pool-bpt
  function depositorQuoteExit(
    IBVault vault_,
    IBalancerHelper helper_,
    bytes32 poolId_,
    uint liquidityAmount_
  ) external returns (
    uint[] memory amountsOut
  ) {
    DepositorLocal memory p;

    p.bptIndex = IComposableStablePool(getPoolAddress(poolId_)).getBptIndex();
    (p.tokens, p.balances,) = vault_.getPoolTokens(poolId_);
    p.len = p.tokens.length;

    // bpt - amount of unconverted bpt
    // let's temporary save total amount of converted BPT there
    (uint256 bpt, uint[] memory amountsBpt) = helper_.queryExit(
      poolId_,
      address(this),
      payable(address(this)),
      IBVault.ExitPoolRequest({
        assets : asIAsset(p.tokens),
        minAmountsOut : new uint[](p.len), // no limits
        userData : abi.encode(
        IBVault.ExitKindComposableStable.EXACT_BPT_IN_FOR_ALL_TOKENS_OUT,
        liquidityAmount_
      ),
    toInternalBalance : false
    })
    );

    // amount of unconverted bpt, we need to take them into account for correct calculation of investedAssets amount
    bpt = bpt < liquidityAmount_
    ? liquidityAmount_ - bpt
    : 0;

    IBVault.FundManagement memory funds = IBVault.FundManagement({
    sender : address(this),
    fromInternalBalance : false,
    recipient : payable(address(this)),
    toInternalBalance : false
    });
    IBVault.BatchSwapStep[] memory steps = new IBVault.BatchSwapStep[](p.len - 1);
    IAsset[] memory assets = new IAsset[](2 * (p.len - 1));
    uint k;
    for (uint i = 0; i < p.len; i = AppLib.uncheckedInc(i)) {
      if (i == p.bptIndex) continue;
      if (bpt != 0) {
        // take into account the cost of unused BPT by directly converting them to first available amBPT
        int[] memory deltas = _convertBptToAmBpt(vault_, poolId_, p.tokens[p.bptIndex], bpt, p.tokens[i], funds);
        if (deltas[0] > 0) {
          bpt = (bpt < uint(deltas[0]))
          ? bpt - uint(deltas[0])
          : 0;
          amountsBpt[i] += (deltas[1] < 0)
          ? uint(- deltas[1])
          : 0;
        }
      }
      ILinearPool linearPool = ILinearPool(address(p.tokens[i]));
      steps[k].poolId = linearPool.getPoolId();
      steps[k].assetInIndex = 2 * k + 1;
      steps[k].assetOutIndex = 2 * k;
      steps[k].amount = amountsBpt[i];

      assets[2 * k] = IAsset(linearPool.getMainToken());
      assets[2 * k + 1] = IAsset(address(p.tokens[i]));
      ++k;
    }

    int[] memory assetDeltas = vault_.queryBatchSwap(IBVault.SwapKind.GIVEN_IN, steps, assets, funds);

    amountsOut = new uint[](p.len - 1);
    k = 0;
    for (uint i = 0; i < p.len; i = AppLib.uncheckedInc(i)) {
      if (i == p.bptIndex) continue;
      amountsOut[k] = assetDeltas[2 * k] < 0
      ? uint256(- assetDeltas[2 * k])
      : 0;

      ++k;
    }
  }

  function _convertBptToAmBpt(
    IBVault vault_,
    bytes32 poolId_,
    IERC20 bptToken,
    uint amountBpt,
    IERC20 amBptToken,
    IBVault.FundManagement memory funds
  ) internal returns (
    int[] memory assetDeltas
  ) {
    IAsset[] memory assets = new IAsset[](2);
    assets[0] = IAsset(address(bptToken));
    assets[1] = IAsset(address(amBptToken));

    IBVault.BatchSwapStep[] memory steps = new IBVault.BatchSwapStep[](1);
    steps[0].poolId = poolId_;
    steps[0].assetInIndex = 0;
    steps[0].assetOutIndex = 1;
    steps[0].amount = amountBpt;

    return vault_.queryBatchSwap(IBVault.SwapKind.GIVEN_IN, steps, assets, funds);
  }

  /// @notice Swap given {amountIn_} of {assetIn_} to {assetOut_} using the given BalanceR pool
  function swap(
    IBVault vault_,
    bytes32 poolId_,
    address assetIn_,
    address assetOut_,
    uint amountIn_,
    IBVault.FundManagement memory funds_
  ) internal returns (uint amountOut) {
    uint balanceBefore = IERC20(assetOut_).balanceOf(address(this));

    IERC20(assetIn_).approve(address(vault_), amountIn_);
    vault_.swap(
      IBVault.SingleSwap({
    poolId : poolId_,
    kind : IBVault.SwapKind.GIVEN_IN,
    assetIn : IAsset(assetIn_),
    assetOut : IAsset(assetOut_),
    amount : amountIn_,
    userData : bytes("")
    }),
      funds_,
      1,
      block.timestamp
    );

    // we assume here, that the balance cannot be decreased
    amountOut = IERC20(assetOut_).balanceOf(address(this)) - balanceBefore;
  }

  /////////////////////////////////////////////////////////////////////
  ///             Rewards
  /////////////////////////////////////////////////////////////////////

  function depositorClaimRewards(IBalancerGauge gauge_, address[] memory tokens_, address[] memory rewardTokens_) external returns (
    address[] memory tokensOut,
    uint[] memory amountsOut,
    uint[] memory depositorBalancesBefore
  ) {
    uint tokensLen = tokens_.length;
    uint rewardTokensLen = rewardTokens_.length;

    tokensOut = new address[](rewardTokensLen);
    amountsOut = new uint[](rewardTokensLen);
    depositorBalancesBefore = new uint[](tokensLen);

    for (uint i; i < tokensLen; i = AppLib.uncheckedInc(i)) {
      depositorBalancesBefore[i] = IERC20(tokens_[i]).balanceOf(address(this));
    }

    for (uint i; i < rewardTokensLen; i = AppLib.uncheckedInc(i)) {
      tokensOut[i] = rewardTokens_[i];

      // temporary store current reward balance
      amountsOut[i] = IERC20(rewardTokens_[i]).balanceOf(address(this));
    }

    gauge_.claim_rewards();

    for (uint i; i < rewardTokensLen; i = AppLib.uncheckedInc(i)) {
      amountsOut[i] = IERC20(rewardTokens_[i]).balanceOf(address(this)) - amountsOut[i];
    }

    (tokensOut, amountsOut) = TokenAmountsLib.filterZeroAmounts(tokensOut, amountsOut);
  }

  /////////////////////////////////////////////////////////////////////
  ///             Utils
  /////////////////////////////////////////////////////////////////////

  /// @dev Returns the address of a Pool's contract.
  ///      Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
  function getPoolAddress(bytes32 id) internal pure returns (address) {
    // 12 byte logical shift left to remove the nonce and specialization setting. We don't need to mask,
    // since the logical shift already sets the upper bits to zero.
    return address(uint160(uint(id) >> (12 * 8)));
  }

  /// @dev see balancer-labs, ERC20Helpers.sol
  function asIAsset(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }
}
