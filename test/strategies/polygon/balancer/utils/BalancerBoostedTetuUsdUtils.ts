import { MaticHolders } from '../../../../../scripts/addresses/MaticHolders';
import { BigNumber } from 'ethers';
import {
  IBVault__factory, IComposableStablePool__factory,
  IERC20__factory, IERC20Metadata__factory, ILinearPool__factory,
} from '../../../../../typechain';
import { MaticAddresses } from '../../../../../scripts/addresses/MaticAddresses';
import { Misc } from '../../../../../scripts/utils/Misc';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {formatUnits, parseUnits} from "ethers/lib/utils";

export interface IBalancerSwapResults {
  poolTokensBeforeSwap: {
    tokens: string[];
    balances: BigNumber[];
    lastChangeBlock: BigNumber;
  };
  poolTokensAfterSwap: {
    tokens: string[];
    balances: BigNumber[];
    lastChangeBlock: BigNumber;
  };
  resultAmountAfterSwap: BigNumber;

  /**
   * initial price of source asset * 1e18 / final price of the source asset
   */
  priceRatioSourceAsset18: BigNumber;

  /**
   * initial price of target asset * 1e18 / final price of the target asset
   */
  pricesRatioTargetAsset18: BigNumber;

  totalAmountIn: BigNumber;
}

interface ISwapTokensParams {
  approxPercentOnEachStep: number;
  countSwaps: number;
  from: {
    token: string;
    bbt: string;
    holder: string;
    index: number;
  }
  to: {
    token: string;
    bbt: string;
    index: number;
  }
}

/**
 * Change prices in "Balancer Boosted Tetu USD" by swapping big amounts
 */
export class BalancerBoostedTetuUsdUtils {
  // index of DAI in balancerVault.getPoolTokens()=>tokens
  public static readonly DAI_TOKENS_INDEX = 3;
  public static readonly USDC_TOKENS_INDEX = 1;
  public static readonly USDT_TOKENS_INDEX = 0;
  public static readonly bbtDAI = "0xDa1CD1711743e57Dd57102E9e61b75f3587703da";
  public static readonly bbtUSDC = "0xae646817e458C0bE890b81e8d880206710E3c44e";
  public static readonly bbtUSDT = "0x7c82A23B4C48D796dee36A9cA215b641C6a8709d";
  public static readonly balancerVaultAddress = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
  public static readonly holderDAI = MaticHolders.HOLDER_DAI;
  public static readonly holderUSDC = MaticHolders.HOLDER_USDC;
  public static readonly holderUSDT = MaticHolders.HOLDER_USDT;
  // Balancer Boosted Aave USD pool ID
  public static readonly poolBoostedId = '0xb3d658d5b95bf04e2932370dd1ff976fe18dd66a000000000000000000000ace';

  public static async swapDaiToUsdt(
    signer: SignerWithAddress,
    approxPercentOnEachStep: number,
    countSwaps: number = 1,
  ): Promise<IBalancerSwapResults> {
    return this.swapTokens(
      signer,
      {
        approxPercentOnEachStep,
        countSwaps,
        from: {
          token: MaticAddresses.DAI_TOKEN,
          bbt: this.bbtDAI,
          holder: this.holderDAI,
          index: this.DAI_TOKENS_INDEX
        },
        to: {
          token: MaticAddresses.USDT_TOKEN,
          bbt: this.bbtUSDT,
          index: this.USDT_TOKENS_INDEX
        }
      }
    );
  }

  public static async swapDaiToUsdc(
    signer: SignerWithAddress,
    approxPercentOnEachStep: number,
    countSwaps: number = 1,
  ): Promise<IBalancerSwapResults> {
    return this.swapTokens(
      signer,
      {
        approxPercentOnEachStep,
        countSwaps,
        from: {
          token: MaticAddresses.DAI_TOKEN,
          bbt: this.bbtDAI,
          holder: this.holderDAI,
          index: this.DAI_TOKENS_INDEX
        },
        to: {
          token: MaticAddresses.USDC_TOKEN,
          bbt: this.bbtUSDC,
          index: this.USDC_TOKENS_INDEX
        }
      }
    );
  }

  public static async swapUsdtToUsdc(
    signer: SignerWithAddress,
    approxPercentOnEachStep: number,
    countSwaps: number = 1,
  ): Promise<IBalancerSwapResults> {
    return this.swapTokens(
      signer,
      {
        approxPercentOnEachStep,
        countSwaps,
        from: {
          token: MaticAddresses.USDC_TOKEN,
          bbt: this.bbtUSDC,
          index: this.USDC_TOKENS_INDEX,
          holder: this.holderUSDT,
        },
        to: {
          token: MaticAddresses.USDC_TOKEN,
          bbt: this.bbtUSDC,
          index: this.USDC_TOKENS_INDEX
        }
      }
    );
  }

  public static async swapUsdcToDai(
    signer: SignerWithAddress,
    approxPercentOnEachStep: number,
    countSwaps: number = 1,
  ): Promise<IBalancerSwapResults> {
    return this.swapTokens(
      signer,
      {
        approxPercentOnEachStep,
        countSwaps,
        from: {
          token: MaticAddresses.USDC_TOKEN,
          bbt: this.bbtUSDC,
          index: this.USDC_TOKENS_INDEX,
          holder: this.holderUSDC,
        },
        to: {
          token: MaticAddresses.DAI_TOKEN,
          bbt: this.bbtDAI,
          index: this.DAI_TOKENS_INDEX
        }
      }
    );
  }

  public static async swapUsdcToUsdt(
    signer: SignerWithAddress,
    approxPercentOnEachStep: number,
    countSwaps: number = 1,
  ): Promise<IBalancerSwapResults> {
    return this.swapTokens(
      signer,
      {
        approxPercentOnEachStep,
        countSwaps,
        from: {
          token: MaticAddresses.USDC_TOKEN,
          bbt: this.bbtUSDC,
          index: this.USDC_TOKENS_INDEX,
          holder: this.holderUSDC,
        },
        to: {
          token: MaticAddresses.USDT_TOKEN,
          bbt: this.bbtUSDT,
          index: this.USDT_TOKENS_INDEX,
        }
      }
    );
  }

    // const balancerVault = IBVault__factory.connect(this.balancerVaultAddress, signer);
    // const poolBoosted = IComposableStablePool__factory.connect(
    //   (await balancerVault.getPool(this.poolBoostedId))[0],
    //   signer,
    // );
    // const poolTokensBeforeSwap = await balancerVault.getPoolTokens(this.poolBoostedId);
    // const amountDAI = poolTokensBeforeSwap.balances[this.DAI_TOKENS_INDEX].mul(approxPercentOnEachStep).div(100);
    // console.log('amountDAI', amountDAI);
    //
    // for (let i = 0; i < countSwaps; ++i) {
    //   await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, await Misc.impersonate(this.holderDAI))
    //     .transfer(signer.address, amountDAI);
    //
    //   // dai => bbtDAI
    //   const poolBbtDai = ILinearPool__factory.connect(this.bbtDAI, signer);
    //   await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, signer).approve(balancerVault.address, amountDAI);
    //   await balancerVault.swap(
    //     {
    //       poolId: await poolBbtDai.getPoolId(),
    //       kind: 0, // GIVEN_IN
    //       assetIn: MaticAddresses.DAI_TOKEN,
    //       assetOut: this.bbtDAI,
    //       userData: '0x',
    //       amount: amountDAI,
    //     },
    //     {
    //       sender: signer.address,
    //       fromInternalBalance: false,
    //       toInternalBalance: false,
    //       recipient: signer.address,
    //     },
    //     1,
    //     Date.now() + 1000,
    //   );
    //   const balanceBbtDAI = await IERC20__factory.connect(this.bbtDAI, signer).balanceOf(signer.address);
    //
    //   // bbtDAI => bbtUSDT
    //   await IERC20__factory.connect(this.bbtDAI, signer).approve(balancerVault.address, balanceBbtDAI);
    //   await balancerVault.swap(
    //     {
    //       poolId: await poolBoosted.getPoolId(),
    //       kind: 0, // GIVEN_IN
    //       assetIn: this.bbtDAI,
    //       assetOut: this.bbtUSDT,
    //       userData: '0x',
    //       amount: balanceBbtDAI,
    //     },
    //     {
    //       sender: signer.address,
    //       fromInternalBalance: false,
    //       toInternalBalance: false,
    //       recipient: signer.address,
    //     },
    //     1,
    //     Date.now() + 1000,
    //   );
    //   const balanceBbAmUSDT = await IERC20__factory.connect(this.bbtUSDT, signer).balanceOf(signer.address);
    //
    //   // bbtUSDT => USDT
    //   const poolBbtUSDT = ILinearPool__factory.connect(this.bbtUSDT, signer);
    //   console.log('main', await poolBbtUSDT.getMainToken());
    //   console.log('wrapped', await poolBbtUSDT.getWrappedToken());
    //   await IERC20__factory.connect(this.bbtUSDT, signer).approve(balancerVault.address, balanceBbAmUSDT);
    //   await balancerVault.swap(
    //     {
    //       poolId: await poolBbtUSDT.getPoolId(),
    //       kind: 0, // GIVEN_IN
    //       assetIn: this.bbtUSDT,
    //       assetOut: MaticAddresses.USDT_TOKEN,
    //       userData: '0x',
    //       amount: balanceBbAmUSDT,
    //     },
    //     {
    //       sender: signer.address,
    //       fromInternalBalance: false,
    //       toInternalBalance: false,
    //       recipient: signer.address,
    //     },
    //     1,
    //     Date.now() + 1000,
    //   );
    //
    //   const balanceUSDT = await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(signer.address);
    //   console.log(`Balance USDT after step ${i} is ${balanceUSDT}`);
    // }
    //
    // const poolTokensAfterSwap = await balancerVault.getPoolTokens(this.poolBoostedId);
    // console.log('poolTokensBeforeSwap', poolTokensBeforeSwap);
    // console.log('poolTokensAfterSwap', poolTokensAfterSwap);
    //
    // const priceDai0 = poolTokensBeforeSwap.balances[this.DAI_TOKENS_INDEX].mul(Misc.ONE18)
    //   .div(poolTokensBeforeSwap.balances[this.USDC_TOKENS_INDEX]);
    // const priceUsdt0 = poolTokensBeforeSwap.balances[this.USDT_TOKENS_INDEX].mul(Misc.ONE18)
    //   .div(poolTokensBeforeSwap.balances[this.USDC_TOKENS_INDEX]);
    //
    // const priceDai1 = poolTokensAfterSwap.balances[this.DAI_TOKENS_INDEX].mul(Misc.ONE18)
    //   .div(poolTokensAfterSwap.balances[this.USDC_TOKENS_INDEX]);
    // const priceUsdt1 = poolTokensAfterSwap.balances[this.USDT_TOKENS_INDEX].mul(Misc.ONE18)
    //   .div(poolTokensAfterSwap.balances[this.USDC_TOKENS_INDEX]);
    //
    // console.log('Prices dai', priceDai0, priceDai1);
    // console.log('Prices usdt', priceUsdt0, priceUsdt1);
    // console.log('Prices dai ratio', priceDai0.mul(Misc.ONE18).div(priceDai1));
    // console.log('Prices usdt ratio', priceUsdt0.mul(Misc.ONE18).div(priceUsdt1));
    //
    // return {
    //   resultAmountAfterSwap: await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(signer.address),
    //   poolTokensBeforeSwap,
    //   poolTokensAfterSwap,
    //   priceRatioSourceAsset18: priceDai0.mul(Misc.ONE18).div(priceDai1),
    //   pricesRatioTargetAsset18: priceUsdt0.mul(Misc.ONE18).div(priceUsdt1),
    // };

  public static async swapTokens(signer: SignerWithAddress, p: ISwapTokensParams): Promise<IBalancerSwapResults> {
    const balancerVault = IBVault__factory.connect(this.balancerVaultAddress, signer);
    const poolBoosted = IComposableStablePool__factory.connect(
      (await balancerVault.getPool(this.poolBoostedId))[0],
      signer,
    );
    const poolTokensBeforeSwap = await balancerVault.getPoolTokens(this.poolBoostedId);
    const decimalsIn = await IERC20Metadata__factory.connect(p.from.token, signer).decimals();
    console.log('decimalsIn', decimalsIn);
    const amountIn18 = Math.round(
      +formatUnits(poolTokensBeforeSwap.balances[p.from.index].mul(p.approxPercentOnEachStep).div(100),18)
    );
    console.log('amountIn18', amountIn18);
    const amountIn = parseUnits(amountIn18.toString(), decimalsIn);
    console.log('amountIn', amountIn);
    let totalAmountIn = BigNumber.from(0);

    for (let i = 0; i < p.countSwaps; ++i) {
      const tokenAsHolder = IERC20__factory.connect(p.from.token, await Misc.impersonate(p.from.holder));
      const holderBalance = await tokenAsHolder.balanceOf(p.from.holder);
      if (holderBalance.lt(amountIn)) {
        throw Error(`Holder has only ${holderBalance.toString()}, needs ${amountIn.toString()}`)
      }
      await tokenAsHolder.transfer(signer.address, amountIn);

      // tokenIn => bbtIn
      const poolBbtIn = ILinearPool__factory.connect(p.from.bbt, signer);
      await IERC20__factory.connect(p.from.token, signer).approve(balancerVault.address, amountIn);
      await balancerVault.swap(
        {
          poolId: await poolBbtIn.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: p.from.token,
          assetOut: p.from.bbt,
          userData: '0x',
          amount: amountIn,
        },
        {
          sender: signer.address,
          fromInternalBalance: false,
          toInternalBalance: false,
          recipient: signer.address,
        },
        1,
        Date.now() + 1000,
      );
      const balanceBptIn = await IERC20__factory.connect(p.from.bbt, signer).balanceOf(signer.address);
      totalAmountIn = totalAmountIn.add(amountIn);

      // bbtIn => bbtOut
      await IERC20__factory.connect(p.from.bbt, signer).approve(balancerVault.address, balanceBptIn);
      await balancerVault.swap(
        {
          poolId: await poolBoosted.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: p.from.bbt,
          assetOut: p.to.bbt,
          userData: '0x',
          amount: balanceBptIn,
        },
        {
          sender: signer.address,
          fromInternalBalance: false,
          toInternalBalance: false,
          recipient: signer.address,
        },
        1,
        Date.now() + 1000,
      );
      const balanceBptOut = await IERC20__factory.connect(p.to.bbt, signer).balanceOf(signer.address);

      // bbtOut => tokenOut
      const poolBbtUSDT = ILinearPool__factory.connect(p.to.bbt, signer);
      console.log('main', await poolBbtUSDT.getMainToken());
      console.log('wrapped', await poolBbtUSDT.getWrappedToken());
      await IERC20__factory.connect(p.to.bbt, signer).approve(balancerVault.address, balanceBptOut);
      await balancerVault.swap(
        {
          poolId: await poolBbtUSDT.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: p.to.bbt,
          assetOut: p.to.token,
          userData: '0x',
          amount: balanceBptOut,
        },
        {
          sender: signer.address,
          fromInternalBalance: false,
          toInternalBalance: false,
          recipient: signer.address,
        },
        1,
        Date.now() + 1000,
      );

      const balanceOut = await IERC20__factory.connect(p.to.token, signer).balanceOf(signer.address);
      console.log(`Balance USDT after step ${i} is ${balanceOut}`);
    }

    const poolTokensAfterSwap = await balancerVault.getPoolTokens(this.poolBoostedId);
    console.log('poolTokensBeforeSwap', poolTokensBeforeSwap);
    console.log('poolTokensAfterSwap', poolTokensAfterSwap);

    const priceIn0 = poolTokensBeforeSwap.balances[p.from.index].mul(Misc.ONE18)
      .div(poolTokensBeforeSwap.balances[this.USDC_TOKENS_INDEX]);
    const priceOut0 = poolTokensBeforeSwap.balances[p.to.index].mul(Misc.ONE18)
      .div(poolTokensBeforeSwap.balances[this.USDC_TOKENS_INDEX]);

    const priceIn1 = poolTokensAfterSwap.balances[p.from.index].mul(Misc.ONE18)
      .div(poolTokensAfterSwap.balances[this.USDC_TOKENS_INDEX]);
    const priceOut1 = poolTokensAfterSwap.balances[p.to.index].mul(Misc.ONE18)
      .div(poolTokensAfterSwap.balances[this.USDC_TOKENS_INDEX]);

    console.log('Prices in', priceIn0, priceIn1);
    console.log('Prices out', priceOut0, priceOut1);
    console.log('Prices in ratio', priceIn0.mul(Misc.ONE18).div(priceIn1));
    console.log('Prices out ratio', priceOut0.mul(Misc.ONE18).div(priceOut1));

    return {
      resultAmountAfterSwap: await IERC20__factory.connect(p.to.token, signer).balanceOf(signer.address),
      poolTokensBeforeSwap,
      poolTokensAfterSwap,
      priceRatioSourceAsset18: priceIn0.mul(Misc.ONE18).div(priceIn1),
      pricesRatioTargetAsset18: priceOut0.mul(Misc.ONE18).div(priceOut1),
      totalAmountIn
    };
  }

}
