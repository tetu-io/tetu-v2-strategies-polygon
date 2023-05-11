# Uniswap V3 converter strategy params backtester

System for finding the optimal parameters of strategies using a genetic algorithm.

## How to

### Prepare postgres db and `.env`
```
TETU_MATIC_RPC_URL=https://your_polygon_rpc_url
UNISWAP_V3_BACKTESTER_POLYGON_DB_HOST=your_host
UNISWAP_V3_BACKTESTER_POLYGON_DB_PORT=5432
UNISWAP_V3_BACKTESTER_POLYGON_DB_USER=user
UNISWAP_V3_BACKTESTER_POLYGON_DB_PASSWORD=password
UNISWAP_V3_BACKTESTER_POLYGON_DB_DATABASE=dbname
```

### Build docker image and run container first time to create tables
```
docker build -t t1 scripts/uniswapV3Backtester
docker run --env-file .env t1
```

### Insert task

Example of WBTC/WETH-0.01% pool with WETH vault asset
```
INSERT INTO 
  task (
    "pool",
    "vaultAsset",
    "startBlock",
    "endBlock",
    "investAmountUnits",
    "config"
  )
  VALUES (
    '0x50eaEDB835021E4A108B7290636d62E9765cc6d7',
    '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    41524672,
    41525672,
    '1',
    '{
  "liquiditySnapshotSurroundingTickSpacings": 200,
  "maxTickRange": 1200,
  "maxRebalanceTickRange": 120,
  "gens": 5,
  "minIndividualsPerGen": 6,
  "bestIndividualsPerGen": 3
}'
  );
```

### Run docker containers as workers
