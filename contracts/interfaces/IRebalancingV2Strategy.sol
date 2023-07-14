// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IRebalancingV2Strategy {
    function needRebalance() external view returns (bool);

    function rebalanceNoSwaps(bool checkNeedRebalance) external returns (bool);

    function quoteWithdrawByAgg(bytes memory planEntryData) external returns (address tokenToSwap, uint amountToSwap);

    function withdrawByAggStep(
        address[2] calldata tokenToSwapAndAggregator,
        uint amountToSwap_,
        bytes memory swapData,
        bytes memory planEntryData,
        uint entryToPool
    ) external returns (bool completed);

    /// @notice Calculate proportions of [underlying, not-underlying] required by the internal pool of the strategy
    /// @return Proportion of the not-underlying [0...1e18]
    function getPropNotUnderlying18() external view returns (uint);
}
