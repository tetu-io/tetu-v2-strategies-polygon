# 46760000 - 46880000
Aug-26-2023 02:31:23 AM +UTC - 8/29/2023 5:45:35 AM

## Origin params

**Real APR: -159.068%**

**Rebalances: 27. Rebalance debts: 27 (6 delayed, 21 forced, 0 closing)..**

```
const allowedLockedPercent = 5;
const forceRebalanceDebtLockedPercent = 20;
const rebalanceDebtDelay = 360;
const fuseThresholds = [
    ['0.999', '0.9991', '1.001', '1.0009',],
    ['0.999', '0.9991', '1.001', '1.0009',],
]
```

## Best APR params
**Real APR: 7.654%**
**Rebalances: 27. Rebalance debts: 3 (3 delayed, 0 forced, 0 closing).**
```
const allowedLockedPercent = 25;
const forceRebalanceDebtLockedPercent = 70;
const rebalanceDebtDelay = 7200;
```

## Origin backtest result without RDS pool
```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 5%. Forced rebalance debt locked: 20%. Rebalance debt delay: 360 secs. Fuse thresholds: [0.999,0.9991,1.001,1.0009], [0.999,0.9991,1.001,1.0009].
Real APR (    revenue    ): 7.679%. Total assets before: 100.0 USDC. Fees earned: 0.285975 USDC. Profit to cover: 0.030396 USDC. Loss covered by insurance: 0.08056 USDC. NSR and swap loss covered from rewards: 0.172513 USDC.
Real APR (balances change): 7.818%. Balance change: +0.064446. Before: 1000100.0. After: 1000100.064446.
Vault APR (in ui): 13.629%. Total assets before: 100.0 USDC. Earned: 0.112345 USDC.
Strategy APR (in ui): 24.774%. Total assets: 100.031785 USDC. Hardwork earned: 0.204272 USDC. Hardwork lost: 0.0 USDC.
Insurance balance change: -0.047899 USDC.
Rebalances: 27. Rebalance debts: 25 (7 delayed, 18 forced, 0 closing).
Period: 3d 0h:12m. Start: 8/26/2023 5:33:15 AM (block: 46760000). Finish: 8/29/2023 5:45:35 AM (block: 46880000).
Time on fuse trigger: 0m0s (0%).
Prices in pool: start 0.999396, end 0.99942, min 0.999036, max 0.99955.
Time spent for backtest: 8m:51s. Pool transactions: 8755. Strategy transactions: 54.
```

## Origin backtest result with RDS pool
```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 5%. Forced rebalance debt locked: 20%. Rebalance debt delay: 360 secs. Fuse thresholds: [0.999,0.9991,1.001,1.0009], [0.999,0.9991,1.001,1.0009].
Rebalance debt swap pool params: tickLower -60, tickLower 60, amount0Desired 500.0, amount1Desired 500.0.
Real APR (    revenue    ): -159.068%. Total assets before: 100.0 USDC. Fees earned: 0.313197 USDC. Profit to cover: 0.029978 USDC. Loss covered by insurance: 1.361026 USDC. NSR and swap loss covered from rewards: 0.293292 USDC.
Real APR (balances change): -158.911%. Balance change: -1.309849. Before: 1000100.0. After: 1000098.690151.
Vault APR (in ui): 2.442%. Total assets before: 100.0 USDC. Earned: 0.020134 USDC.
Strategy APR (in ui): 3.58%. Total assets: 98.659108 USDC. Hardwork earned: 0.029118 USDC. Hardwork lost: 0.0 USDC.
Insurance balance change: -1.329983 USDC.
Rebalances: 27. Rebalance debts: 27 (6 delayed, 21 forced, 0 closing).
Period: 3d 0h:12m. Start: 8/26/2023 5:33:15 AM (block: 46760000). Finish: 8/29/2023 5:45:35 AM (block: 46880000).
Time on fuse trigger: 0m0s (0%).
Prices in pool: start 0.999396, end 0.99942, min 0.999036, max 0.99955.
Time spent for backtest: 9m:51s. Pool transactions: 8755. Strategy transactions: 56.
```

## Changed params
```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 25%. Forced rebalance debt locked: 70%. Rebalance debt delay: 3600 secs. Fuse thresholds: [0.999,0.9991,1.001,1.0009], [0.999,0.9991,1.001,1.0009].
Rebalance debt swap pool params: tickLower -60, tickLower 60, amount0Desired 500.0, amount1Desired 500.0.
Real APR (    revenue    ): 7.546%. Total assets before: 100.0 USDC. Fees earned: 0.259223 USDC. Profit to cover: 0.082385 USDC. Loss covered by insurance: 0.117833 USDC. NSR and swap loss covered from rewards: 0.161569 USDC.
Real APR (balances change): 7.553%. Balance change: +0.062261. Before: 1000100.0. After: 1000100.062261.
Vault APR (in ui): 11.335%. Total assets before: 100.0 USDC. Earned: 0.093433 USDC.
Strategy APR (in ui): 18.505%. Total assets: 99.9756 USDC. Hardwork earned: 0.152499 USDC. Hardwork lost: 0.0 USDC.
Insurance balance change: -0.031172 USDC.
Rebalances: 27. Rebalance debts: 3 (3 delayed, 0 forced, 0 closing).
Period: 3d 0h:12m. Start: 8/26/2023 5:33:15 AM (block: 46760000). Finish: 8/29/2023 5:45:35 AM (block: 46880000).
Time on fuse trigger: 0m0s (0%).
Prices in pool: start 0.999396, end 0.99942, min 0.999036, max 0.99955.
Time spent for backtest: 8m:8s. Pool transactions: 8755. Strategy transactions: 32.
```

```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 25%. Forced rebalance debt locked: 70%. Rebalance debt delay: 7200 secs. Fuse thresholds: [0.999,0.9991,1.001,1.0009], [0.999,0.9991,1.001,1.0009].
Rebalance debt swap pool params: tickLower -60, tickLower 60, amount0Desired 500.0, amount1Desired 500.0.
Real APR (    revenue    ): 7.654%. Total assets before: 100.0 USDC. Fees earned: 0.256494 USDC. Profit to cover: 0.080042 USDC. Loss covered by insurance: 0.119002 USDC. NSR and swap loss covered from rewards: 0.154442 USDC.
Real APR (balances change): 7.654%. Balance change: +0.063091. Before: 1000100.0. After: 1000100.063091.
Vault APR (in ui): 11.863%. Total assets before: 100.0 USDC. Earned: 0.097792 USDC.
Strategy APR (in ui): 19.591%. Total assets: 99.97879 USDC. Hardwork earned: 0.161457 USDC. Hardwork lost: 0.0 USDC.
Insurance balance change: -0.034701 USDC.
Rebalances: 27. Rebalance debts: 3 (3 delayed, 0 forced, 0 closing).
Period: 3d 0h:12m. Start: 8/26/2023 5:33:15 AM (block: 46760000). Finish: 8/29/2023 5:45:35 AM (block: 46880000).
Time on fuse trigger: 0m0s (0%).
Prices in pool: start 0.999396, end 0.99942, min 0.999036, max 0.99955.
Time spent for backtest: 8m:5s. Pool transactions: 8755. Strategy transactions: 32.
```