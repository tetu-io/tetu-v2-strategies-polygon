// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/aave/AggregatorInterface.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "../../integrations/balancer/IComposableStablePool.sol";
import "../../integrations/balancer/ILinearPool.sol";
import "../../integrations/balancer/IBVault.sol";
// import "hardhat/console.sol";

interface ISwapper {
  function getPrice(
    address pool,
    address tokenIn,
    address tokenOut,
    uint amount
  ) external view returns (uint);
}

/// @notice A source of asset's price for AAVE3 price oracle
///         See price oracle 0xb023e699F5a33916Ea823A16485e259257cA8Bd1
contract Aave3PriceSourceBalancerBoosted is AggregatorInterface {
  IBVault public constant BALANCER_VAULT = IBVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
  ISwapper internal constant BALANCER_COMPOSABLE_STABLE_SWAPPER = ISwapper(0xD93519327c133CC6d0Dc86c4749F2809Aa554a5F);

  IComposableStablePool public pool;
  address public inputToken;
  address public outputToken;

  struct LinearPoolParams {
    uint fee;
    uint lowerTarget;
    uint upperTarget;
  }

  constructor (address pool_, address inputToken_, address outputToken_) {
    pool = IComposableStablePool(pool_);
    // console.log('pool', pool_);
    inputToken = inputToken_;
    outputToken = outputToken_;
  }

  // ---------------  AggregatorInterface ----------------------------------------------------------
  function latestAnswer() external override view returns (int256) {
    return int(_getPrice());
  }

  function latestTimestamp() external override view returns (uint256) {
    return block.timestamp / 60 * 60;
  }

  function latestRound() external override view returns (uint256) {
    return block.timestamp / 60;
  }

  function getAnswer(uint256 /*roundId*/) external override view returns (int256) {
    return int(_getPrice());
  }

  function getTimestamp(uint256 /*roundId*/) external override view returns (uint256) {
    return block.timestamp / 60 * 60;
  }

  // ---------------  Balancer ----------------------------------------------------------

  /// @notice Calculates price in pool
  function _getPrice() internal view returns (uint) {
    uint inputTokenDecimals = IERC20Metadata(inputToken).decimals();
    uint outputTokenDecimals = IERC20Metadata(outputToken).decimals();
    // get input linear bpt price in term of inputToken
    ILinearPool linearInputPool = _getLinearPool(inputToken);
    // console.log('input linear pool', address(linearInputPool));
    uint linearInputBptOut = _calcLinearBptOutPerMainIn(BALANCER_VAULT, linearInputPool, 10 ** inputTokenDecimals);
    // console.log('input linear price', linearInputBptOut);

    // get input linear bpt price in term of output linear bpt
    ILinearPool linearOutputPool = _getLinearPool(outputToken);
    // console.log('output linear pool', address(linearOutputPool));
    uint linearOutputBptOut = BALANCER_COMPOSABLE_STABLE_SWAPPER.getPrice(address(pool), address(linearInputPool), address(linearOutputPool), linearInputBptOut);
    // console.log('bpt swap price', linearOutputBptOut);

    // get output linear bpt price in term of outputToken
    uint price = _calcLinearMainOutPerBptIn(BALANCER_VAULT, linearOutputPool, linearOutputBptOut);
    // console.log('output linear price', price);

    if (outputTokenDecimals > 8) {
      price = price / 10 ** (outputTokenDecimals - 8);
    } else if (outputTokenDecimals < 8) {
      price = price * 10 ** (8 - outputTokenDecimals);
    }

    return price;
  }

  function _getLinearPool(address mainToken) internal view returns (ILinearPool) {
    bytes32 rootPoolId = pool.getPoolId();
    (IERC20[] memory rootTokens,,) = BALANCER_VAULT.getPoolTokens(rootPoolId);
    uint bptIndex = pool.getBptIndex();
    for (uint i; i < rootTokens.length; ++i) {
      if (i != bptIndex) {
        ILinearPool lpool = ILinearPool(address(rootTokens[i]));
        if (lpool.getMainToken() == mainToken) {
          return lpool;
        }
      }
    }
    revert('Incorrect tokenIn');
  }

  function _calcLinearBptOutPerMainIn(IBVault vault, ILinearPool pool_, uint amount) internal view returns (uint) {
    (uint lowerTarget, uint upperTarget) = pool_.getTargets();
    LinearPoolParams memory params = LinearPoolParams(pool_.getSwapFeePercentage(), lowerTarget, upperTarget);
    (,uint[] memory balances,) = vault.getPoolTokens(pool_.getPoolId());
    uint[] memory scalingFactors = pool_.getScalingFactors();
    _upscaleArray(balances, scalingFactors);
    uint mainIndex = pool_.getMainIndex();
    amount *= scalingFactors[mainIndex] / 1e18;
    uint mainBalance = balances[mainIndex];
    uint bptSupply = pool_.totalSupply() - balances[0];
    uint previousNominalMain = _toNominal(mainBalance, params);
    uint afterNominalMain = _toNominal(mainBalance + amount, params);
    uint deltaNominalMain = afterNominalMain - previousNominalMain;
    uint invariant = previousNominalMain + balances[pool_.getWrappedIndex()];
    return bptSupply * deltaNominalMain / invariant * 1e18 / scalingFactors[0];
  }

  function _calcLinearMainOutPerBptIn(IBVault vault, ILinearPool pool_, uint amount) internal view returns (uint) {
    (uint lowerTarget, uint upperTarget) = pool_.getTargets();
    LinearPoolParams memory params = LinearPoolParams(pool_.getSwapFeePercentage(), lowerTarget, upperTarget);
    (,uint[] memory balances,) = vault.getPoolTokens(pool_.getPoolId());
    uint[] memory scalingFactors = pool_.getScalingFactors();
    _upscaleArray(balances, scalingFactors);
    amount *= scalingFactors[0] / 1e18;
    uint mainIndex = pool_.getMainIndex();
    uint mainBalance = balances[mainIndex];
    uint bptSupply = pool_.totalSupply() - balances[0];
    uint previousNominalMain = _toNominal(mainBalance, params);
    uint invariant = previousNominalMain + balances[pool_.getWrappedIndex()];
    uint deltaNominalMain = invariant * amount / bptSupply;
    uint afterNominalMain = previousNominalMain > deltaNominalMain ? previousNominalMain - deltaNominalMain : 0;
    uint newMainBalance = _fromNominal(afterNominalMain, params);
    return (mainBalance - newMainBalance) * 1e18 / scalingFactors[mainIndex];
  }

  function _toNominal(uint real, LinearPoolParams memory params) internal pure returns (uint) {
    if (real < params.lowerTarget) {
      uint fees = (params.lowerTarget - real) * params.fee / 1e18;
      return real - fees;
    } else if (real <= params.upperTarget) {
      return real;
    } else {
      uint fees = (real - params.upperTarget) * params.fee / 1e18;
      return real - fees;
    }
  }

  function _fromNominal(uint nominal, LinearPoolParams memory params) internal pure returns (uint) {
    if (nominal < params.lowerTarget) {
      return (nominal + (params.fee * params.lowerTarget / 1e18)) * 1e18 / (1e18 + params.fee);
    } else if (nominal <= params.upperTarget) {
      return nominal;
    } else {
      return (nominal - (params.fee * params.upperTarget / 1e18)) * 1e18/ (1e18 - params.fee);
    }
  }

  function _upscaleArray(uint[] memory amounts, uint[] memory scalingFactors) internal pure {
    uint length = amounts.length;
    for (uint i; i < length; ++i) {
      amounts[i] = amounts[i] * scalingFactors[i] / 1e18;
    }
  }
}
