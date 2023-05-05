/* tslint:disable:no-trailing-whitespace */
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BalancerBoostedStrategy__factory,
  ConverterStrategyBase, IBalancerGauge__factory,
  IERC20__factory, ISplitter__factory, ITetuConverter__factory,
  TetuVaultV2, UniswapV3ConverterStrategy__factory
} from "../typechain";
import hre from "hardhat";
import {MockHelper} from "./baseUT/helpers/MockHelper";
import {formatUnits} from "ethers/lib/utils";
import {writeFileSyncRestoreFolder} from "./baseUT/utils/FileUtils";
import {writeFileSync} from "fs";


export interface IState {
  title: string;
  block: number;
  blockTimestamp: number;
  signer: {
    assetBalance: BigNumber;
  };
  user: {
    assetBalance: BigNumber;
  };
  strategy: {
    assetBalance: BigNumber;
    totalAssets: BigNumber;
    investedAssets: BigNumber;
    borrowAssetsBalances: BigNumber[];
    rewardTokensBalances?: BigNumber[];
    liquidity: BigNumber;
  };
  gauge: {
    strategyBalance?: BigNumber;
  };
  pool?: {
    tokensBalances: BigNumber[];
  };
  splitter: {
    assetBalance: BigNumber;
    totalAssets: BigNumber;
  };
  vault: {
    assetBalance: BigNumber;
    userShares: BigNumber;
    signerShares: BigNumber;
    userAssetBalance: BigNumber;
    signerAssetBalance: BigNumber;
    sharePrice: BigNumber;
    totalSupply: BigNumber;
    totalAssets: BigNumber;
  };
  insurance: {
    assetBalance: BigNumber;
  };
  converter: {
    collaterals: BigNumber[];
    amountsToRepay: BigNumber[];
  };
}

export interface IPutInitialAmountsBalancesResults {
  balanceUser: BigNumber;
  balanceSigner: BigNumber;
}

export interface IStateParams {
  mainAssetSymbol: string;
  mainAssetDecimals?: number;
}

export class StateUtils {
  public static async getState(
    signer: SignerWithAddress,
    user: SignerWithAddress,
    strategy: ConverterStrategyBase,
    vault: TetuVaultV2,
    title?: string,
  ): Promise<IState> {
    const block = await hre.ethers.provider.getBlock('latest');
    const splitterAddress = await vault.splitter();
    const insurance = await vault.insurance();
    const asset = IERC20__factory.connect(await strategy.asset(), signer)
    let liquidity: BigNumber
    let borrowAssets: string[]
    const borrowAssetsBalances: BigNumber[] = []
    const collaterals: BigNumber[] = []
    const amountsToRepay: BigNumber[] = []
    let gaugeStrategyBalance: BigNumber = BigNumber.from(0)

    if (await strategy.PLATFORM() === 'Balancer') {
      const boostedStrategy = BalancerBoostedStrategy__factory.connect(strategy.address, signer)
      const poolAddress = this.getBalancerPoolAddress(await boostedStrategy.poolId())
      const pool = IERC20__factory.connect(poolAddress, signer)
      liquidity = await pool.balanceOf(strategy.address)
      const depositorFacade = await MockHelper.createBalancerBoostedDepositorFacade(signer, poolAddress)
      borrowAssets = await depositorFacade._depositorPoolAssetsAccess()
      borrowAssets = borrowAssets.filter(a => a !== asset.address)
      for (const item of borrowAssets) {
        borrowAssetsBalances.push(await IERC20__factory.connect(item, signer).balanceOf(strategy.address))
        const debtStored = await ITetuConverter__factory.connect(await strategy.converter(), signer).callStatic.getDebtAmountCurrent(
          strategy.address,
          asset.address,
          item,
          false
        )
        collaterals.push(debtStored[1])
        amountsToRepay.push(debtStored[0])
      }
      gaugeStrategyBalance = await IBalancerGauge__factory.connect(await boostedStrategy.gauge(), user).balanceOf(strategy.address)

    } else if (await strategy.PLATFORM() === 'UniswapV3')  {
      const uniswapV3Stratety = UniswapV3ConverterStrategy__factory.connect(strategy.address, signer)
      const state = await uniswapV3Stratety.getState()
      liquidity = state.totalLiquidity
      borrowAssetsBalances.push(await IERC20__factory.connect(state.tokenB, signer).balanceOf(strategy.address))
      const debtStored = await ITetuConverter__factory.connect(await strategy.converter(), signer).callStatic.getDebtAmountCurrent(
        strategy.address,
        asset.address,
        state.tokenB,
        false
      )
      collaterals.push(debtStored[1])
      amountsToRepay.push(debtStored[0])
    } else {
      throw new Error('Not supported')
    }

    // noinspection UnnecessaryLocalVariableJS
    const dest: IState = {
      title: title || 'no-name',
      block: block.number,
      blockTimestamp: block.timestamp,
      signer: {
        assetBalance: await asset.balanceOf(signer.address),
      },
      user: {
        assetBalance: await asset.balanceOf(user.address),
      },
      strategy: {
        assetBalance: await asset.balanceOf(strategy.address),
        totalAssets: await strategy.totalAssets(),
        investedAssets: await strategy.investedAssets(),
        liquidity,
        borrowAssetsBalances,
      },
      vault: {
        assetBalance: await asset.balanceOf(vault.address),
        userShares: await vault.balanceOf(user.address),
        signerShares: await vault.balanceOf(signer.address),
        userAssetBalance: await vault.convertToAssets(await vault.balanceOf(user.address)),
        signerAssetBalance: await vault.convertToAssets(await vault.balanceOf(signer.address)),
        sharePrice: await vault.sharePrice(),
        totalSupply: await vault.totalSupply(),
        totalAssets: await vault.totalAssets(),
      },
      splitter: {
        assetBalance: await asset.balanceOf(splitterAddress),
        totalAssets: await ISplitter__factory.connect(splitterAddress, user).totalAssets(),
      },
      insurance: {
        assetBalance: await asset.balanceOf(insurance),
      },
      gauge: {
        strategyBalance: gaugeStrategyBalance,
      },
      converter: {
        collaterals,
        amountsToRepay,
      }
    }

    // console.log(dest)

    return dest
  }

  public static getTotalMainAssetAmount(state: IState): BigNumber {
    return state.user.assetBalance.add(
      state.signer.assetBalance,
    ).add(
      state.vault.assetBalance,
    ).add(
      state.insurance.assetBalance,
    ).add(
      state.strategy.assetBalance,
    ).add(
      state.splitter.assetBalance,
    );
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

    ];

    return { stateHeaders };
  }

  /**
   * Put data of a state into a separate column
   */
  public static saveListStatesToCSVColumns(pathOut: string, states: IState[], params: IStateParams) {
    const { stateHeaders } = this.getCsvData(params);
    const headers = [
      '',
      ...states.map(x => x.title),
    ];
    const formatMainAssetUnits = (amount: BigNumber, decimals?: number) => decimals ? +formatUnits(amount, decimals) : amount.toString()

    const rows = states.map(item => [
      item.title,
      item.block,
      item.blockTimestamp,

      formatMainAssetUnits(item.signer.assetBalance, params.mainAssetDecimals),
      formatMainAssetUnits(item.user.assetBalance, params.mainAssetDecimals),

      formatMainAssetUnits(item.vault.userShares, params.mainAssetDecimals),
      formatMainAssetUnits(item.vault.signerShares, params.mainAssetDecimals),

      formatMainAssetUnits(item.vault.userAssetBalance, params.mainAssetDecimals),
      formatMainAssetUnits(item.vault.signerAssetBalance, params.mainAssetDecimals),

      formatMainAssetUnits(item.vault.sharePrice, params.mainAssetDecimals),
      formatMainAssetUnits(item.vault.totalSupply, params.mainAssetDecimals),
      formatMainAssetUnits(item.vault.totalAssets, params.mainAssetDecimals),

      formatMainAssetUnits(item.insurance.assetBalance, params.mainAssetDecimals),
      formatMainAssetUnits(item.strategy.assetBalance, params.mainAssetDecimals),
      item.strategy.borrowAssetsBalances.map(a => a.toString()).join(' '),
      item.strategy.rewardTokensBalances?.join(' '),
      item.strategy.liquidity,
      formatMainAssetUnits(item.strategy.totalAssets, params.mainAssetDecimals),
      formatMainAssetUnits(item.strategy.investedAssets, params.mainAssetDecimals),
      item.gauge.strategyBalance,
      formatMainAssetUnits(item.vault.assetBalance, params.mainAssetDecimals),
      formatMainAssetUnits(item.splitter.assetBalance, params.mainAssetDecimals),
      formatMainAssetUnits(item.splitter.totalAssets, params.mainAssetDecimals),

      item.converter?.collaterals.map(a => a.toString()).join(' '),
      item.converter?.amountsToRepay.map(a => a.toString()).join(' '),
    ]);

    writeFileSyncRestoreFolder(pathOut, headers.join(';') + '\n', { encoding: 'utf8', flag: 'a' });
    for (let i = 0; i < stateHeaders.length; ++i) {
      const line = [stateHeaders[i], ...rows.map(x => x[i])];
      writeFileSync(
        pathOut,
        line/*.map((x) =>
          typeof x === 'object'
            ? +formatUnits(x, stateDecimals[i])
            : '' + x,
        )*/.join(';') + '\n',
        { encoding: 'utf8', flag: 'a' },
      );
    }
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
    const initialAmount = this.getTotalMainAssetAmount((enter));
    const finalAmount = this.getTotalMainAssetAmount(final);
    const amount = finalAmount.sub(initialAmount);
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