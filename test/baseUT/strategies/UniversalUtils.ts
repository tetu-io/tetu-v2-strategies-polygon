import {BigNumber, ContractReceipt, ethers} from "ethers";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IERC20Metadata__factory,
  ISwapper__factory,
} from "../../../typechain";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

export class UniversalUtils {
  /**
   * Finds events "EventName(fee0, fee1)" in {tx}
   */
  public static extractClaimedFees(cr: ContractReceipt, eventName: string, eventAbi: string): [BigNumber, BigNumber] | undefined {
    const abi = [
      eventAbi,
    ];
    const iface = new ethers.utils.Interface(abi)
    const topic = iface.getEventTopic(iface.getEvent(eventName))
    let fee0 = BigNumber.from(0)
    let fee1 = BigNumber.from(0)
    if (cr.events) {
      for (const event of cr.events) {
        if (event.topics.includes(topic)) {
          const decoded = ethers.utils.defaultAbiCoder.decode(
            ['uint', 'uint'],
            event.data
          )
          fee0 = fee0.add(decoded[0])
          fee1 = fee1.add(decoded[1])
        }
      }
    }

    return [fee0, fee1];
  }

  public static getApr(earned: BigNumber, investAmount: BigNumber, startTimestamp: number, endTimestamp: number) {
    const earnedPerSec1e10 = endTimestamp > startTimestamp ? earned.mul(parseUnits('1', 10)).div(endTimestamp - startTimestamp) : BigNumber.from(0);
    const earnedPerDay = earnedPerSec1e10.mul(86400).div(parseUnits('1', 10));
    const apr = earnedPerDay.mul(365).mul(100000000).div(investAmount).div(1000);
    return +formatUnits(apr, 3)
  }

  public static async makePoolVolume(
    signer: SignerWithAddress,
    pool: string,
    tokenA: string,
    tokenB: string,
    swapperAddress: string,
    amount: BigNumber,
  ) {
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
    const swapAmount = amount.div(2);
    let price;
    let priceBefore;
    const signerBalanceOfTokenA = await TokenUtils.balanceOf(tokenA, signer.address);
    const signerBalanceOfTokenB = await TokenUtils.balanceOf(tokenB, signer.address);
    if (signerBalanceOfTokenA.lt(swapAmount)) {
      await TokenUtils.getToken(tokenA, signer.address, amount);
    }

    console.log('Making pool volume...');
    priceBefore = await swapper.getPrice(pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log('tokenB price', formatUnits(priceBefore, 6));
    console.log('swap in pool tokenA to tokenB...');
    await TokenUtils.transfer(tokenA, signer, swapper.address, swapAmount.toString());
    await swapper.connect(signer).swap(pool, tokenA, tokenB, signer.address, 10000, {gasLimit: 10_000_000}); // 10% slippage
    price = await swapper.getPrice(pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log('tokenB new price', formatUnits(price, 6));
    console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%');
    priceBefore = price;
    const gotTokenBAmount = (await TokenUtils.balanceOf(tokenB, signer.address)).sub(signerBalanceOfTokenB);
    // console.log('gotTokenBAmount', gotTokenBAmount)
    console.log('swap in pool tokenB to tokenA...');
    console.log('Swap amount of tokenB:', gotTokenBAmount.toString());
    await TokenUtils.transfer(tokenB, signer, swapper.address, gotTokenBAmount.toString());
    await swapper.connect(signer).swap(pool, tokenB, tokenA, signer.address, 10000, {gasLimit: 10_000_000}); // 10% slippage
    price = await swapper.getPrice(pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log('tokenB new price', formatUnits(price, 6));
    console.log(`TokenB price change: -${formatUnits(priceBefore.sub(price).mul(1e13).div(priceBefore).div(1e8), 3)}%`);
  }

  public static async movePoolPriceUp(
    signer: SignerWithAddress,
    pool: string,
    tokenA: string,
    tokenB: string,
    swapperAddress: string,
    amount: BigNumber,
    priceImpactTolerance = 99000 // 99% slippage
  ) {
    console.log("movePoolPriceUp", amount);
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
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
    priceABefore = await swapper.getPrice(pool, tokenA, MaticAddresses.ZERO_ADDRESS, 0);
    priceBBefore = await swapper.getPrice(pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log(tokenBName, '(tokenB) price', formatUnits(priceBBefore, tokenADecimals));
    console.log('swap in pool tokenA to tokenB...', tokenAName, '->', tokenBName);
    await TokenUtils.transfer(tokenA, signer, swapper.address, swapAmount.toString());
    await swapper.connect(signer).swap(pool, tokenA, tokenB, signer.address, priceImpactTolerance);
    priceA = await swapper.getPrice(pool, tokenA, MaticAddresses.ZERO_ADDRESS, 0);
    priceB = await swapper.getPrice(pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    console.log(tokenBName, '(tokenB) new price', formatUnits(priceB, tokenADecimals));
    if (priceBBefore.gt(0)) {
      console.log('Price change', formatUnits(priceB.sub(priceBBefore).mul(1e13).div(priceBBefore).div(1e8), 3) + '%');
    }

    return {
      priceAChange: priceABefore.gt(0) ? priceA.sub(priceABefore).mul(1e9).mul(1e9).div(priceABefore) : BigNumber.from(0),
      priceBChange: priceBBefore.gt(0) ? priceB.sub(priceBBefore).mul(1e9).mul(1e9).div(priceBBefore) : BigNumber.from(0),
    };
  }

  public static async movePoolPriceDown(
    signer: SignerWithAddress,
    pool: string,
    tokenA: string,
    tokenB: string,
    swapperAddress: string,
    amount: BigNumber,
    priceImpactTolerance = 40000, // 40%,
    silent = false
  ) {
    console.log("movePoolPriceDown", amount);
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
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
      await TokenUtils.getToken(tokenB, signer.address, amount, silent);
    }

    if (!silent) {
      console.log('Moving price down...');
    }
    priceABefore = await swapper.getPrice(pool, tokenA, MaticAddresses.ZERO_ADDRESS, 0);
    priceBBefore = await swapper.getPrice(pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    if (!silent) {
      console.log(tokenBName, '(tokenB) price', formatUnits(priceBBefore, tokenADecimals));
      console.log('swap in pool tokenB to tokenA...', tokenBName, '->', tokenAName);
    }
    await TokenUtils.transfer(tokenB, signer, swapper.address, swapAmount.toString(), silent);
    await swapper.connect(signer).swap(pool, tokenB, tokenA, signer.address, priceImpactTolerance, {gasLimit: 19_000_000,});
    priceA = await swapper.getPrice(pool, tokenA, MaticAddresses.ZERO_ADDRESS, 0);
    priceB = await swapper.getPrice(pool, tokenB, MaticAddresses.ZERO_ADDRESS, 0);
    if (!silent) {
      console.log(tokenBName, '(tokenB) new price', formatUnits(priceB, tokenADecimals));
      console.log('Price change', '-' + formatUnits(priceA.sub(priceABefore).mul(1e13).div(priceABefore).div(1e8), 3) + '%');
    }
    return {
      priceAChange: priceA.sub(priceABefore).mul(1e9).mul(1e9).div(priceABefore),
      priceBChange: priceB.sub(priceBBefore).mul(1e9).mul(1e9).div(priceBBefore),
    };
  }
}