// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
import "../integrations/balancer/ILinearPoolRebalancer.sol";
import "../integrations/balancer/ILinearPoolSimple.sol";

contract RebalancerWithExtraMain is Ownable {
  using SafeERC20 for IERC20;

  function rebalanceWithExtraMain(address balancerRebalancer, uint256 amount) external {
    ILinearPoolRebalancer rebalancer = ILinearPoolRebalancer(balancerRebalancer);
    address pool = rebalancer.getPool();
    address token = ILinearPoolSimple(pool).getMainToken();
    require(IERC20(token).balanceOf(address(this)) >= amount, "Not enough tokens");
    IERC20(token).safeApprove(balancerRebalancer, amount);
    ILinearPoolRebalancer(balancerRebalancer).rebalanceWithExtraMain(address(this), amount);
  }

  function withdraw(address token, uint256 amount) external onlyOwner {
    IERC20(token).safeTransfer(msg.sender, amount);
  }

}
