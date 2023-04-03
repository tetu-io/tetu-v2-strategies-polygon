import {
  IConverterController__factory,
  IERC20__factory, IPriceOracle__factory,
  ISplitter__factory,
  ITetuConverter__factory, IUniswapV3Pool__factory,
  StrategyBaseV2__factory,
  TetuVaultV2, UniswapV3ConverterStrategy, UniswapV3ConverterStrategy__factory, UniswapV3LibFacade,
} from '../../../../../typechain';
import { MaticAddresses } from '../../../../../scripts/addresses/MaticAddresses';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import hre from 'hardhat';
import { writeFileSync } from 'fs';
import { formatUnits } from 'ethers/lib/utils';
import { writeFileSyncRestoreFolder } from '../../../../baseUT/utils/FileUtils';

/**
 * All balances
 */
export interface IState {
  title: string;
  block: number;
  blockTimestamp: number;
  user: {
    usdc: BigNumber;
  };
  strategy: {
    usdc: BigNumber;
    usdt: BigNumber;
    df: BigNumber;
    totalAssets: BigNumber;
    investedAssets: BigNumber;
  };
  depositor: {
    tokenA: string;
    tokenB: string
    tickSpacing: number;
    lowerTick: number;
    upperTick: number;
    rebalanceTickRange: number;
    totalLiquidity: BigNumber;
    isFuseTriggered: boolean;
    fuseThreshold: BigNumber;
    rebalanceEarned0: BigNumber; // rebalanceResults[0]
    rebalanceEarned1: BigNumber; // rebalanceResults[1]
    rebalanceLost: BigNumber; // rebalanceResults[2]
  };
  pool: {
    token0: string,
    token1: string,
    amount0: BigNumber,
    amount1: BigNumber
  },
  splitter: {
    usdc: BigNumber;
    totalAssets: BigNumber;
  };
  vault: {
    usdc: BigNumber;
    userShares: BigNumber;
    userUsdc: BigNumber;
    sharePrice: BigNumber;
    totalSupply: BigNumber;
    totalAssets: BigNumber;
  };
  insurance: {
    usdc: BigNumber;
  };
  baseAmounts: {
    usdc: BigNumber;
    usdt: BigNumber;
    df: BigNumber;
  };
  converter: {
    collateralForUsdt: BigNumber,
    amountToRepayUsdt: BigNumber
  };
  prices: {
    usdc: BigNumber,
    usdt: BigNumber
  }
}

/**
 * Utils for integration tests of BalancerComposableStableStrategy
 */
export class Uniswapv3StateUtils {

  public static async getState(
    signer: SignerWithAddress,
    user: SignerWithAddress,
    strategy: UniswapV3ConverterStrategy,
    vault: TetuVaultV2,
    facade: UniswapV3LibFacade,
    title?: string,
  ): Promise<IState> {
    const splitterAddress = await vault.splitter();
    const insurance = await vault.insurance();
    const block = await hre.ethers.provider.getBlock('latest');

    const converter = await ITetuConverter__factory.connect(await strategy.converter(), signer);
    const debtsUsdt = await converter.getDebtAmountStored(
      strategy.address,
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.USDT_TOKEN,
    );

    const depositorState = await UniswapV3ConverterStrategy__factory.connect(strategy.address, signer).getState();

    const pool = await IUniswapV3Pool__factory.connect(depositorState.pool, signer);
    const slot0 = await pool.slot0();

    console.log("slot0", slot0);
    console.log("state", depositorState);
    const poolAmountsForLiquidity = await facade.getAmountsForLiquidity(
      slot0.sqrtPriceX96,
      depositorState.lowerTick,
      depositorState.upperTick,
      depositorState.totalLiquidity
    );

    const converterController = IConverterController__factory.connect(await converter.controller(), signer);
    const priceOracle = IPriceOracle__factory.connect(await converterController.priceOracle(), signer);

    const dest: IState = {
      title: title || 'no-name',
      block: block.number,
      blockTimestamp: block.timestamp,
      user: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(user.address),
      },
      vault: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(vault.address),

        userShares: await vault.balanceOf(user.address),
        userUsdc: await vault.convertToAssets(await vault.balanceOf(user.address)),

        sharePrice: await vault.sharePrice(),
        totalSupply: await vault.totalSupply(),
        totalAssets: await vault.totalAssets(),
      },
      insurance: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(insurance),
      },
      strategy: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(strategy.address),
        usdt: await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, user).balanceOf(strategy.address),
        df: await IERC20__factory.connect(MaticAddresses.DF_TOKEN, user).balanceOf(strategy.address),
        totalAssets: await strategy.totalAssets(),
        investedAssets: await StrategyBaseV2__factory.connect(strategy.address, user).investedAssets(),
      },
      depositor: {
        tokenA: depositorState.tokenA,
        tokenB: depositorState.tokenB,
        tickSpacing: depositorState.tickSpacing,
        lowerTick: depositorState.lowerTick,
        upperTick: depositorState.upperTick,
        rebalanceTickRange: depositorState.rebalanceTickRange,
        totalLiquidity: depositorState.totalLiquidity,
        isFuseTriggered: depositorState.isFuseTriggered,
        fuseThreshold: depositorState.fuseThreshold,
        rebalanceEarned0: depositorState.rebalanceResults[0],
        rebalanceEarned1: depositorState.rebalanceResults[1],
        rebalanceLost: depositorState.rebalanceResults[2],
      },
      pool: {
        token0: await pool.token0(),
        token1: await pool.token1(),
        amount0: poolAmountsForLiquidity.amount0,
        amount1: poolAmountsForLiquidity.amount1
      },
      splitter: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(splitterAddress),
        totalAssets: await ISplitter__factory.connect(splitterAddress, user).totalAssets(),
      },
      baseAmounts: {
        usdc: await strategy.baseAmounts(MaticAddresses.USDC_TOKEN),
        usdt: await strategy.baseAmounts(MaticAddresses.USDT_TOKEN),
        df: await strategy.baseAmounts(MaticAddresses.DF_TOKEN),
      },
      converter: {
        collateralForUsdt: debtsUsdt.totalCollateralAmountOut,
        amountToRepayUsdt: debtsUsdt.totalDebtAmountOut,
      },
      prices: {
        usdc: await priceOracle.getAssetPrice(MaticAddresses.USDC_TOKEN),
        usdt: await priceOracle.getAssetPrice(MaticAddresses.USDT_TOKEN),
      }
    };

    // console.log("State", dest);
    return dest;
  }

  public static getCsvData(): { stateHeaders: string[], stateDecimals: number[] } {
    const stateHeaders = [
      'title',
      'block',
      'timestamp',

      'user.usdc',
      'vault.usdc',

      'vault.user.shares',
      'vault.user.usdc',

      'vault.sharePrice',
      'vault.totalSupply',
      'vault.totalAssets',

      'insurance.usdc',

      'strategy.usdc',
      'strategy.usdt',
      'strategy.df',
      'strategy.totalAssets',
      'strategy.investedAssets',

      'depositor.tokenA',
      'depositor.tokenB',
      'depositor.tickSpacing',
      'depositor.lowerTick',
      'depositor.upperTick',
      'depositor.rebalanceTickRange',
      'depositor.totalLiquidity',
      'depositor.isFuseTriggered',
      'depositor.fuseThreshold',
      'depositor.rebalanceEarned0',
      'depositor.rebalanceEarned1',
      'depositor.rebalanceLost',

      "pool.token0",
      "pool.token1",
      "pool.amount0",
      "pool.amount1",

      'splitter.usdc',
      'splitter.totalAssets',

      'baseAmounts.usdc',
      'baseAmounts.usdt',
      'baseAmounts.df',

      'converter.collateralUsdt',
      'converter.toRepayUsdt',

      'price.usdc',
      'price.usdt',
    ];

    const decimalsSharedPrice = 6;
    const decimalsUSDC = 6;
    const decimalsUSDT = 6;
    const decimalsDF = 18;

    const stateDecimals = [
      0,
      0,
      0,

      decimalsUSDC, // user.usdc
      decimalsUSDC, // vault.usdc

      decimalsUSDC, // vault.userShares
      decimalsUSDC, // vault.userUsdc

      decimalsSharedPrice, // shared price
      decimalsUSDC, // vault.totlaSupply
      decimalsUSDC, // vault.totalAssets

      decimalsUSDC, // insurance.usdc

      decimalsUSDC, // strategy.usdc
      decimalsUSDT, // strategy.usdt
      decimalsDF, // strategy.df
      decimalsUSDC, // strategy.totalAssets
      decimalsUSDC, // strategy.investedAssets

      0, // depositor.tokenA
      0, // depositor.tokenB
      0, // depositor.tickSpacing
      0, // depositor.lowerTick
      0, // depositor.upperTick
      0, // depositor.rebalanceTickRange
      decimalsUSDC, // depositor.totalLiquidity
      0, // depositor.isFuseTriggered
      18, // depositor.fuseThreshold

      0, // pool.token0
      0, // pool.token1
      decimalsUSDC, // pool.amount0 TODO: decimals of token0
      decimalsUSDT, // pool.amount1 TOCO: decimals of token1

      decimalsUSDC, // depositor.rebalanceEarned0
      decimalsUSDC, // depositor.rebalanceEarned1
      decimalsUSDC, // depositor.rebalanceLost

      decimalsUSDC, // splitter.usdc
      decimalsUSDC, // splitter.totalAssets,

      decimalsUSDC, // baseAmounts.usdc
      decimalsUSDT, // baseAmounts.usdt
      decimalsDF, // baseAmounts.df

      decimalsUSDC, // collateral for usdt
      decimalsUSDT, // amount to repay, usdt

      18,
      18,
    ];

    return { stateHeaders, stateDecimals };
  }

  /**
   * Put data of a state into a separate row
   */
  public static async saveListStatesToCSVRows(pathOut: string, states: IState[]) {
    const { stateHeaders, stateDecimals } = this.getCsvData();
    writeFileSyncRestoreFolder(pathOut, stateHeaders.join(';') + '\n', { encoding: 'utf8', flag: 'a' });
    for (const item of states) {
      const line = [
        item.title,
        item.block,
        item.blockTimestamp,

        item.user.usdc,
        item.vault.usdc,

        item.vault.userShares,
        item.vault.userUsdc,

        item.vault.sharePrice,
        item.vault.totalSupply,
        item.vault.totalAssets,

        item.insurance.usdc,

        item.strategy.usdc,
        item.strategy.usdt,
        item.strategy.df,
        item.strategy.totalAssets,
        item.strategy.investedAssets,

        item.depositor.tokenA,
        item.depositor.tokenB,
        item.depositor.tickSpacing,
        item.depositor.lowerTick,
        item.depositor.upperTick,
        item.depositor.rebalanceTickRange,
        item.depositor.totalLiquidity,
        item.depositor.isFuseTriggered,
        item.depositor.fuseThreshold,
        item.depositor.rebalanceEarned0,
        item.depositor.rebalanceEarned1,
        item.depositor.rebalanceLost,

        item.pool.token0,
        item.pool.token1,
        item.pool.amount0,
        item.pool.amount1,

        item.splitter.usdc,
        item.splitter.totalAssets,

        item.baseAmounts.usdc,
        item.baseAmounts.usdt,
        item.baseAmounts.df,

        item.converter.collateralForUsdt,
        item.converter.amountToRepayUsdt,

        item.prices.usdc,
        item.prices.usdt
      ];
      writeFileSync(
        pathOut,
        line.map((x, index) =>
          typeof x === 'object'
            ? +formatUnits(x, stateDecimals[index])
            : '' + x,
        ).join(';') + '\n',
        { encoding: 'utf8', flag: 'a' },
      );
    }
  }

  /**
   * Put data of a state into a separate column
   */
  public static async saveListStatesToCSVColumns(pathOut: string, states: IState[]) {
    const { stateHeaders, stateDecimals } = this.getCsvData();
    const headers = [
      '',
      ...states.map(x => x.title),
    ];
    const rows = states.map(item => [
      item.title,
      item.block,
      item.blockTimestamp,

      item.user.usdc,
      item.vault.usdc,

      item.vault.userShares,
      item.vault.userUsdc,

      item.vault.sharePrice,
      item.vault.totalSupply,
      item.vault.totalAssets,

      item.insurance.usdc,

      item.strategy.usdc,
      item.strategy.usdt,
      item.strategy.df,
      item.strategy.totalAssets,
      item.strategy.investedAssets,

      item.depositor.tokenA,
      item.depositor.tokenB,
      item.depositor.tickSpacing,
      item.depositor.lowerTick,
      item.depositor.upperTick,
      item.depositor.rebalanceTickRange,
      item.depositor.totalLiquidity,
      item.depositor.isFuseTriggered,
      item.depositor.fuseThreshold,
      item.depositor.rebalanceEarned0,
      item.depositor.rebalanceEarned1,
      item.depositor.rebalanceLost,

      item.pool.token0,
      item.pool.token1,
      item.pool.amount0,
      item.pool.amount1,

      item.splitter.usdc,
      item.splitter.totalAssets,

      item.baseAmounts.usdc,
      item.baseAmounts.usdt,
      item.baseAmounts.df,

      item.converter.collateralForUsdt,
      item.converter.amountToRepayUsdt,

      item.prices.usdc,
      item.prices.usdt
    ]);

    writeFileSyncRestoreFolder(pathOut, headers.join(';') + '\n', { encoding: 'utf8', flag: 'a' });
    for (let i = 0; i < stateHeaders.length; ++i) {
      const line = [stateHeaders[i], ...rows.map(x => x[i])];
      writeFileSync(
        pathOut,
        line.map((x) =>
          typeof x === 'object'
            ? +formatUnits(x, stateDecimals[i])
            : '' + x,
        ).join(';') + '\n',
        { encoding: 'utf8', flag: 'a' },
      );
    }
  }

  public static getTotalUsdAmount(state: IState): BigNumber {
    return state.user.usdc.add(
      state.vault.usdc,
    ).add(
      state.insurance.usdc,
    ).add(
      state.strategy.usdc,
    ).add(
      state.splitter.usdc,
    );
  }

  /**
   * Get initial state marked as "enter"
   * and final state marked as "final"
   * @param states
   */
  public static outputProfit(states: IState[]) {
    if (states.length < 2) {
      return;
    }

    const enter: IState = states[0];
    const final: IState = states[states.length - 1];

    this.outputProfitEnterFinal(enter, final);
  }

  public static outputProfitEnterFinal(enter: IState, final: IState) {
    // ethereum timestamp is in seconds
    // https://ethereum.stackexchange.com/questions/7853/is-the-block-timestamp-value-in-solidity-seconds-or-milliseconds
    const timeSeconds = (final.blockTimestamp - enter.blockTimestamp);
    const initialAmount = this.getTotalUsdAmount((enter));
    const finalAmount = this.getTotalUsdAmount(final);
    const amount = finalAmount.sub(initialAmount);
    const amountNum = +formatUnits(amount, 6);
    const apr = amountNum * 365
      / (timeSeconds / (24 * 60 * 60))
      / +formatUnits(initialAmount, 6)
      * 100;
    console.log('final.blockTimestamp', final.blockTimestamp);
    console.log('enter.blockTimestamp', enter.blockTimestamp);
    console.log('final.getTotalUsdAmount', this.getTotalUsdAmount(final));
    console.log('enter.getTotalUsdAmount', this.getTotalUsdAmount(enter));
    console.log('Initial amount', initialAmount);
    console.log('Final amount', initialAmount);
    console.log('Total profit', amountNum);
    console.log('Duration in seconds', timeSeconds);
    console.log('Duration in days', timeSeconds / (24 * 60 * 60));
    console.log('Estimated APR, %', apr);
  }

}
