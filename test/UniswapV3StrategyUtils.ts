import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {ISwapper__factory, UniswapV3ConverterStrategy, UniswapV3ConverterStrategy__factory} from "../typechain";
import {TokenUtils} from "../scripts/utils/TokenUtils";
import {MaticAddresses} from "../scripts/addresses/MaticAddresses";
import {formatUnits} from "ethers/lib/utils";


export class UniswapV3StrategyUtils {
  public static async movePriceUp(signer: SignerWithAddress, strategyAddress: string, swapperAddress: string, amount: BigNumber) {
    const strategy = UniswapV3ConverterStrategy__factory.connect(strategyAddress, signer) as UniswapV3ConverterStrategy;
    const state = await strategy.getState();
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
    const tokenA = state.tokenA;
    const tokenB = state.tokenB;
    const swapAmount = amount;
    let price;
    let priceBefore;
    const signerBalanceOfTokenA = await TokenUtils.balanceOf(tokenA, signer.address);
    if (signerBalanceOfTokenA.lt(swapAmount)) {
      await TokenUtils.getToken(tokenA, signer.address, amount);
    }

    console.log('Moving price up...');
    priceBefore = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log('tokenB price', formatUnits(priceBefore, 6));
    console.log('swap in pool tokenA to tokenB...');
    await TokenUtils.transfer(tokenA, signer, swapper.address, swapAmount.toString());
    await swapper.connect(signer).swap(state.pool, tokenA, tokenB, signer.address, 90000); // 90% slippage
    price = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log('tokenB new price', formatUnits(price, 6));
    console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%');
  }

  public static async movePriceDown(signer: SignerWithAddress, strategyAddress: string, swapperAddress: string, amount: BigNumber) {
    const strategy = UniswapV3ConverterStrategy__factory.connect(strategyAddress, signer) as UniswapV3ConverterStrategy;
    const state = await strategy.getState();
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
    const tokenA = state.tokenA;
    const tokenB = state.tokenB;
    const swapAmount = amount;
    let price;
    let priceBefore;
    const signerBalanceOfTokenB = await TokenUtils.balanceOf(tokenB, signer.address);
    if (signerBalanceOfTokenB.lt(swapAmount)) {
      await TokenUtils.getToken(tokenB, signer.address, amount);
    }

    console.log('Moving price down...');
    priceBefore = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log('tokenB price', formatUnits(priceBefore, 6));
    console.log('swap in pool tokenB to tokenA...');
    await TokenUtils.transfer(tokenB, signer, swapper.address, swapAmount.toString());
    await swapper.connect(signer).swap(state.pool, tokenB, tokenA, signer.address, 40000); // 40% slippage
    price = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log('tokenB new price', formatUnits(price, 6));
    console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%');
  }

  public static async makeVolume(signer: SignerWithAddress, strategyAddress: string, swapperAddress: string, amount: BigNumber) {
    const strategy = UniswapV3ConverterStrategy__factory.connect(strategyAddress, signer) as UniswapV3ConverterStrategy;
    const state = await strategy.getState();
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
    const tokenA = state.tokenA;
    const tokenB = state.tokenB;
    const swapAmount = amount.div(2);
    let price;
    let priceBefore;
    const signerBalanceOfTokenA = await TokenUtils.balanceOf(tokenA, signer.address);
    const signerBalanceOfTokenB = await TokenUtils.balanceOf(tokenB, signer.address);
    if (signerBalanceOfTokenA.lt(swapAmount)) {
      await TokenUtils.getToken(tokenA, signer.address, amount);
    }

    console.log('Making pool volume...');
    priceBefore = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log('tokenB price', formatUnits(priceBefore, 6));
    console.log('swap in pool tokenA to tokenB...');
    await TokenUtils.transfer(tokenA, signer, swapper.address, swapAmount.toString());
    await swapper.connect(signer).swap(state.pool, tokenA, tokenB, signer.address, 10000); // 10% slippage
    price = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log('tokenB new price', formatUnits(price, 6));
    console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%');
    priceBefore = price;
    const gotTokenBAmount = (await TokenUtils.balanceOf(tokenB, signer.address)).sub(signerBalanceOfTokenB);
    // console.log('gotTokenBAmount', gotTokenBAmount)
    console.log('swap in pool tokenB to tokenA...');
    console.log('Swap amount of tokenB:', formatUnits(gotTokenBAmount, 18));
    await TokenUtils.transfer(tokenB, signer, swapper.address, gotTokenBAmount.toString());
    await swapper.connect(signer).swap(state.pool, tokenB, tokenA, signer.address, 10000); // 10% slippage
    price = await swapper.getPrice(state.pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log('tokenB new price', formatUnits(price, 6));
    console.log(`TokenB price change: -${formatUnits(priceBefore.sub(price).mul(1e13).div(priceBefore).div(1e8), 3)}%`);
  }
}