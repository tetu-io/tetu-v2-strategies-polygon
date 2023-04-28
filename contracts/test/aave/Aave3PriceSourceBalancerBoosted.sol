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
  ISwapper internal constant BALANCER_COMPOSABLE_STABLE_SWAPPER = ISwapper(0xab6F8E82ddea3Ee2Ad192cfe92dD608f4ad7d574);

  IComposableStablePool public pool;
  address public inputToken;
  address public outputToken;

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

  /// @notice Calculates price in pool
  /// todo dont use getRate() that doesn't take into account scaling factors
  function _getPrice() internal view returns (uint) {
    // get input linear bpt price in term of inputToken
    ILinearPool linearInputPool = _getLinearPool(inputToken);
    // console.log('input linear pool', address(linearInputPool));
    uint linearInputBptPrice = linearInputPool.getRate();
    // console.log('input linear price', linearInputBptPrice);

    // get input linear bpt price in term of output linear bpt
    ILinearPool linearOutputPool = _getLinearPool(outputToken);
    // console.log('output linear pool', address(linearOutputPool));
    uint bptSwapPrice = BALANCER_COMPOSABLE_STABLE_SWAPPER.getPrice(address(pool), address(linearInputPool), address(linearOutputPool), 1e18);
    // console.log('bpt swap price', bptSwapPrice);

    // get output linear bpt price in term of outputToken
    uint linearOutputBptPrice = linearOutputPool.getRate();
    // console.log('output linear price', linearOutputBptPrice);

    // get inputToken price in term of outputToken
    uint price = bptSwapPrice * linearOutputBptPrice / linearInputBptPrice / 1e10;
    // console.log('Aave3PriceSourceBalancerBoosted _getPrice inputToken', inputToken);
    // console.log('Aave3PriceSourceBalancerBoosted _getPrice price', price);
    return price;
  }
}
