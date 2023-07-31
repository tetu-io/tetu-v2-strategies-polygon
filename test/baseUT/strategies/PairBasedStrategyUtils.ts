import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {BigNumber} from 'ethers';
import {IERC20Metadata__factory, IPairBasedDefaultStateProvider, IPairBasedDefaultStateProvider__factory, ISwapper__factory,} from '../../../typechain';
import { TokenUtils } from '../../../scripts/utils/TokenUtils';
import { MaticAddresses } from '../../../scripts/addresses/MaticAddresses';
import { formatUnits } from 'ethers/lib/utils';
import {PackedData} from "../utils/PackedData";


export class PairBasedStrategyUtils {
  public static async movePriceUp(
    signer: SignerWithAddress,
    strategyAddress: string,
    swapperAddress: string,
    amount: BigNumber,
    priceImpactTolerance = 99000 // 99% slippage
  ) {
    const strategy = IPairBasedDefaultStateProvider__factory.connect(strategyAddress, signer) as IPairBasedDefaultStateProvider;
    const state = await PackedData.getDefaultState(strategy);
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
    const tokenA = state.tokenA;
    const tokenB = state.tokenB;
    const tokenADecimals = await IERC20Metadata__factory.connect(tokenA, signer).decimals()
    const tokenAName = await TokenUtils.tokenSymbol(tokenA);
    const tokenBName = await TokenUtils.tokenSymbol(tokenB);
    const swapAmount = amount;
    let priceA;
    let priceB;
    let priceABefore;
    let priceBBefore;
    const signerBalanceOfTokenA = await TokenUtils.balanceOf(tokenA, signer.address);
    if (signerBalanceOfTokenA.lt(swapAmount)) {
      await TokenUtils.getToken(tokenA, signer.address, amount);
    }

    console.log('Moving price up...');
    priceABefore = await swapper.getPrice(state.pool, tokenA, MaticAddresses.ZERO_ADDRESS, 0);
    priceBBefore = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log(tokenBName, '(tokenB) price', formatUnits(priceBBefore, tokenADecimals));
    console.log('swap in pool tokenA to tokenB...', tokenAName, '->', tokenBName);
    await TokenUtils.transfer(tokenA, signer, swapper.address, swapAmount.toString());
    await swapper.connect(signer).swap(state.pool, tokenA, tokenB, signer.address, priceImpactTolerance);
    priceA = await swapper.getPrice(state.pool, tokenA, MaticAddresses.ZERO_ADDRESS, 0);
    priceB = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log(tokenBName, '(tokenB) new price', formatUnits(priceB, tokenADecimals));
    if (priceBBefore.gt(0)) {
      console.log('Price change', formatUnits(priceB.sub(priceBBefore).mul(1e13).div(priceBBefore).div(1e8), 3) + '%');
    }

    return {
      priceAChange: priceABefore.gt(0) ? priceA.sub(priceABefore).mul(1e9).mul(1e9).div(priceABefore) : BigNumber.from(0),
      priceBChange: priceBBefore.gt(0) ? priceB.sub(priceBBefore).mul(1e9).mul(1e9).div(priceBBefore) : BigNumber.from(0),
    };
  }

  public static async movePriceDown(
    signer: SignerWithAddress,
    strategyAddress: string,
    swapperAddress: string,
    amount: BigNumber,
    priceImpactTolerance = 40000 // 40%
  ) {
    const strategy = IPairBasedDefaultStateProvider__factory.connect(strategyAddress, signer) as IPairBasedDefaultStateProvider;
    const state = await PackedData.getDefaultState(strategy);
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
    const tokenA = state.tokenA;
    const tokenB = state.tokenB;
    const tokenADecimals = await IERC20Metadata__factory.connect(tokenA, signer).decimals()
    const tokenAName = await TokenUtils.tokenSymbol(tokenA);
    const tokenBName = await TokenUtils.tokenSymbol(tokenB);
    const swapAmount = amount;
    let priceA;
    let priceB;
    let priceABefore;
    let priceBBefore;
    const signerBalanceOfTokenB = await TokenUtils.balanceOf(tokenB, signer.address);
    if (signerBalanceOfTokenB.lt(swapAmount)) {
      await TokenUtils.getToken(tokenB, signer.address, amount);
    }

    console.log('Moving price down...');
    priceABefore = await swapper.getPrice(state.pool, tokenA, MaticAddresses.ZERO_ADDRESS, 0);
    priceBBefore = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log(tokenBName, '(tokenB) price', formatUnits(priceBBefore, tokenADecimals));
    console.log('swap in pool tokenB to tokenA...', tokenBName, '->', tokenAName);
    await TokenUtils.transfer(tokenB, signer, swapper.address, swapAmount.toString());
    await swapper.connect(signer).swap(state.pool, tokenB, tokenA, signer.address, priceImpactTolerance);
    priceA = await swapper.getPrice(state.pool, tokenA, MaticAddresses.ZERO_ADDRESS, 0);
    priceB = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log(tokenBName, '(tokenB) new price', formatUnits(priceB, tokenADecimals));
    console.log('Price change', '-' + formatUnits(priceA.sub(priceABefore).mul(1e13).div(priceABefore).div(1e8), 3) + '%');

    return {
      priceAChange: priceA.sub(priceABefore).mul(1e9).mul(1e9).div(priceABefore),
      priceBChange: priceB.sub(priceBBefore).mul(1e9).mul(1e9).div(priceBBefore),
    };
  }
}
