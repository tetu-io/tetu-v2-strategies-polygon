# Rebalance cost simple calculations by tests

## Test rebalance price thresholds
### shorted (borrowed) tokenB price goes up
```
--------------------------
Vault: TetuV2_UniswapV3_USDC-WETH-0.05%
Price range: ~+-10%
Invested: 1.0 USDC
TokenB price change: +1.631%
Estimated REBALANCE COST = 0.000275 USDC (0.0275%)
--------------------------
Vault: TetuV2_UniswapV3_USDC-WETH-0.05%
Price range: ~+-10%
Invested: 1.0 USDC
TokenB price change: +0.833%
Estimated REBALANCE COST = 0.000067 USDC (0.0067%)
--------------------------
```

### shorted (borrowed) tokenB price goes down
```
--------------------------
Vault: TetuV2_UniswapV3_USDC-WETH-0.05%
Price range: ~+-10%
Invested: 1.0 USDC
TokenB price change: -1.746%
Estimated REBALANCE COST = 0.000322 USDC (0.0322%)
--------------------------
Vault: TetuV2_UniswapV3_USDC-WETH-0.05%
Price range: ~+-10%
Invested: 1.0 USDC
TokenB price change: -0.696%
Estimated REBALANCE COST = 0.000046 USDC (0.0046%)
--------------------------
```

## Test price ranges

### Result
**Short range is better then long range for making**, because as the price range increases, the balancing cost decreases more slowly than the potential fee income.

### shorted (borrowed) tokenB price goes up
```
--------------------------
Vault: TetuV2_UniswapV3_USDC-WETH-0.05%
Price range: ~+-10%
Invested: 1.0 USDC
TokenB price change: +4.322%
Estimated REBALANCE COST = 0.001978 USDC (0.1978%)
--------------------------
Vault: TetuV2_UniswapV3_USDC-WETH-0.05%
Price range: ~+-20%
Invested: 1.0 USDC
TokenB price change: +4.311%
Estimated REBALANCE COST = 0.001034 USDC (0.1034%)
--------------------------
Vault: TetuV2_UniswapV3_USDC-WETH-0.05%
Price range: ~+-30%
Invested: 1.0 USDC
TokenB price change: +4.754%
Estimated REBALANCE COST = 0.000882 USDC (0.0882%)
--------------------------
Vault: TetuV2_UniswapV3_USDC-WETH-0.05%
Price range: ~+-40%
Invested: 1.0 USDC
TokenB price change: +4.644%
Estimated REBALANCE COST = 0.000662 USDC (0.0662%)
--------------------------
```

### shorted (borrowed) tokenB price goes down
```
--------------------------
Vault: TetuV2_UniswapV3_USDC-WETH-0.05%
Price range: ~+-10%
Invested: 1.0 USDC
TokenB price change: -4.887%
Estimated REBALANCE COST = 0.002648 USDC (0.2648%)
--------------------------
Vault: TetuV2_UniswapV3_USDC-WETH-0.05%
Price range: ~+-20%
Invested: 1.0 USDC
TokenB price change: -4.493%
Estimated REBALANCE COST = 0.001176 USDC (0.1176%)
--------------------------
```

