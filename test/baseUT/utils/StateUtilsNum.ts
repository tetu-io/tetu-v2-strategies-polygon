/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre from "hardhat";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {writeFileSync} from "fs";
import {
  AlgebraConverterStrategy__factory,
  AlgebraLib,
  BalancerBoostedStrategy__factory,
  ConverterStrategyBase,
  ConverterStrategyBase__factory,
  IBalancerGauge__factory,
  IBookkeeper__factory,
  IBorrowManager,
  IBorrowManager__factory,
  IConverterController__factory,
  IERC20Metadata__factory,
  IPoolAdapter__factory,
  IPriceOracle,
  IPriceOracle__factory,
  IRebalancingV2Strategy,
  ISplitter__factory,
  ITetuConverter,
  ITetuConverter__factory,
  IUniswapV3Pool__factory,
  KyberConverterStrategy__factory,
  KyberLib, PancakeLib,
  TetuVaultV2,
  UniswapV3ConverterStrategy__factory,
  UniswapV3Lib
} from "../../../typechain";
import {MockHelper} from "../helpers/MockHelper";
import {writeFileSyncRestoreFolder} from "./FileUtils";
import {ConverterAdaptersHelper} from "../converter/ConverterAdaptersHelper";
import {BigNumber} from "ethers";
import {PackedData} from "./PackedData";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_PANCAKE, PLATFORM_UNIV3} from "../strategies/AppPlatforms";
import {PairStrategyLiquidityUtils} from "../strategies/pair/PairStrategyLiquidityUtils";
import {CaptureEvents, IEventsSet, ISummaryFromEventsSet} from "../strategies/CaptureEvents";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

export interface ILiquidityAmountInTick {
  amountTokenA: number;
  amountTokenB: number;
}

export interface IPairState {
  tokenA: string;
  tokenB: string
  tickSpacing: number;
  lowerTick: number;
  upperTick: number;
  rebalanceTickRange: number;
  totalLiquidity: BigNumber;
  currentTick?: ILiquidityAmountInTick;
  withdrawDone: number;
  lastRebalanceNoSwap: number;
}

export interface IUniv3SpecificState {
  rebalanceEarned0: BigNumber; // rebalanceResults[0]
  rebalanceEarned1: BigNumber; // rebalanceResults[1]
}

export interface IUniv3Values {
  specificState: IUniv3SpecificState;
  propNotUnderlying: number;
}

export interface IUniv3Pool {
  token0: string,
  token1: string,
  amount0: BigNumber,
  amount1: BigNumber
}

export interface IBorrowResults {
  borrowGains: number;
  borrowLosses: number;
}

/**
 * Same as IState but all numbers are without decimals
 */
export interface IStateNum {
  title: string;
  block: number;
  blockTimestamp: number;
  signer: {
    assetBalance: number;
  };
  user: {
    assetBalance: number;
  };
  strategy: {
    assetBalance: number;
    totalAssets: number;
    investedAssets: number;
    borrowAssetsNames: string[];
    borrowAssetsBalances: number[];
    rewardTokensBalances?: number[];
    liquidity: number;
    debtToInsurance: number;
  };
  gauge: {
    strategyBalance?: number;
  };
  pool?: {
    tokensBalances: number[];
  };
  splitter: {
    assetBalance: number;
    totalAssets: number;
  };
  vault: {
    assetBalance: number;
    userShares: number;
    signerShares: number;
    userAssetBalance: number;
    signerAssetBalance: number;
    sharePrice: number;
    totalSupply: number;
    totalAssets: number;
  };
  insurance: {
    assetBalance: number;
  };
  converterDirect: {
    collaterals: number[];
    amountsToRepay: number[];
    borrowAssetNames: string[];
    healthFactors: number[][];
    platformAdapters: string[][];
    borrowAssetsPrices: number[];
    borrowAssets: string[];
    borrowAssetsNames: string[];
    collateralsByPos?: number[][];
    amountsToRepayByPos?: number[][];
  };
  converterReverse: {
    collaterals: number[];
    amountsToRepay: number[];
    collateralAssetNames: string[];
    healthFactors: number[][];
    platformAdapters: string[][];
    borrowAssetsPrices: number[];
    borrowAssets: string[];
    borrowAssetsNames: string[];
    collateralsByPos?: number[][];
    amountsToRepayByPos?: number[][];
  };

  fuseStatus?: number;
  // fuseStatusB?: number;
  withdrawDone?: number;

  /**
   * Amount of underlying locked inside converter.
   * It's calculated as sum(amount-of-collateral - amount-to-repay)_by all borrows (both direct and reverse)
   * All amounts are recalculated to underlying
   */
  lockedInConverter: number;
  /**
   * The percent is calculated as lockedInConverter / totalAsset
   */
  lockedPercent: number;

  pairState?: IPairState;

  pairCurrentTick?: ILiquidityAmountInTick;

  univ3?: IUniv3Values;
  univ3Pool?: IUniv3Pool;
  events?: ISummaryFromEventsSet;

  previewBorrowResults?: IBorrowResults;
  additionalParams: number[];
}

export interface IStateParams {
  mainAssetSymbol: string;
  additionalParams?: string[];
}

export interface IGetStateParams {
  eventsSet?: IEventsSet;
  lib?: KyberLib | UniswapV3Lib | AlgebraLib | PancakeLib;
  additionalParamValues?: number[];
}

/**
 * Direct or reverse borrow integral info
 */
export interface IBorrowInfo {
  collaterals: number[];
  amountsToRepay: number[];
  borrowAssetNames: string[];
  collateralAssetNames: string[];
  healthFactors: number[][];
  platformAdapters: string[][];
  totalLockedAmountInUnderlying: number;
  amountsToRepayByPos?: number[][];
  collateralsByPos?: number[][];
}

/**
 * Version of StateUtils without decimals
 */
export class StateUtilsNum {
  public static async getStatePair(
    signer: SignerWithAddress,
    user: SignerWithAddress,
    strategy: IRebalancingV2Strategy,
    vault: TetuVaultV2,
    title?: string,
    p?: IGetStateParams,
  ): Promise<IStateNum> {
    return this.getState(
      signer,
      user,
      ConverterStrategyBase__factory.connect(strategy.address, strategy.signer),
      vault,
      title,
      p,
    );
  }

  public static async getState(
    signer: SignerWithAddress,
    user: SignerWithAddress,
    strategy: ConverterStrategyBase,
    vault: TetuVaultV2,
    title?: string,
    p?: IGetStateParams,
  ): Promise<IStateNum> {
    const block = await hre.ethers.provider.getBlock('latest');
    const splitterAddress = await vault.splitter();
    const insurance = await vault.insurance();
    const asset = IERC20Metadata__factory.connect(await strategy.asset(), signer);
    const assetDecimals = await asset.decimals();
    let liquidity: number;

    let borrowAssets: string[] = [];
    const borrowAssetsBalances: number[] = [];
    const borrowAssetsNames: string[] = [];
    const borrowAssetsPrices: number[] = [];
    let borrowAssetsAddresses: string[] = [];

    let pairState: IPairState | undefined;
    let univ3: IUniv3Values | undefined;
    let univ3Pool: IUniv3Pool | undefined;

    // Direct borrow: borrow an asset using the underlying as collateral
    let directBorrows: IBorrowInfo;

    // Reverse borrow: borrow the underlying using assets as collateral
    let reverseBorrows: IBorrowInfo;

    let gaugeStrategyBalance: number = 0;
    let gaugeDecimals: number = 0;

    let fuseStatusA: number | undefined;
    // let fuseStatusB: number | undefined;
    let withdrawDone: number | undefined;

    let currentTick: ILiquidityAmountInTick | undefined;
    let previewBorrowResults: IBorrowResults | undefined;

    const converter = await ITetuConverter__factory.connect(await strategy.converter(), signer);
    const priceOracle = IPriceOracle__factory.connect(
      await IConverterController__factory.connect(await converter.controller(), signer).priceOracle(),
      signer
    );
    console.log("StateUtilsNumb.converter", converter.address);
    console.log("StateUtilsNumb.priceOracle", priceOracle.address);
    const borrowManager = await IBorrowManager__factory.connect(
      await IConverterController__factory.connect(await converter.controller(), signer).borrowManager(),
      signer
    );

    if (await strategy.PLATFORM() === 'Balancer') {
      const boostedStrategy = BalancerBoostedStrategy__factory.connect(strategy.address, signer);
      const poolAddress = this.getBalancerPoolAddress(await boostedStrategy.poolId());
      const pool = IERC20Metadata__factory.connect(poolAddress, signer);
      liquidity = +formatUnits(await pool.balanceOf(strategy.address), await pool.decimals());
      // todo it's not allowed to deploy contract on each call of this function
      // todo check if the facade is really required and move it to IGetStateParams
      const depositorFacade = await MockHelper.createBalancerBoostedDepositorFacade(signer, poolAddress);

      borrowAssetsAddresses = await depositorFacade._depositorPoolAssetsAccess();
      borrowAssets = borrowAssetsAddresses.filter(a => a !== asset.address);
      for (const item of borrowAssets) {
        const borrowAsset = await IERC20Metadata__factory.connect(item, signer);
        borrowAssetsBalances.push(+formatUnits(await borrowAsset.balanceOf(strategy.address), await borrowAsset.decimals()));
        borrowAssetsNames.push(await borrowAsset.symbol());
      }

      directBorrows = await this.getBorrowInfo(signer, converter, borrowManager, strategy, [asset.address], borrowAssets, priceOracle, true);
      reverseBorrows = await this.getBorrowInfo(signer, converter, borrowManager, strategy, borrowAssets, [asset.address], priceOracle, false);

      const gauge = await IBalancerGauge__factory.connect(await boostedStrategy.gauge(), user);
      gaugeDecimals = (await gauge.decimals()).toNumber();
      gaugeStrategyBalance = +formatUnits(await gauge.balanceOf(strategy.address), gaugeDecimals);
    } else {
      const platform = await strategy.PLATFORM();
      const isUniv3 = platform === PLATFORM_UNIV3;
      const isAlgebra = platform === PLATFORM_ALGEBRA;
      const isKyber = platform === PLATFORM_KYBER;
      const isPancake = platform === PLATFORM_PANCAKE;

      if (isUniv3 || isAlgebra || isKyber || isPancake)  {
        const uniswapV3Strategy = UniswapV3ConverterStrategy__factory.connect(strategy.address, signer);
        const state = await PackedData.getDefaultState(uniswapV3Strategy);
        // console.log("state", state);
        liquidity = +formatUnits(state.totalLiquidity, assetDecimals); // todo correct decimals?
        const tokenB = await IERC20Metadata__factory.connect(state.tokenB, signer);

        borrowAssetsAddresses = [state.tokenA, state.tokenB];
        borrowAssetsBalances.push(+formatUnits(await tokenB.balanceOf(strategy.address), await tokenB.decimals()));
        borrowAssetsNames.push(await tokenB.symbol());

        directBorrows = await this.getBorrowInfo(signer, converter, borrowManager, strategy, [asset.address], [state.tokenB], priceOracle, true);
        reverseBorrows = await this.getBorrowInfo(signer, converter, borrowManager, strategy, [state.tokenB], [asset.address], priceOracle, false);

        fuseStatusA = state.fuseStatus;
        // fuseStatusB = state.fuseStatusTokenB;
        withdrawDone = state.withdrawDone;

        if (p?.lib) {
          const [currentAmountA, currentAmountB] = await PairStrategyLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, platform, p.lib, state.pool, 0);
          currentTick = {
            amountTokenA: +formatUnits(currentAmountA, assetDecimals),
            amountTokenB: +formatUnits(currentAmountB, await tokenB.decimals())
          }
        }

        pairState = {
          tokenA: state.tokenA,
          tokenB: state.tokenB,
          tickSpacing: state.tickSpacing,
          lowerTick: state.lowerTick,
          upperTick: state.upperTick,
          rebalanceTickRange: state.rebalanceTickRange,
          totalLiquidity: state.totalLiquidity,
          currentTick,
          withdrawDone: state.withdrawDone,
          lastRebalanceNoSwap: state.lastRebalanceNoSwap
        }

        if (isUniv3) {
          const uniswapStrategy = UniswapV3ConverterStrategy__factory.connect(strategy.address, signer);
          const specificState = await PackedData.getSpecificStateUniv3(uniswapStrategy);
          univ3 = {
            specificState: {
              rebalanceEarned0: specificState.rebalanceEarned0,
              rebalanceEarned1: specificState.rebalanceEarned1,
            },
            propNotUnderlying: +formatUnits(await uniswapStrategy.getPropNotUnderlying18(), 18)
          }
          const pool = await IUniswapV3Pool__factory.connect(state.pool, signer);
          // const slot0 = await pool.slot0();
          // const facade = await MockHelper.createUniswapV3LibFacade(signer);
          // const poolAmountsForLiquidity = await facade.getAmountsForLiquidity(
          //   slot0.sqrtPriceX96,
          //   state.lowerTick,
          //   state.upperTick,
          //   state.totalLiquidity
          // );
          univ3Pool = {
            token0: await pool.token0(),
            token1: await pool.token1(),
            amount0: BigNumber.from(0), // poolAmountsForLiquidity.amount0,
            amount1: BigNumber.from(0), // poolAmountsForLiquidity.amount1
          };
        }

        if (isAlgebra) {
          const specificState = await PackedData.getSpecificStateAlgebra(AlgebraConverterStrategy__factory.connect(strategy.address, signer));
          // todo
        }

        if (isKyber) {
          const specificState = await PackedData.getSpecificStateKyber(KyberConverterStrategy__factory.connect(strategy.address, signer));
          // todo
        }

      } else {
        throw new Error('Not supported')
      }
    }

    for (const borrowAssetAddress of borrowAssetsAddresses) {
      borrowAssetsPrices.push(+formatUnits(await priceOracle.getAssetPrice(borrowAssetAddress), 18));
    }

    previewBorrowResults = await this.getPreviewBorrowResults(signer, converter, strategy, assetDecimals);

    const totalAssets = +formatUnits(await vault.totalAssets(), assetDecimals);
    const totalAssetInStrategy = +formatUnits(await strategy.totalAssets(), assetDecimals);
    // noinspection UnnecessaryLocalVariableJS
    const dest: IStateNum = {
      title: title || 'no-name',
      block: block.number,
      blockTimestamp: block.timestamp,
      signer: {
        assetBalance: +formatUnits(await asset.balanceOf(signer.address), assetDecimals),
      },
      user: {
        assetBalance: +formatUnits(await asset.balanceOf(user.address), assetDecimals),
      },
      strategy: {
        assetBalance: +formatUnits(await asset.balanceOf(strategy.address), assetDecimals),
        totalAssets: +formatUnits(await strategy.totalAssets(), assetDecimals),
        investedAssets: +formatUnits(await strategy.investedAssets(), assetDecimals),
        liquidity,
        borrowAssetsBalances,
        borrowAssetsNames,
        debtToInsurance: +formatUnits(await strategy.debtToInsurance(), assetDecimals),
      },
      vault: {
        assetBalance: +formatUnits(await asset.balanceOf(vault.address), assetDecimals),
        userShares: +formatUnits(await vault.balanceOf(user.address), assetDecimals),
        signerShares: +formatUnits(await vault.balanceOf(signer.address), assetDecimals),
        userAssetBalance: +formatUnits(await vault.convertToAssets(await vault.balanceOf(user.address)), assetDecimals),
        signerAssetBalance: +formatUnits(await vault.convertToAssets(await vault.balanceOf(signer.address)), assetDecimals),
        sharePrice: +formatUnits(await vault.sharePrice(), assetDecimals),
        totalSupply: +formatUnits(await vault.totalSupply(), assetDecimals),
        totalAssets,
      },
      splitter: {
        assetBalance: +formatUnits(await asset.balanceOf(splitterAddress), assetDecimals),
        totalAssets: +formatUnits(await ISplitter__factory.connect(splitterAddress, user).totalAssets(), assetDecimals),
      },
      insurance: {
        assetBalance: +formatUnits(await asset.balanceOf(insurance), assetDecimals),
      },
      gauge: {
        strategyBalance: gaugeStrategyBalance,
      },
      converterDirect: {
        collaterals: directBorrows.collaterals,
        amountsToRepay: directBorrows.amountsToRepay,
        borrowAssetNames: directBorrows.borrowAssetNames,
        healthFactors: directBorrows.healthFactors,
        platformAdapters: directBorrows.platformAdapters,
        borrowAssetsPrices,
        borrowAssets: borrowAssetsAddresses,
        borrowAssetsNames,
        amountsToRepayByPos: directBorrows.amountsToRepayByPos,
        collateralsByPos: directBorrows.collateralsByPos,
      },
      converterReverse: {
        collaterals: reverseBorrows.collaterals,
        amountsToRepay: reverseBorrows.amountsToRepay,
        collateralAssetNames: reverseBorrows.collateralAssetNames,
        healthFactors: reverseBorrows.healthFactors,
        platformAdapters: reverseBorrows.platformAdapters,
        borrowAssetsPrices,
        borrowAssets: borrowAssetsAddresses,
        borrowAssetsNames,
        amountsToRepayByPos: reverseBorrows.amountsToRepayByPos,
        collateralsByPos: reverseBorrows.collateralsByPos,
      },

      fuseStatus: fuseStatusA,
      withdrawDone,

      lockedInConverter: Math.abs(directBorrows.totalLockedAmountInUnderlying) + Math.abs(reverseBorrows.totalLockedAmountInUnderlying),
      lockedPercent: totalAssetInStrategy === 0
        ? 0
        : (Math.abs(directBorrows.totalLockedAmountInUnderlying) + Math.abs(reverseBorrows.totalLockedAmountInUnderlying)) / totalAssetInStrategy,

      pairState,

      pairCurrentTick: currentTick,

      univ3,
      univ3Pool,

      events: await CaptureEvents.getSummaryFromEventsSet(signer, p?.eventsSet),

      previewBorrowResults,
      additionalParams: p?.additionalParamValues ?? []
    }

    // console.log(dest)

    return dest;
  }

  public static async getPreviewBorrowResults(
    signer: SignerWithAddress,
    converter: ITetuConverter,
    strategy: ConverterStrategyBase,
    assetDecimals: number
  ): Promise<IBorrowResults> {
    const ret = await IBookkeeper__factory.connect(
      await IConverterController__factory.connect(await converter.controller(), signer).bookkeeper(),
      signer
    ).previewPeriod(
      await strategy.asset(),
      strategy.address
    );

    return {
      borrowGains: +formatUnits(ret.gains, assetDecimals),
      borrowLosses: +formatUnits(ret.losses, assetDecimals),
    }
  }

  public static async getBorrowInfo(
    signer: SignerWithAddress,
    converter: ITetuConverter,
    borrowManager: IBorrowManager,
    strategy: ConverterStrategyBase,
    collateralAssets: string[],
    borrowAssets: string[],
    priceOracle: IPriceOracle,
    isDirect: boolean
  ): Promise<IBorrowInfo> {
    const collaterals: number[] = [];
    const amountsToRepay: number[] = [];
    const borrowAssetNames: string[] = [];
    const collateralAssetNames: string[] = [];
    const listHealthFactors: number[][] = [];
    const listPlatformAdapters: string[][] = [];
    const listCollateralsByPos: number[][] = [];
    const listAmountsToRepayByPos: number[][] = [];
    let lockedAmount = 0;

    for (const collateralAsset of collateralAssets) {
      for (const borrowAsset of borrowAssets) {
        const collateralDecimals = await IERC20Metadata__factory.connect(collateralAsset, signer).decimals();
        const borrowDecimals = await IERC20Metadata__factory.connect(borrowAsset, signer).decimals();

        const debtStored = await converter.callStatic.getDebtAmountStored(strategy.address, collateralAsset, borrowAsset, false);

        collaterals.push(+formatUnits(debtStored[1], collateralDecimals));
        amountsToRepay.push(+formatUnits(debtStored[0], borrowDecimals));

        borrowAssetNames.push(await IERC20Metadata__factory.connect(borrowAsset, signer).symbol());
        collateralAssetNames.push(await IERC20Metadata__factory.connect(collateralAsset, signer).symbol());

        lockedAmount += +formatUnits(
        isDirect
          ? debtStored[1].sub(
            // recalculate borrowed asset to underlying; collateral is already underlying
            // spentAmountIn * p.prices[i] * p.decs[d_.indexAsset] / p.prices[d_.indexAsset] / p.decs[i];
              debtStored[0]
                .mul(await priceOracle.getAssetPrice(borrowAsset))
                .mul(parseUnits("1", collateralDecimals))
                .div(await priceOracle.getAssetPrice(collateralAsset))
                .div(parseUnits("1", borrowDecimals))
            )
          // recalculate collateral asset to underlying; borrow-asset is already underlying
          : (debtStored[0]
              .mul(await priceOracle.getAssetPrice(collateralAsset))
              .mul(parseUnits("1", borrowDecimals))
              .div(await priceOracle.getAssetPrice(borrowAsset))
              .div(parseUnits("1", collateralDecimals))
            ).sub(debtStored[1]),
          isDirect ? collateralDecimals : borrowDecimals
        );

        const healthFactors: number[] = [];
        const platformAdapters: string[] = [];
        const collateralsByPos: number[] = [];
        const amountsToRepayByPos: number[] = [];
        const positions = await converter.callStatic.getPositions(strategy.address, collateralAsset, borrowAsset);
        for (const position of positions) {
          const poolAdapter = IPoolAdapter__factory.connect(position, signer);
          const status = await poolAdapter.getStatus();
          healthFactors.push(+formatUnits(status.healthFactor18, 18));
          collateralsByPos.push(+formatUnits(status.collateralAmount, collateralDecimals));
          amountsToRepayByPos.push(+formatUnits(status.amountToPay, borrowDecimals));

          const config = await poolAdapter.getConfig();
          platformAdapters.push(
            await ConverterAdaptersHelper.getPlatformAdapterName(signer, await borrowManager.getPlatformAdapter(config.originConverter))
          );
        }
        listHealthFactors.push(healthFactors);
        listPlatformAdapters.push(platformAdapters);
        listCollateralsByPos.push(collateralsByPos);
        listAmountsToRepayByPos.push(amountsToRepayByPos);
      }
    }

    return {
      amountsToRepay,
      collaterals,
      borrowAssetNames,
      healthFactors: listHealthFactors,
      platformAdapters: listPlatformAdapters,
      collateralAssetNames,
      totalLockedAmountInUnderlying: lockedAmount,
      amountsToRepayByPos: listAmountsToRepayByPos,
      collateralsByPos: listCollateralsByPos
    }
  }

  public static getPrice(
    asset: string,
    borrowAssetsAddresses: string[],
    borrowAssetsPrices: number[],
  ){
    for (let i = 0; i < borrowAssetsAddresses.length; ++i) {
      if (borrowAssetsAddresses[i].toLowerCase() === asset.toLowerCase()) {
        return borrowAssetsPrices[i];
      }
    }
    return 0;
  }

  public static getTotalMainAssetAmount(state: IStateNum): number {
    return state.user.assetBalance
      + state.signer.assetBalance
      + state.vault.assetBalance
      + state.insurance.assetBalance
      + state.strategy.assetBalance
      + state.splitter.assetBalance;
  }

  public static getCsvData(params: IStateParams): { stateHeaders: string[] } {
    const mainAssetSymbol = params.mainAssetSymbol
    const stateHeaders = [
      'title',
      'block',
      'timestamp',

      `signer.${mainAssetSymbol}`,
      `user.${mainAssetSymbol}`,

      'vault.user.shares',
      'vault.signer.shares',

      `vault.user.${mainAssetSymbol}`,
      `vault.signer.${mainAssetSymbol}`,

      'vault.sharePrice',
      'vault.totalSupply',
      'vault.totalAssets',

      `insurance.${mainAssetSymbol}`,

      `strategy.${mainAssetSymbol}`,
      'strategy.borrowAssetsBalances',
      'strategy.rewardAssetsBalances',
      'strategy.liquidity',
      'strategy.totalAssets',
      'strategy.investedAssets',
      'strategy.debtToInsurance',

      'gauge.balance',

      `vault.${mainAssetSymbol}`,

      `splitter.${mainAssetSymbol}`,
      'splitter.totalAssets',

      'd-converter.collaterals',
      'd-converter.amountsToRepay',
      'd-converter.healthFactors',
      'd-converter.platformAdapters',
      'd-converter.borrowAssets',
      'd-converter.prices',

      'r-converter.collaterals',
      'r-converter.amountsToRepay',
      'r-converter.healthFactors',
      'r-converter.platformAdapters',
      'r-converter.collateralAssets',
      'r-converter.prices',

      'converter.u.locked',
      'converter.%.locked',

      'pair.tokenA',
      'pair.tokenB',
      'pair.tickSpacing',
      'pair.lowerTick',
      'pair.upperTick',
      'pair.rebalanceTickRange',
      'pair.totalLiquidity',

      'univ3.rebalanceEarned0',
      'univ3.rebalanceEarned1',
      'univ3.propNotUnderlying',

      "pool.token0",
      "pool.token1",
      "pool.amount0",
      "pool.amount1",

      'fuseStatus',
      'withdrawDone',

      'events.lossSplitter',
      'events.lossCoveredVault',
      'events.feeTransferVault',
      'events.lossUncoveredCutByMax',

      'events.onCoverLoss.lossToCover',
      'events.onCoverLoss.amountCovered',
      'events.lossUncoveredNotEnoughInsurance',
      'events.onCoverLoss.debtToInsuranceInc',
        
      'events.sentToInsurance',
      'events.unsentToInsurance',
        
      'events.debtToInsuranceOnProfit.debtToInsuranceBefore',
      'events.debtToInsuranceOnProfit.increaseToDebt',

      'events.payToInsurance.debtToInsuranceBefore',
      'events.payToInsurance.debtToInsuranceAfter',
      'events.payToInsurance.debtPaid',

      'events.toPerfRecycle',
      'events.toInsuranceRecycle',
      'events.toForwarderRecycle',
      'events.lossRebalance',

      "fixPriceChanges.debtToInsuranceBefore",
      "fixPriceChanges.debtToInsuranceAfter",
      "fixPriceChanges.increaseToDebt",
      "fixPriceChanges.investedAssetsBefore",
      "fixPriceChanges.investedAssetsAfter",

      'swapByAgg.amountToSwap',
      'swapByAgg.amountIn',
      'swapByAgg.amountOut',
      'swapByAgg.amountOutExpected',
      'swapByAgg.aggregator',

      'borrowResults.gains',
      'borrowResults.losses',

      'preview.borrowGains',
      'preview.borrowLosses',

      "hw.investedAssetsNewPrices",
      "hw.earnedByPrices",
      "hw.earnedDeposit",
      "hw.lostDeposit",
      "hw.earnedHandleRewards",
      "hw.lostHandleRewards",
      "hw.paidDebtToInsurance",

      "hardwork.sender",
      "hardwork.strategy",
      "hardwork.tvl",
      "hardwork.avgApr",
      "hardwork.apr",
      "hardwork.lost",
      "hardwork.earned",

      "onWithdraw.earned",
      "onWithdraw.earnedByPrice",
      "onWithdraw.earned-earnedByPrice",
    ];

    if (params.additionalParams) {
      for (const title of params.additionalParams) {
        stateHeaders.push(title);
      }
    }

    return { stateHeaders };
  }

  /**
   * Put data of a state into a separate column
   */
  public static saveListStatesToCSVColumns(pathOut: string, states: IStateNum[], params: IStateParams, override: boolean = true) {
    // console.log("saveListStatesToCSVColumns", states);
    const { stateHeaders } = this.getCsvData(params);
    const headers = [
      '',
      ...states.map(x => x.title),
    ];
    const rows = states.map(item => [
      item.title,
      item.block,
      item.blockTimestamp,

      item.signer.assetBalance,
      item.user.assetBalance,

      item.vault.userShares,
      item.vault.signerShares,

      item.vault.userAssetBalance,
      item.vault.signerAssetBalance,

      item.vault.sharePrice,
      item.vault.totalSupply,
      item.vault.totalAssets,

      item.insurance.assetBalance,
      item.strategy.assetBalance,
      item.strategy.borrowAssetsBalances?.join(" "),
      item.strategy.rewardTokensBalances?.join(' '),
      item.strategy.liquidity,
      item.strategy.totalAssets,
      item.strategy.investedAssets,
      item.strategy.debtToInsurance,

      item.gauge.strategyBalance,

      item.vault.assetBalance,
      item.splitter.assetBalance,
      item.splitter.totalAssets,

      item.converterDirect?.collaterals.join(' '),
      item.converterDirect?.amountsToRepay.join(' '),
      item.converterDirect?.healthFactors.map(x => x.join(" ")).join(" "),
      item.converterDirect?.platformAdapters.map(x => x.join(" ")).join(" "),
      item.converterDirect?.borrowAssetsNames?.join(" "),
      item.converterDirect?.borrowAssetsPrices?.join(" "),

      item.converterReverse?.collaterals.join(' '),
      item.converterReverse?.amountsToRepay.join(' '),
      item.converterReverse?.healthFactors.map(x => x.join(" ")).join(" "),
      item.converterReverse?.platformAdapters.map(x => x.join(" ")).join(" "),
      item.converterReverse?.collateralAssetNames?.join(" "),
      item.converterReverse?.borrowAssetsPrices?.join(" "),

      item.lockedInConverter,
      item.lockedPercent,

      item.pairState?.tokenA,
      item.pairState?.tokenB,
      item.pairState?.tickSpacing,
      item.pairState?.lowerTick,
      item.pairState?.upperTick,
      item.pairState?.rebalanceTickRange,
      item.pairState?.totalLiquidity,

      item.univ3?.specificState.rebalanceEarned0,
      item.univ3?.specificState.rebalanceEarned1,
      item.univ3?.propNotUnderlying,

      item.univ3Pool?.token0,
      item.univ3Pool?.token1,
      item.univ3Pool?.amount0,
      item.univ3Pool?.amount1,

      item.fuseStatus,
      item.withdrawDone,


      item.events?.lossSplitter,
      item.events?.lossCoveredVault,
      item.events?.feeTransferVault,
      item.events?.lossUncoveredCutByMax,

      item.events?.onCoverLoss.lossToCover,
      item.events?.onCoverLoss.amountCovered,
      item.events?.onCoverLoss.lossUncoveredNotEnoughInsurance,
      item.events?.onCoverLoss.debtToInsuranceInc,

      item.events?.sentToInsurance,
      item.events?.unsentToInsurance,

      item.events?.changeDebtToInsuranceOnProfit?.debtToInsuranceBefore,
      item.events?.changeDebtToInsuranceOnProfit?.increaseToDebt,

      item.events?.payDebtToInsurance?.debtToInsuranceBefore,
      item.events?.payDebtToInsurance?.debtToInsuranceAfter,
      item.events?.payDebtToInsurance?.debtPaid,

      item.events?.toPerfRecycle,
      item.events?.toInsuranceRecycle,
      item.events?.toForwarderRecycle.join(" "),
      item.events?.lossRebalance,

      item.events?.fixPriceChanges.debtToInsuranceBefore,
      item.events?.fixPriceChanges.debtToInsuranceAfter,
      item.events?.fixPriceChanges.increaseToDebt,
      item.events?.fixPriceChanges.investedAssetsBefore,
      item.events?.fixPriceChanges.investedAssetsAfter,

      item.events?.swapByAgg?.amountToSwap,
      item.events?.swapByAgg?.amountIn,
      item.events?.swapByAgg?.amountOut,
      item.events?.swapByAgg?.amountOutExpected,
      !item.events?.swapByAgg?.aggregator
        ? ""
        : item.events?.swapByAgg?.aggregator.toLowerCase() === MaticAddresses.AGG_ONEINCH_V5
          ? "1inch"
          : item.events?.swapByAgg?.aggregator.toLowerCase() === MaticAddresses.TETU_LIQUIDATOR
              ? "liquidator"
              : item.events?.swapByAgg?.aggregator.toLowerCase() === MaticAddresses.AGG_OPENOCEAN
                ? "OpenOcean"
                : "???",

      item.events?.borrowResults.gains,
      item.events?.borrowResults.losses,

      item.previewBorrowResults?.borrowGains,
      item.previewBorrowResults?.borrowLosses,

      item.events?.onHardWorkEarnedLost?.investedAssetsNewPrices,
      item.events?.onHardWorkEarnedLost?.earnedByPrices,
      item.events?.onHardWorkEarnedLost?.earnedDeposit,
      item.events?.onHardWorkEarnedLost?.lostDeposit,
      item.events?.onHardWorkEarnedLost?.earnedHandleRewards,
      item.events?.onHardWorkEarnedLost?.lostHandleRewards,
      item.events?.onHardWorkEarnedLost?.paidDebtToInsurance,

      item.events?.hardwork?.sender,
      item.events?.hardwork?.strategy,
      item.events?.hardwork?.tvl,
      item.events?.hardwork?.avgApr,
      item.events?.hardwork?.apr,
      item.events?.hardwork?.lost,
      item.events?.hardwork?.earned,

      item.events?.onEarningOnWithdraw?.earned,
      item.events?.onEarningOnWithdraw?.earnedByPrice,
      item.events?.onEarningOnWithdraw?.delta,

      ...item.additionalParams
    ]);

    writeFileSyncRestoreFolder(pathOut, headers.join(';') + '\n', { encoding: 'utf8', flag: override ? 'w' : 'a'});
    for (let i = 0; i < stateHeaders.length; ++i) {
      const line = [stateHeaders[i], ...rows.map(x => x[i])];
      writeFileSync(
        pathOut,
        line.join(';') + '\n',
        { encoding: 'utf8', flag: 'a' },
      );
    }
  }

  /**
   * Get initial state marked as "enter"
   * and final state marked as "final"
   * @param states
   */
  public static outputProfit(states: IStateNum[]) {
    if (states.length < 2) {
      return;
    }

    const enter: IStateNum = states[0];
    const final: IStateNum = states[states.length - 1];

    this.outputProfitEnterFinal(enter, final);
  }


  public static outputProfitEnterFinal(enter: IStateNum, final: IStateNum) {
    // ethereum timestamp is in seconds
    // https://ethereum.stackexchange.com/questions/7853/is-the-block-timestamp-value-in-solidity-seconds-or-milliseconds
    const timeSeconds = (final.blockTimestamp - enter.blockTimestamp);
    const initialAmount = this.getTotalMainAssetAmount((enter));
    const finalAmount = this.getTotalMainAssetAmount(final);
    const amount = finalAmount - initialAmount;
    const amountNum = +formatUnits(amount, 6);
    const apr = amountNum * 365
      / (timeSeconds / (24 * 60 * 60))
      / +formatUnits(initialAmount, 6)
      * 100;
    console.log('final.blockTimestamp', final.blockTimestamp);
    console.log('enter.blockTimestamp', enter.blockTimestamp);
    console.log('final.getTotalMainAssetAmount', this.getTotalMainAssetAmount(final));
    console.log('enter.getTotalMainAssetAmount', this.getTotalMainAssetAmount(enter));
    console.log('Initial amount', initialAmount);
    console.log('Final amount', initialAmount);
    console.log('Total profit', amountNum);
    console.log('Duration in seconds', timeSeconds);
    console.log('Duration in days', timeSeconds / (24 * 60 * 60));
    console.log('Estimated APR, %', apr);
  }

  public static getBalancerPoolAddress(poolId: string) {
    return poolId.substring(0, 42)
  }

  public static getTotalUncoveredLoss(states: IStateNum[]) : number {
    let dest = 0;
    for (const state of states) {
      dest += (state.events?.lossUncoveredCutByMax ?? 0) + (state.events?.onCoverLoss?.lossUncoveredNotEnoughInsurance ?? 0);
    }
    return dest;
  }
}