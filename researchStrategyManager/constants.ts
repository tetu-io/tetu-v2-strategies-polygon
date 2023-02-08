
export const asset = {
  address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  symbol: 'USDC',
  decimals: 6,
}

export const uniswapV3SimpleStrategyAbi = [
  "function getEstimatedBalance(address token) external view returns(uint)",
  "function needRebalance() public view returns (bool)",
  "function deposit(address token, uint amount) external",
  "function withdraw(address token, uint amount) external",
  "function withdrawAll(address token) external",
  "function rebalance() public",
  "function changeTickRange(int24 newTickRange_) external",
  "function changeRebalanceTickRange(int24 newRebalanceTickRange_) external",
  "function getPrice(address tokenIn) public view returns (uint)",
]

export const uniswapV3ResearchStrategyAbi = [
  "function getEstimatedBalance(address token) external view returns(uint)",
  "function needRebalance() public view returns (bool)",
  "function deposit(address token, uint amount) external",
  "function withdraw(address token, uint amount) external",
  "function withdrawAll(address token) external",
  "function rebalance() public",
  "function rebalanceWithTracking() public",
  "function changeTickRange(int24 newTickRange_) external",
  "function changeRebalanceTickRange(int24 newRebalanceTickRange_) external",
  "function getPrice(address tokenIn) public view returns (uint)",
  "function tracking() public view returns (int apr,uint earned,uint rebalanceCost,uint il,uint period,uint rebalances,address trackingToken)",
  "function name() external view returns (string memory)",
]

export const erc20Abi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint)",
  "function transfer(address to, uint amount)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
]
