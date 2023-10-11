/*
import { ethers } from 'hardhat';
import { IERC20Metadata__factory, UniswapV3ConverterStrategy__factory } from '../../../../typechain';
import { formatUnits } from 'ethers/lib/utils';

export async function univ3ConverterData(strategyAdr: string, block: number) {
  const signer = (await ethers.getSigners())[0];

  const strategy = UniswapV3ConverterStrategy__factory.connect(strategyAdr, signer);

  // --------------- strategy base attributes ----------------
  const NAME = await strategy.NAME({ blockTag: block });
  const PLATFORM = await strategy.PLATFORM({ blockTag: block });
  const STRATEGY_BASE_VERSION = await strategy.STRATEGY_BASE_VERSION({ blockTag: block });
  const asset = await strategy.asset({ blockTag: block });
  const assetDecimals = await IERC20Metadata__factory.connect(asset, signer).decimals();
  const capacity = formatUnits(await strategy.capacity({ blockTag: block }), assetDecimals);
  const compoundRatio = formatUnits(await strategy.compoundRatio({ blockTag: block }), 3);
  const investedAssets = formatUnits(await strategy.investedAssets({ blockTag: block }), assetDecimals);
  const performanceFee = formatUnits(await strategy.performanceFee({ blockTag: block }), 3);
  const totalAssets = formatUnits(await strategy.totalAssets({ blockTag: block }), assetDecimals);


  // -----------  strategy specific attributes ---------------
  const state = await strategy.getState({ blockTag: block });

  const tokenA = state.tokenA;
  const tokenB = state.tokenB;
  const tokenADecimals = await IERC20Metadata__factory.connect(tokenA, signer).decimals();
  const tokenBDecimals = await IERC20Metadata__factory.connect(tokenB, signer).decimals();
  const pool = state.pool;
  const tickSpacing = state.tickSpacing;
  const lowerTick = state.lowerTick;
  const upperTick = state.upperTick;
  const rebalanceTickRange = state.rebalanceTickRange;
  const totalLiquidity = formatUnits(state.totalLiquidity, assetDecimals);
  const isFuseTriggered = state.isFuseTriggered;
  const fuseThreshold = formatUnits(state.fuseThreshold, 16);
  const rebalanceResults = state.rebalanceResults;
  const rebalanceEarned0 = rebalanceResults[0];
  const rebalanceEarned1 = rebalanceResults[1];
  const rebalanceLost = rebalanceResults[2];

  const CONTROLLABLE_VERSION = await strategy.CONTROLLABLE_VERSION({ blockTag: block });
  const CONVERTER_STRATEGY_BASE_VERSION = await strategy.CONVERTER_STRATEGY_BASE_VERSION({ blockTag: block });
  const UNISWAPV3_DEPOSITOR_VERSION = await strategy.UNISWAPV3_DEPOSITOR_VERSION({ blockTag: block });
  const tokenABaseAmount = formatUnits(await strategy.baseAmounts(tokenA, { blockTag: block }), tokenADecimals);
  const tokenBBaseAmount = formatUnits(await strategy.baseAmounts(tokenB, { blockTag: block }), tokenBDecimals);
  const reinvestThresholdPercent = await strategy.reinvestThresholdPercent({ blockTag: block });


  const result = `
            BLOCK: ${block}
    ==== COMMON STRATEGY ATTRIBUTES ===
    NAME: ${NAME}
    PLATFORM: ${PLATFORM}
    STRATEGY_BASE_VERSION: ${STRATEGY_BASE_VERSION}
    asset: ${asset}
    assetDecimals: ${assetDecimals}
    capacity: ${capacity}
    compoundRatio: ${compoundRatio}
    investedAssets: ${investedAssets}
    performanceFee: ${performanceFee}
    totalAssets: ${totalAssets}

    ==== SPECIFIC STRATEGY ATTRIBUTES ===
    tokenA: ${tokenA}
    tokenB: ${tokenB}
    tokenADecimals: ${tokenADecimals}
    tokenBDecimals: ${tokenBDecimals}
    pool: ${pool}
    tickSpacing: ${tickSpacing}
    lowerTick: ${lowerTick}
    upperTick: ${upperTick}
    rebalanceTickRange: ${rebalanceTickRange}
    totalLiquidity: ${totalLiquidity}
    isFuseTriggered: ${isFuseTriggered}
    fuseThreshold: ${fuseThreshold}
    rebalanceResults: ${rebalanceResults}
    rebalanceEarned0: ${rebalanceEarned0}
    rebalanceEarned1: ${rebalanceEarned1}
    rebalanceLost: ${rebalanceLost}
    CONTROLLABLE_VERSION: ${CONTROLLABLE_VERSION}
    CONVERTER_STRATEGY_BASE_VERSION: ${CONVERTER_STRATEGY_BASE_VERSION}
    UNISWAPV3_DEPOSITOR_VERSION: ${UNISWAPV3_DEPOSITOR_VERSION}
    tokenABaseAmount: ${tokenABaseAmount}
    tokenBBaseAmount: ${tokenBBaseAmount}
    reinvestThresholdPercent: ${reinvestThresholdPercent}
  `;

  console.log(result);
}
*/
