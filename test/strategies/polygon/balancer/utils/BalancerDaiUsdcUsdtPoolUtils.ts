import {MaticHolders} from "../../../../../scripts/MaticHolders";
import {BigNumber} from "ethers";
import {
  IBalancerBoostedAavePool__factory,
  IBalancerBoostedAaveStablePool__factory,
  IBVault__factory,
  IERC20__factory
} from "../../../../../typechain";
import {MaticAddresses} from "../../../../../scripts/MaticAddresses";
import {Misc} from "../../../../../scripts/utils/Misc";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

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
 * Change prices in Balancer Boosted Aave USD pool by swapping big amounts
 */
export class BalancerDaiUsdcUsdtPoolUtils {
  public static readonly balancerVaultAddress = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  // Balancer Boosted Aave USD pool ID
  public static readonly poolBoostedId = "0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b";

  public static readonly amDAI = "0xEE029120c72b0607344f35B17cdD90025e647B00";
  public static readonly amUSDC = "0x221836a597948Dce8F3568E044fF123108aCc42A";
  public static readonly amUSDT = "0x19C60a251e525fa88Cd6f3768416a8024e98fC19";

  public static readonly bbAmDAI = "0x178E029173417b1F9C8bC16DCeC6f697bC323746";
  public static readonly bbAmUSDC = "0xF93579002DBE8046c43FEfE86ec78b1112247BB8";
  public static readonly bbAmUSDT = "0xFf4ce5AAAb5a627bf82f4A571AB1cE94Aa365eA6";
  public static readonly bbAmUSD = "0x48e6B98ef6329f8f0A30eBB8c7C960330d648085";

  public static readonly holderDAI = MaticHolders.HOLDER_DAI;
  public static readonly holderUSDC = MaticHolders.HOLDER_USDC;
  public static readonly holderUSDT = MaticHolders.HOLDER_USDT;

  // index of DAI in balancerVault.getPoolTokens()=>tokens
  public static readonly DAI_TOKENS_INDEX = 0;
  public static readonly USDC_TOKENS_INDEX = 2;
  public static readonly USDT_TOKENS_INDEX = 3;

  public static async swapDaiToUsdt(
    signer: SignerWithAddress,
    approxPercentOnEachStep: number,
    countSwaps: number = 1
  ) : Promise<IBalancerSwapResults> {
    const balancerVault = IBVault__factory.connect(this.balancerVaultAddress, signer);
    const poolBoosted = IBalancerBoostedAaveStablePool__factory.connect((await balancerVault.getPool(this.poolBoostedId))[0], signer);
    const poolTokensBeforeSwap = await balancerVault.getPoolTokens(this.poolBoostedId);
    const amountDAI = poolTokensBeforeSwap.balances[this.DAI_TOKENS_INDEX].mul(approxPercentOnEachStep).div(100);
    console.log("amountDAI", amountDAI);

    for (let i = 0; i < countSwaps; ++i) {
      await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, await Misc.impersonate(this.holderDAI)).transfer(signer.address, amountDAI);

      // dai => bbAmDAI
      const poolAmDai = IBalancerBoostedAavePool__factory.connect(poolTokensBeforeSwap.tokens[0], signer);
      await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, signer).approve(balancerVault.address, amountDAI);
      await balancerVault.swap(
        {
          poolId: await poolAmDai.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: MaticAddresses.DAI_TOKEN,
          assetOut: this.bbAmDAI,
          userData: '0x',
          amount: amountDAI
        },
        {
          sender: signer.address,
          fromInternalBalance: false,
          toInternalBalance: false,
          recipient: signer.address
        },
        1,
        Date.now() + 1000
      );
      const balanceBbAmDAI = await IERC20__factory.connect(this.bbAmDAI, signer).balanceOf(signer.address);

      // bbAmDAI => bbAmUSDT
      await IERC20__factory.connect(this.bbAmDAI, signer).approve(balancerVault.address, balanceBbAmDAI);
      await balancerVault.swap(
        {
          poolId: await poolBoosted.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: this.bbAmDAI,
          assetOut: this.bbAmUSDT,
          userData: '0x',
          amount: balanceBbAmDAI
        },
        {
          sender: signer.address,
          fromInternalBalance: false,
          toInternalBalance: false,
          recipient: signer.address
        },
        1,
        Date.now() + 1000
      );
      const balanceBbAmUSDT = await IERC20__factory.connect(this.bbAmUSDT, signer).balanceOf(signer.address);

      // bbAmUSDT => USDT
      const poolAmUSDT = IBalancerBoostedAavePool__factory.connect(poolTokensBeforeSwap.tokens[3], signer);
      console.log("main", await poolAmUSDT.getMainToken());
      console.log("wrapped", await poolAmUSDT.getWrappedToken());
      await IERC20__factory.connect(this.bbAmUSDT, signer).approve(balancerVault.address, balanceBbAmUSDT);
      await balancerVault.swap(
        {
          poolId: await poolAmUSDT.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: this.bbAmUSDT,
          assetOut: MaticAddresses.USDT_TOKEN,
          userData: '0x',
          amount: balanceBbAmUSDT
        },
        {
          sender: signer.address,
          fromInternalBalance: false,
          toInternalBalance: false,
          recipient: signer.address
        },
        1,
        Date.now() + 1000
      );

      const balanceUSDT = await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(signer.address);
      console.log(`Balance USDT after step ${i} is ${balanceUSDT}`);
    }

    const poolTokensAfterSwap = await balancerVault.getPoolTokens(this.poolBoostedId);
    console.log("poolTokensBeforeSwap", poolTokensBeforeSwap);
    console.log("poolTokensAfterSwap", poolTokensAfterSwap);

    const priceDai0 = poolTokensBeforeSwap.balances[this.DAI_TOKENS_INDEX].mul(Misc.ONE18)
      .div(poolTokensBeforeSwap.balances[this.USDC_TOKENS_INDEX]);
    const priceUsdt0 = poolTokensBeforeSwap.balances[this.USDT_TOKENS_INDEX].mul(Misc.ONE18)
      .div(poolTokensBeforeSwap.balances[this.USDC_TOKENS_INDEX]);

    const priceDai1 = poolTokensAfterSwap.balances[this.DAI_TOKENS_INDEX].mul(Misc.ONE18)
      .div(poolTokensAfterSwap.balances[this.USDC_TOKENS_INDEX]);
    const priceUsdt1 = poolTokensAfterSwap.balances[this.USDT_TOKENS_INDEX].mul(Misc.ONE18)
      .div(poolTokensAfterSwap.balances[this.USDC_TOKENS_INDEX]);

    console.log("Prices dai", priceDai0, priceDai1);
    console.log("Prices usdt", priceUsdt0, priceUsdt1);
    console.log("Prices dai ratio", priceDai0.mul(Misc.ONE18).div(priceDai1));
    console.log("Prices usdt ratio", priceUsdt0.mul(Misc.ONE18).div(priceUsdt1));

    return {
      resultAmountAfterSwap: await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(signer.address),
      poolTokensBeforeSwap,
      poolTokensAfterSwap,
      priceRatioSourceAsset18: priceDai0.mul(Misc.ONE18).div(priceDai1),
      pricesRatioTargetAsset18: priceUsdt0.mul(Misc.ONE18).div(priceUsdt1)
    };
  }
}