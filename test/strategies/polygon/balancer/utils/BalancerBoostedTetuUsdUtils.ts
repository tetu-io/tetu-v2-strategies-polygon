import { MaticHolders } from '../../../../../scripts/addresses/MaticHolders';
import { BigNumber } from 'ethers';
import {
  IBVault__factory, IComposableStablePool__factory,
  IERC20__factory, ILinearPool__factory,
} from '../../../../../typechain';
import { MaticAddresses } from '../../../../../scripts/addresses/MaticAddresses';
import { Misc } from '../../../../../scripts/utils/Misc';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

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
    const balancerVault = IBVault__factory.connect(this.balancerVaultAddress, signer);
    const poolBoosted = IComposableStablePool__factory.connect(
      (await balancerVault.getPool(this.poolBoostedId))[0],
      signer,
    );
    const poolTokensBeforeSwap = await balancerVault.getPoolTokens(this.poolBoostedId);
    const amountDAI = poolTokensBeforeSwap.balances[this.DAI_TOKENS_INDEX].mul(approxPercentOnEachStep).div(100);
    console.log('amountDAI', amountDAI);

    for (let i = 0; i < countSwaps; ++i) {
      await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, await Misc.impersonate(this.holderDAI))
        .transfer(signer.address, amountDAI);

      // dai => bbtDAI
      const poolBbtDai = ILinearPool__factory.connect(this.bbtDAI, signer);
      await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, signer).approve(balancerVault.address, amountDAI);
      await balancerVault.swap(
        {
          poolId: await poolBbtDai.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: MaticAddresses.DAI_TOKEN,
          assetOut: this.bbtDAI,
          userData: '0x',
          amount: amountDAI,
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
      const balanceBbtDAI = await IERC20__factory.connect(this.bbtDAI, signer).balanceOf(signer.address);

      // bbtDAI => bbtUSDT
      await IERC20__factory.connect(this.bbtDAI, signer).approve(balancerVault.address, balanceBbtDAI);
      await balancerVault.swap(
        {
          poolId: await poolBoosted.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: this.bbtDAI,
          assetOut: this.bbtUSDT,
          userData: '0x',
          amount: balanceBbtDAI,
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
      const balanceBbAmUSDT = await IERC20__factory.connect(this.bbtUSDT, signer).balanceOf(signer.address);

      // bbtUSDT => USDT
      const poolBbtUSDT = ILinearPool__factory.connect(this.bbtUSDT, signer);
      console.log('main', await poolBbtUSDT.getMainToken());
      console.log('wrapped', await poolBbtUSDT.getWrappedToken());
      await IERC20__factory.connect(this.bbtUSDT, signer).approve(balancerVault.address, balanceBbAmUSDT);
      await balancerVault.swap(
        {
          poolId: await poolBbtUSDT.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: this.bbtUSDT,
          assetOut: MaticAddresses.USDT_TOKEN,
          userData: '0x',
          amount: balanceBbAmUSDT,
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

      const balanceUSDT = await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(signer.address);
      console.log(`Balance USDT after step ${i} is ${balanceUSDT}`);
    }

    const poolTokensAfterSwap = await balancerVault.getPoolTokens(this.poolBoostedId);
    console.log('poolTokensBeforeSwap', poolTokensBeforeSwap);
    console.log('poolTokensAfterSwap', poolTokensAfterSwap);

    const priceDai0 = poolTokensBeforeSwap.balances[this.DAI_TOKENS_INDEX].mul(Misc.ONE18)
      .div(poolTokensBeforeSwap.balances[this.USDC_TOKENS_INDEX]);
    const priceUsdt0 = poolTokensBeforeSwap.balances[this.USDT_TOKENS_INDEX].mul(Misc.ONE18)
      .div(poolTokensBeforeSwap.balances[this.USDC_TOKENS_INDEX]);

    const priceDai1 = poolTokensAfterSwap.balances[this.DAI_TOKENS_INDEX].mul(Misc.ONE18)
      .div(poolTokensAfterSwap.balances[this.USDC_TOKENS_INDEX]);
    const priceUsdt1 = poolTokensAfterSwap.balances[this.USDT_TOKENS_INDEX].mul(Misc.ONE18)
      .div(poolTokensAfterSwap.balances[this.USDC_TOKENS_INDEX]);

    console.log('Prices dai', priceDai0, priceDai1);
    console.log('Prices usdt', priceUsdt0, priceUsdt1);
    console.log('Prices dai ratio', priceDai0.mul(Misc.ONE18).div(priceDai1));
    console.log('Prices usdt ratio', priceUsdt0.mul(Misc.ONE18).div(priceUsdt1));

    return {
      resultAmountAfterSwap: await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(signer.address),
      poolTokensBeforeSwap,
      poolTokensAfterSwap,
      priceRatioSourceAsset18: priceDai0.mul(Misc.ONE18).div(priceDai1),
      pricesRatioTargetAsset18: priceUsdt0.mul(Misc.ONE18).div(priceUsdt1),
    };
  }
}
