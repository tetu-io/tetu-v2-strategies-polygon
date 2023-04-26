/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre from "hardhat";
import {formatUnits} from "ethers/lib/utils";
import {writeFileSync} from "fs";
import {
  BalancerBoostedStrategy__factory,
  ConverterStrategyBase, IBalancerGauge__factory, IBorrowManager__factory, IConverterController__factory,
  IERC20__factory, IERC20Metadata__factory, IPoolAdapter__factory, ISplitter__factory, ITetuConverter__factory,
  TetuVaultV2, UniswapV3ConverterStrategy__factory
} from "../../../typechain";
import {MockHelper} from "../helpers/MockHelper";
import {writeFileSyncRestoreFolder} from "./FileUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ConverterAdaptersHelper} from "../converter/ConverterAdaptersHelper";

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
  converter: {
    collaterals: number[];
    amountsToRepay: number[];
    borrowAssetNames: string[];
    healthFactors: number[][];
    platformAdapters: string[][];
  };
}

export interface IStateParams {
  mainAssetSymbol: string;
}

/**
 * Version of StateUtils without decimals
 */
export class StateUtilsNum {
  public static async getState(
    signer: SignerWithAddress,
    user: SignerWithAddress,
    strategy: ConverterStrategyBase,
    vault: TetuVaultV2,
    title?: string,
  ): Promise<IStateNum> {
    const block = await hre.ethers.provider.getBlock('latest');
    const splitterAddress = await vault.splitter();
    const insurance = await vault.insurance();
    const asset = IERC20Metadata__factory.connect(await strategy.asset(), signer);
    const assetDecimals = await asset.decimals();
    let liquidity: number;

    let borrowAssets: string[];
    const borrowAssetsBalances: number[] = [];
    const borrowAssetsNames: string[] = [];
    const collaterals: number[] = [];
    const amountsToRepay: number[] = [];
    const converterBorrowAssetNames: string[] = []
    const converterHealthFactors: number[][] = []
    const converterPlatformAdapters: string[][] = [];

    let gaugeStrategyBalance: number = 0;
    let gaugeDecimals: number = 0;

    const converter = await ITetuConverter__factory.connect(await strategy.converter(), signer);
    const borrowManager = await IBorrowManager__factory.connect(
      await IConverterController__factory.connect(await converter.controller(), signer).borrowManager(),
      signer
    );


    if (await strategy.PLATFORM() === 'Balancer') {
      const boostedStrategy = BalancerBoostedStrategy__factory.connect(strategy.address, signer);
      const poolAddress = this.getBalancerPoolAddress(await boostedStrategy.poolId());
      const pool = IERC20Metadata__factory.connect(poolAddress, signer);
      liquidity = +formatUnits(await pool.balanceOf(strategy.address), await pool.decimals());
      const depositorFacade = await MockHelper.createBalancerBoostedDepositorFacade(signer, poolAddress);

      borrowAssets = await depositorFacade._depositorPoolAssetsAccess();
      borrowAssets = borrowAssets.filter(a => a !== asset.address);
      for (const item of borrowAssets) {
        const borrowAsset = await IERC20Metadata__factory.connect(item, signer);
        borrowAssetsBalances.push(+formatUnits(await borrowAsset.balanceOf(strategy.address), await borrowAsset.decimals()));
        borrowAssetsNames.push(await borrowAsset.symbol());

        const debtStored = await converter.callStatic.getDebtAmountCurrent(strategy.address, asset.address, item, false);
        collaterals.push(+formatUnits(debtStored[1], assetDecimals));
        amountsToRepay.push(+formatUnits(debtStored[0], await borrowAsset.decimals()));
        converterBorrowAssetNames.push(await borrowAsset.symbol());

        const positions = await converter.callStatic.getPositions(strategy.address, asset.address, item);
        const healthFactors: number[] = [];
        const platformAdapters: string[] = [];
        for (const position of positions) {
          const poolAdapter = IPoolAdapter__factory.connect(position, signer);
          const status = await poolAdapter.getStatus();
          healthFactors.push(+formatUnits(status.healthFactor18, 18));

          const config = await poolAdapter.getConfig();
          platformAdapters.push(ConverterAdaptersHelper.getPlatformAdapterName(await borrowManager.getPlatformAdapter(config.originConverter)));
        }
        converterHealthFactors.push(healthFactors);
        converterPlatformAdapters.push(platformAdapters);
      }
      const gauge = await IBalancerGauge__factory.connect(await boostedStrategy.gauge(), user);
      gaugeDecimals = (await gauge.decimals()).toNumber();
      gaugeStrategyBalance = +formatUnits(await gauge.balanceOf(strategy.address), gaugeDecimals);
    } else if (await strategy.PLATFORM() === 'UniswapV3')  {
      const uniswapV3Strategy = UniswapV3ConverterStrategy__factory.connect(strategy.address, signer);
      const state = await uniswapV3Strategy.getState();
      liquidity = +formatUnits(
        state.totalLiquidity,
        assetDecimals // todo
      );
      const tokenB = await IERC20Metadata__factory.connect(state.tokenB, signer);
      borrowAssetsBalances.push(+formatUnits(await tokenB.balanceOf(strategy.address), await tokenB.decimals()));
      borrowAssetsNames.push(await tokenB.symbol());

      const debtStored = await converter.callStatic.getDebtAmountCurrent(strategy.address, asset.address, state.tokenB, false);
      collaterals.push(+formatUnits(debtStored[1], assetDecimals));
      amountsToRepay.push(+formatUnits(debtStored[0], await tokenB.decimals()));
      converterBorrowAssetNames.push(await tokenB.symbol());

      const positions = await converter.callStatic.getPositions(strategy.address, asset.address, state.tokenB);
      const healthFactors: number[] = [];
      const platformAdapters: string[] = [];
      for (const position of positions) {
        const poolAdapter = IPoolAdapter__factory.connect(position, signer);
        const status = await poolAdapter.getStatus();
        healthFactors.push(+formatUnits(status.healthFactor18, 18));

        const config = await poolAdapter.getConfig();
        platformAdapters.push(ConverterAdaptersHelper.getPlatformAdapterName(await borrowManager.getPlatformAdapter(config.originConverter)));
      }
      converterHealthFactors.push(healthFactors);
      converterPlatformAdapters.push(platformAdapters);
    } else {
      throw new Error('Not supported')
    }

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
      },
      vault: {
        assetBalance: +formatUnits(await asset.balanceOf(vault.address), assetDecimals),
        userShares: +formatUnits(await vault.balanceOf(user.address), assetDecimals),
        signerShares: +formatUnits(await vault.balanceOf(signer.address), assetDecimals),
        userAssetBalance: +formatUnits(await vault.convertToAssets(await vault.balanceOf(user.address)), assetDecimals),
        signerAssetBalance: +formatUnits(await vault.convertToAssets(await vault.balanceOf(signer.address)), assetDecimals),
        sharePrice: +formatUnits(await vault.sharePrice(), assetDecimals),
        totalSupply: +formatUnits(await vault.totalSupply(), assetDecimals),
        totalAssets: +formatUnits(await vault.totalAssets(), assetDecimals),
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
      converter: {
        collaterals,
        amountsToRepay,
        borrowAssetNames: converterBorrowAssetNames,
        healthFactors: converterHealthFactors,
        platformAdapters: converterPlatformAdapters
      }
    }

    // console.log(dest)

    return dest
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

      'gauge.balance',

      `vault.${mainAssetSymbol}`,

      `splitter.${mainAssetSymbol}`,
      'splitter.totalAssets',

      'converter.collaterals',
      'converter.amountsToRepay',
      'converter.healthFactors',
      'converter.platformAdapters',
    ];

    return { stateHeaders };
  }

  /**
   * Put data of a state into a separate column
   */
  public static saveListStatesToCSVColumns(pathOut: string, states: IStateNum[], params: IStateParams) {
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
      item.strategy.borrowAssetsBalances.join(','),
      item.strategy.rewardTokensBalances?.join(','),
      item.strategy.liquidity,
      item.strategy.totalAssets,
      item.strategy.investedAssets,
      item.gauge.strategyBalance,
      item.vault.assetBalance,
      item.splitter.assetBalance,
      item.splitter.totalAssets,

      item.converter?.collaterals.join(','),
      item.converter?.amountsToRepay.join(','),
      item.converter?.healthFactors.map(x => x.join(" ")).join(","),
      item.converter?.platformAdapters.map(x => x.join(" ")).join(","),
    ]);

    writeFileSyncRestoreFolder(pathOut, headers.join(';') + '\n', { encoding: 'utf8', flag: 'a' });
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
}