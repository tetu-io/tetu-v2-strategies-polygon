// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";

import "../integrations/balancer/ILinearPoolRebalancer.sol";
import "../integrations/balancer/ILinearPoolSimple.sol";
import "../integrations/balancer/IBVault.sol";
import "../tools/RebalancerWithExtraMain.sol";

contract BoostedPoolsRebalanceResolver is OwnableUpgradeable {
  using SafeERC20 for IERC20;

  uint public constant TETU_DENOMINATOR = 1000;
  uint public constant DEFAULT_EXTRA_MAIN = 1000000;

  address public rebalancerWithExtraMain;
  uint public tetuNominator;

  address [] public activeRebalancers;

  function initialize(address _rebalancerWithExtraMain, uint _tetuNominator) public initializer {
    __Ownable_init();
    rebalancerWithExtraMain = _rebalancerWithExtraMain;
    tetuNominator = _tetuNominator;
  }

  function setNominator(uint _tetuNominator) external onlyOwner {
    tetuNominator = _tetuNominator;
  }

  function updateRebalancers(address[] calldata _rebalancers) external onlyOwner {
    activeRebalancers = _rebalancers;
  }


  function checker() external view returns (bool canExec, bytes memory execPayload) {
    for (uint256 i = 0; i < activeRebalancers.length; i++) {

      ILinearPoolRebalancer rebalancer = ILinearPoolRebalancer(activeRebalancers[i]);
      ILinearPoolSimple pool = ILinearPoolSimple(rebalancer.getPool());

      uint mainDecimals = IERC20Metadata(pool.getMainToken()).decimals();
      uint wrappedDecimals = IERC20Metadata(pool.getWrappedToken()).decimals();

      (,uint[] memory balances,) =  IBVault(pool.getVault()).getPoolTokens(pool.getPoolId());

      uint mainBalanceAdjusted = balances[pool.getMainIndex()] * 10 ** (18 - mainDecimals);
      uint wrappedBalanceAdjusted = balances[pool.getWrappedIndex()] * 10 ** (18 - wrappedDecimals);

      (uint lowerTarget, uint upperTarget) = pool.getTargets();
      uint middleTarget = (lowerTarget + upperTarget) / 2;
      uint tetuLowerTarget = middleTarget - (upperTarget - middleTarget) * tetuNominator / TETU_DENOMINATOR;
      uint tetuUpperTarget = middleTarget + (upperTarget - middleTarget) * tetuNominator / TETU_DENOMINATOR;

      if (mainBalanceAdjusted + wrappedBalanceAdjusted < middleTarget) {
        // not enough liquidity, skipping the pool
        continue;
      } else if (mainBalanceAdjusted > upperTarget || mainBalanceAdjusted < lowerTarget) {
        // we can rebalance with some profit
        return (true, abi.encodeCall(rebalancer.rebalance, (rebalancerWithExtraMain)));
      } else if (mainBalanceAdjusted > tetuUpperTarget || mainBalanceAdjusted < tetuLowerTarget) {
        // we neet to rebalance without profit to keep pool in range
        return (true, abi.encodeCall(RebalancerWithExtraMain.rebalanceWithExtraMain, (address(rebalancer), DEFAULT_EXTRA_MAIN)));
      }
    }
    return (false, "all pools in range");
  }
}