# 45764000 - 45825000
8/1/2023 5:55:12 AM - 8/2/2023 7:02:34 PM(1d 13h:7m)

## Origin params
**Real APR: -3.253%**

**Rebalances: 58. Rebalance debts: 52 (11 delayed, 35 forced, 6 closing)**

```
const allowedLockedPercent = 5;
const forceRebalanceDebtLockedPercent = 20;
const rebalanceDebtDelay = 360;
const fuseThresholds = [
  ['0.9989', '0.9991', '1.0011', '1.0009',],
  ['0.9989', '0.9991', '1.0011', '1.0009',],
]
```

## Best APR params
**Real APR: 10.783%** (~$20 for $100k tvl)

**Rebalances: 54. Rebalance debts: 49 (11 delayed, 30 forced, 8 closing)**
```
['0.999', '0.9991', '1.001', '1.0009',],
['0.999', '0.9991', '1.001', '1.0009',],
```

## Fewer debt rebalances params
**Real APR: -0.74%**

**Rebalances: 54. Rebalance debts: 16 (1 delayed, 0 forced, 15 closing)**
```
const allowedLockedPercent = 25;
const forceRebalanceDebtLockedPercent = 70;
const rebalanceDebtDelay = 7200;
['0.999', '0.9991', '1.001', '1.0009',],
['0.999', '0.9991', '1.001', '1.0009',],
```

## Origin backtest result
```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 5%. Forced rebalance debt locked: 20%. Rebalance debt delay: 360 secs. Fuse thresholds: [0.9989,0.9991,1.0011,1.0009], [0.9989,0.9991,1.0011,1.0009].
Vault APR (in ui): 52.674%. Total assets before: 100.0 USDC. Earned: 0.223224 USDC.
Strategy APR (in ui): 103.011%. Total assets: 99.95294 USDC. Hardwork earned: 0.436332 USDC. Hardwork lost: 0.0 USDC.
Real APR (    revenue    ): -3.253%. Total assets before: 100.0 USDC. Fees earned: 0.610108 USDC. Price change loss (covered by insurance): 0.270284 USDC. NSR and swap loss: 0.389918 USDC. Covered NSR and swap loss from rewards: 0.385571 USDC. Profit to cover: 0.031959 USDC.
Real APR (balances change): -3.138%. Balance change: -0.0133. Before: 1000100.0. After: 1000099.9867.
Insurance balance change: -0.236524 USDC.
Rebalances: 58. Rebalance debts: 52 (11 delayed, 35 forced, 6 closing).
Period: 1d 13h:7m. Start: 8/1/2023 5:55:12 AM (block: 45764000). Finish: 8/2/2023 7:02:34 PM (block: 45825000).
Time on fuse trigger: 13h:39m (36.8%).
Prices in pool: start - 0.999856, end: 0.999414, min: 0.980088, max: 0.999856.
Time spent for backtest: 12m:38s. Pool transactions: 9225. Strategy transactions: 112.
```

## Changed params
```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 5%. Forced rebalance debt locked: 20%. Rebalance debt delay: 360 secs. Fuse thresholds: [0.999,0.9991,1.001,1.0009], [0.999,0.9991,1.001,1.0009].
Real APR (    revenue    ): 10.783%. Total assets before: 100.0 USDC. Fees earned: 0.588427 USDC. Profit to cover: 0.032236 USDC. Loss covered by insurance: 0.22346 USDC. NSR and swap loss covered from rewards: 0.351505 USDC.
Real APR (balances change): 10.902%. Balance change: +0.046203. Before: 1000100.0. After: 1000100.046203.
Vault APR (in ui): 55.601%. Total assets before: 100.0 USDC. Earned: 0.235625 USDC.
Strategy APR (in ui): 108.801%. Total assets: 100.012165 USDC. Hardwork earned: 0.461132 USDC. Hardwork lost: 0.0 USDC.
Insurance balance change: -0.189422 USDC.
Rebalances: 54. Rebalance debts: 49 (11 delayed, 30 forced, 8 closing).
Period: 1d 13h:7m. Start: 8/1/2023 5:55:12 AM (block: 45764000). Finish: 8/2/2023 7:02:34 PM (block: 45825000).
Time on fuse trigger: 13h:48m (37.2%).
Prices in pool: start 0.999856, end 0.999414, min 0.980088, max 0.999856.
Time spent for backtest: 12m:12s. Pool transactions: 9225. Strategy transactions: 105.
```

```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 5%. Forced rebalance debt locked: 30%. Rebalance debt delay: 360 secs. Fuse thresholds: [0.999,0.9991,1.001,1.0009], [0.999,0.9991,1.001,1.0009].
Vault APR (in ui): 74.811%. Total assets before: 100.0 USDC. Earned: 0.317034 USDC.
Strategy APR (in ui): 141.784%. Total assets: 100.006138 USDC. Hardwork earned: 0.600885 USDC. Hardwork lost: 0.0 USDC.
Real APR (    revenue    ): 4.959%. Total assets before: 100.0 USDC. Fees earned: 0.560238 USDC. Price change loss (covered by insurance): 0.310896 USDC. NSR and swap loss: 0.24339 USDC. Covered NSR and swap loss from rewards: 0.239043 USDC. Profit to cover: 0.010718 USDC.
Real APR (balances change): 4.993%. Balance change: +0.02116. Before: 1000100.0. After: 1000100.02116.
Insurance balance change: -0.295874 USDC.
Rebalances: 56. Rebalance debts: 49 (32 delayed, 8 forced, 9 closing).
Period: 1d 13h:7m. Start: 8/1/2023 5:55:12 AM (block: 45764000). Finish: 8/2/2023 7:02:34 PM (block: 45825000).
Time on fuse trigger: 13h:48m (37.2%).
Prices in pool: start 0.999856, end 0.999414, min 0.980028, max 0.999856.
Time spent for backtest: 12m:18s. Pool transactions: 9225. Strategy transactions: 107.
```

```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 5%. Forced rebalance debt locked: 30%. Rebalance debt delay: 3600 secs. Fuse thresholds: [0.999,0.9991,1.001,1.0009], [0.999,0.9991,1.001,1.0009].
Vault APR (in ui): 73.278%. Total assets before: 100.0 USDC. Earned: 0.310538 USDC.
Strategy APR (in ui): 138.454%. Total assets: 99.911237 USDC. Hardwork earned: 0.586218 USDC. Hardwork lost: 0.0 USDC.
Real APR (    revenue    ): -18.03%. Total assets before: 100.0 USDC. Fees earned: 0.516428 USDC. Price change loss (covered by insurance): 0.399301 USDC. NSR and swap loss: 0.20587 USDC. Covered NSR and swap loss from rewards: 0.201523 USDC. Profit to cover: 0.007986 USDC.
Real APR (balances change): -18.005%. Balance change: -0.076304. Before: 1000100.0. After: 1000099.923696.
Insurance balance change: -0.386842 USDC.
Rebalances: 56. Rebalance debts: 32 (5 delayed, 17 forced, 10 closing).
Period: 1d 13h:7m. Start: 8/1/2023 5:55:12 AM (block: 45764000). Finish: 8/2/2023 7:02:34 PM (block: 45825000).
Time on fuse trigger: 13h:48m (37.2%).
Prices in pool: start 0.999856, end 0.999414, min 0.980072, max 0.999856.
Time spent for backtest: 11m:13s. Pool transactions: 9225. Strategy transactions: 90.
```

```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 5%. Forced rebalance debt locked: 70%. Rebalance debt delay: 7200 secs. Fuse thresholds: [0.999,0.9991,1.001,1.0009], [0.999,0.9991,1.001,1.0009].
Vault APR (in ui): 77.46%. Total assets before: 100.0 USDC. Earned: 0.328259 USDC.
Strategy APR (in ui): 131.637%. Total assets: 99.86949 USDC. Hardwork earned: 0.55712 USDC. Hardwork lost: 0.0 USDC.
Real APR (    revenue    ): -2.719%. Total assets before: 100.0 USDC. Fees earned: 0.418069 USDC. Price change loss (covered by insurance): 0.458769 USDC. NSR and swap loss: 0.081716 USDC. Covered NSR and swap loss from rewards: 0.077369 USDC. Profit to cover: 0.106543 USDC.
Real APR (balances change): -2.808%. Balance change: -0.011903. Before: 1000100.0. After: 1000099.988097.
Insurance balance change: -0.340162 USDC.
Rebalances: 54. Rebalance debts: 18 (3 delayed, 0 forced, 15 closing).
Period: 1d 13h:7m. Start: 8/1/2023 5:55:12 AM (block: 45764000). Finish: 8/2/2023 7:02:34 PM (block: 45825000).
Time on fuse trigger: 13h:48m (37.2%).
Prices in pool: start 0.999856, end 0.999414, min 0.980282, max 0.999856.
Time spent for backtest: 10m:3s. Pool transactions: 9225. Strategy transactions: 74.
```

```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 25%. Forced rebalance debt locked: 70%. Rebalance debt delay: 7200 secs. Fuse thresholds: [0.999,0.9991,1.001,1.0009], [0.999,0.9991,1.001,1.0009].
Real APR (    revenue    ): -0.74%. Total assets before: 100.0 USDC. Fees earned: 0.42164 USDC. Profit to cover: 0.105483 USDC. Loss covered by insurance: 0.458541 USDC. NSR and swap loss covered from rewards: 0.07172 USDC.
Real APR (balances change): -0.827%. Balance change: -0.003508. Before: 1000100.0. After: 1000099.996492.
Vault APR (in ui): 79.637%. Total assets before: 100.0 USDC. Earned: 0.337486 USDC.
Strategy APR (in ui): 135.983%. Total assets: 99.878945 USDC. Hardwork earned: 0.575568 USDC. Hardwork lost: 0.0 USDC.
Insurance balance change: -0.340994 USDC.
Rebalances: 54. Rebalance debts: 16 (1 delayed, 0 forced, 15 closing).
Period: 1d 13h:7m. Start: 8/1/2023 5:55:12 AM (block: 45764000). Finish: 8/2/2023 7:02:34 PM (block: 45825000).
Time on fuse trigger: 13h:48m (37.2%).
Prices in pool: start 0.999856, end 0.999414, min 0.980185, max 0.999856.
Time spent for backtest: 9m:58s. Pool transactions: 9225. Strategy transactions: 72.
```

```
Strategy TetuV2_UniswapV3_USDC-USDT-100. Tick range: 0.5 (+-0.005% price). Rebalance tick range: 0 (+-0% price).
Allowed locked: 25%. Forced rebalance debt locked: 70%. Rebalance debt delay: 7200 secs. Fuse thresholds: [0.9989,0.9991,1.0011,1.0009], [0.9989,0.9991,1.0011,1.0009].
Real APR (    revenue    ): -30.504%. Total assets before: 100.0 USDC. Fees earned: 0.420939 USDC. Profit to cover: 0.126296 USDC. Loss covered by insurance: 0.603056 USDC. NSR and swap loss covered from rewards: 0.07345 USDC.
Real APR (balances change): -30.506%. Balance change: -0.129279. Before: 1000100.0. After: 1000099.870721.
Vault APR (in ui): 79.113%. Total assets before: 100.0 USDC. Earned: 0.335262 USDC.
Strategy APR (in ui): 135.522%. Total assets: 99.732206 USDC. Hardwork earned: 0.572774 USDC. Hardwork lost: 0.0 USDC.
Insurance balance change: -0.464541 USDC.
Rebalances: 60. Rebalance debts: 17 (1 delayed, 1 forced, 15 closing).
Period: 1d 13h:7m. Start: 8/1/2023 5:55:12 AM (block: 45764000). Finish: 8/2/2023 7:02:34 PM (block: 45825000).
Time on fuse trigger: 13h:39m (36.8%).
Prices in pool: start 0.999856, end 0.999414, min 0.980185, max 0.999856.
Time spent for backtest: 10m:24s. Pool transactions: 9225. Strategy transactions: 79.
```