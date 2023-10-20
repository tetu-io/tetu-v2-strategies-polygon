// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;
// todo remove OZ dependency
//import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
//import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/SafeERC20.sol";
//import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
//import "../integrations/balancer/ILinearPoolRebalancer.sol";
//import "../integrations/balancer/ILinearPoolSimple.sol";
//import "../integrations/balancer/IBVault.sol";
//import "@tetu_io/tetu-contracts-v2/contracts/lib/StringLib.sol";
//
////import "hardhat/console.sol";
//
//contract BoostedPoolsRebalanceResolver is OwnableUpgradeable {
//  using SafeERC20 for IERC20;
//
//  ///////////////////////////////////////////////////
//  //             CONSTANTS
//  ///////////////////////////////////////////////////
//
//  uint public constant TETU_DENOMINATOR = 1000;
//  uint public constant DEFAULT_EXTRA_MAIN = 5;
//
//  ///////////////////////////////////////////////////
//  //             VARIABLES
//  ///////////////////////////////////////////////////
//
//  /// @dev 500 by default - 50% of the target
//  uint public tetuNominator;
//  address [] public rebalancers;
//  uint public delay;
//  uint public maxGas;
//  uint public lastCall;
//  mapping(address => bool) public operators;
//  mapping(address => uint) public lastCallPerRebalancer;
//
//  ///////////////////////////////////////////////////
//  //             INIT
//  ///////////////////////////////////////////////////
//
//  function initialize(address[] calldata _rebalancers) public initializer {
//    __Ownable_init();
//    delay = 1 hours;
//    maxGas = 35 gwei;
//    tetuNominator = 500;
//    rebalancers = _rebalancers;
//  }
//
//  ///////////////////////////////////////////////////
//  //             GOV
//  ///////////////////////////////////////////////////
//
//  function setNominator(uint _tetuNominator) external onlyOwner {
//    tetuNominator = _tetuNominator;
//  }
//
//  function updateRebalancers(address[] calldata _rebalancers) external onlyOwner {
//    rebalancers = _rebalancers;
//  }
//
//  function withdraw(address token, uint256 amount) external onlyOwner {
//    IERC20(token).safeTransfer(msg.sender, amount);
//  }
//
//  function setDelay(uint value) external onlyOwner {
//    delay = value;
//  }
//
//  function setMaxGas(uint value) external onlyOwner {
//    maxGas = value;
//  }
//
//  function changeOperatorStatus(address operator, bool status) external onlyOwner {
//    operators[operator] = status;
//  }
//
//  ///////////////////////////////////////////////////
//  //             MAIN
//  ///////////////////////////////////////////////////
//
//  function rebalance(address balancerRebalancer, uint256 amount, bool extra) external {
//    require(operators[msg.sender], "Not an operator");
//
//    ILinearPoolRebalancer rebalancer = ILinearPoolRebalancer(balancerRebalancer);
//
//    if (extra) {
//      address pool = rebalancer.getPool();
//      address token = ILinearPoolSimple(pool).getMainToken();
//      require(IERC20(token).balanceOf(address(this)) >= amount, "Not enough tokens");
//      IERC20(token).safeApprove(balancerRebalancer, amount);
//      ILinearPoolRebalancer(balancerRebalancer).rebalanceWithExtraMain(address(this), amount);
//    } else {
//      rebalancer.rebalance(address(this));
//    }
//
//    lastCall = block.timestamp;
//    lastCallPerRebalancer[balancerRebalancer] = block.timestamp;
//  }
//
//  function maxGasAdjusted() public view returns (uint) {
//    uint _maxGas = maxGas;
//
//    uint diff = block.timestamp - lastCall;
//    uint multiplier = diff * 100 / 1 days;
//    return _maxGas + _maxGas * multiplier / 100;
//  }
//
//  function checker() external view returns (bool canExec, bytes memory execPayload) {
//    if (tx.gasprice > maxGasAdjusted()) {
//      return (false, abi.encodePacked("Too high gas: ", StringLib._toString(tx.gasprice / 1e9)));
//    }
//
//    uint _delay = delay;
//
//
//    for (uint256 i = 0; i < rebalancers.length; i++) {
//
//      if (lastCallPerRebalancer[rebalancers[i]] + _delay > block.timestamp) {
//        continue;
//      }
//
//      ILinearPoolSimple pool = ILinearPoolSimple(ILinearPoolRebalancer(rebalancers[i]).getPool());
//
//      uint mainDecimals = IERC20Metadata(pool.getMainToken()).decimals();
//      uint wrappedDecimals = IERC20Metadata(pool.getWrappedToken()).decimals();
//
//      (,uint[] memory balances,) = IBVault(pool.getVault()).getPoolTokens(pool.getPoolId());
//
//      uint mainBalanceAdjusted = balances[pool.getMainIndex()] * 10 ** (18 - mainDecimals);
//      uint wrappedBalanceAdjusted = balances[pool.getWrappedIndex()] * 10 ** (18 - wrappedDecimals);
//
//      (uint lowerTarget, uint upperTarget) = pool.getTargets();
//      uint middleTarget = (lowerTarget + upperTarget) / 2;
//      uint tetuLowerTarget = middleTarget - (upperTarget - middleTarget) * tetuNominator / TETU_DENOMINATOR;
////      uint tetuUpperTarget = middleTarget + (upperTarget - middleTarget) * tetuNominator / TETU_DENOMINATOR;
//
////      console.log('mainBalanceAdjusted', mainBalanceAdjusted / 1e18);
////      console.log('wrappedBalanceAdjusted', wrappedBalanceAdjusted / 1e18);
////      console.log('lowerTarget', lowerTarget / 1e18);
////      console.log('upperTarget', upperTarget / 1e18);
////      console.log('middleTarget', middleTarget / 1e18);
////      console.log('tetuLowerTarget', tetuLowerTarget / 1e18);
////      console.log('tetuUpperTarget', tetuUpperTarget / 1e18);
//
//      if (mainBalanceAdjusted + wrappedBalanceAdjusted < middleTarget) {
//        // not enough liquidity, skipping the pool
//        continue;
//      } else {
//
//        if (mainBalanceAdjusted > upperTarget || mainBalanceAdjusted < lowerTarget) {
//          return (true, abi.encodeCall(BoostedPoolsRebalanceResolver.rebalance, (rebalancers[i], DEFAULT_EXTRA_MAIN * 10 ** mainDecimals, false)));
//        }
//
//        if (
//          /*mainBalanceAdjusted > tetuUpperTarget ||*/
//          mainBalanceAdjusted < (tetuLowerTarget / 2)
//        ) {
//          return (true, abi.encodeCall(BoostedPoolsRebalanceResolver.rebalance, (rebalancers[i], DEFAULT_EXTRA_MAIN * 10 ** mainDecimals, true)));
//        }
//      }
//    }
//    return (false, "all pools in range");
//  }
//}
