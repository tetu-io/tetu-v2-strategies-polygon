// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IRebalancingV2Strategy {
    function needRebalance() external view returns (bool);

    /// @notice Rebalance using borrow/repay only, no swaps
    /// @param checkNeedRebalance Revert if rebalance is not needed. Pass false to deposit after withdrawByAgg-iterations
    function rebalanceNoSwaps(bool checkNeedRebalance) external;

    /// @notice Get info about a swap required by next call of {withdrawByAggStep} within the given plan
    function quoteWithdrawByAgg(bytes memory planEntryData) external returns (address tokenToSwap, uint amountToSwap);

    /// @notice Make withdraw iteration: [exit from the pool], [make 1 swap], [repay a debt], [enter to the pool]
    ///         Typical sequence of the actions is: exit from the pool, make 1 swap, repay 1 debt.
    ///         You can enter to the pool if you are sure that you won't have borrow + repay on AAVE3 in the same block.
    /// @dev All swap-by-agg data should be prepared using {quoteWithdrawByAgg} off-chain
    /// @param tokenToSwapAndAggregator Array with two params (workaround for stack too deep):
    ///             [0] tokenToSwap_ What token should be swapped to other
    ///             [1] aggregator_ Aggregator that should be used on next swap. 0 - use liquidator
    /// @param amountToSwap_ Amount that should be swapped. 0 - no swap
    /// @param swapData Swap rote that was prepared off-chain.
    /// @param planEntryData PLAN_XXX + additional data, see IterationPlanKinds
    /// @param entryToPool Allow to enter to the pool at the end. Use false if you are going to make several iterations.
    ///                    It's possible to enter back to the pool by calling {rebalanceNoSwaps} at any moment
    ///                    0 - not allowed, 1 - allowed, 2 - allowed only if completed
    /// @return completed All debts were closed, leftovers were swapped to the required proportions.
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

    /// @notice Get current fuse status, see PairBasedStrategyLib.FuseStatus for possible values
    function getFuseStatus() external view returns (uint);
}
