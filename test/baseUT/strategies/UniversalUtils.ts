import {BigNumber, ContractReceipt, ethers} from "ethers";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IERC20Metadata__factory,
  ISwapper__factory,
} from "../../../typechain";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {IDefaultState} from "../utils/PackedData";

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
    state: IDefaultState,
    swapperAddress: string,
    amountA: BigNumber,
  ) {
    console.log("makePoolVolume.state", state);
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
    const swapAmount = amountA.div(2);
    let price;
    let priceBefore;
    const signerBalanceOfTokenA = await TokenUtils.balanceOf(state.tokenA, signer.address);
    const signerBalanceOfTokenB = await TokenUtils.balanceOf(state.tokenB, signer.address);
    if (signerBalanceOfTokenA.lt(swapAmount)) {
      await TokenUtils.getToken(state.tokenA, signer.address, amountA);
    }

    console.log('Making pool volume...');
    priceBefore = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
    console.log('tokenB price', formatUnits(priceBefore, 6));
    console.log('swap in pool tokenA to tokenB...');
    await TokenUtils.transfer(state.tokenA, signer, swapper.address, swapAmount.toString());
    await swapper.connect(signer).swap(state.pool, state.tokenA, state.tokenB, signer.address, 10000, {gasLimit: 10_000_000}); // 10% slippage
    price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
    console.log('tokenB new price', formatUnits(price, 6));
    console.log('Price change', formatUnits(price.sub(priceBefore).mul(1e13).div(priceBefore).div(1e8), 3) + '%');
    priceBefore = price;
    const gotTokenBAmount = (await TokenUtils.balanceOf(state.tokenB, signer.address)).sub(signerBalanceOfTokenB);
    // console.log('gotTokenBAmount', gotTokenBAmount)
    console.log('swap in pool tokenB to tokenA...');
    console.log('Swap amount of tokenB:', gotTokenBAmount.toString());
    await TokenUtils.transfer(state.tokenB, signer, swapper.address, gotTokenBAmount.toString());
    await swapper.connect(signer).swap(state.pool, state.tokenB, state.tokenA, signer.address, 10000, {gasLimit: 10_000_000}); // 10% slippage
    price = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
    console.log('tokenB new price', formatUnits(price, 6));
    console.log(`TokenB price change: -${formatUnits(priceBefore.sub(price).mul(1e13).div(priceBefore).div(1e8), 3)}%`);
  }

  public static async movePoolPriceUp(
    signer: SignerWithAddress,
    state: IDefaultState,
    swapperAddress: string,
    amountA: BigNumber,
    priceImpactTolerance = 99000 // 99% slippage
  ) {
    console.log("movePoolPriceUp.amountA", amountA, state);
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
    const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, signer).decimals()
    const tokenAName = await TokenUtils.tokenSymbol(state.tokenA);
    const tokenBName = await TokenUtils.tokenSymbol(state.tokenB);
    const swapAmount = amountA;
    let priceA;
    let priceB;
    let priceABefore;
    let priceBBefore;
    const signerBalanceOfTokenA = await TokenUtils.balanceOf(state.tokenA, signer.address);
    if (signerBalanceOfTokenA.lt(swapAmount)) {
      await TokenUtils.getToken(state.tokenA, signer.address, amountA);
    }

    console.log('Moving price up...');
    priceABefore = await swapper.getPrice(state.pool, state.tokenA, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
    priceBBefore = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
    console.log('swap in pool tokenA to tokenB...', tokenAName, '->', tokenBName);
    await TokenUtils.transfer(state.tokenA, signer, swapper.address, swapAmount.toString());
    console.log("now call swap");
    await swapper.connect(signer).swap(state.pool, state.tokenA, state.tokenB, signer.address, priceImpactTolerance, {gasLimit: 19_000_000});
    priceA = await swapper.getPrice(state.pool, state.tokenA, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
    priceB = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
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
    state: IDefaultState,
    swapperAddress: string,
    amountB: BigNumber,
    priceImpactTolerance = 40000, // 40%,
    silent = false
  ) {
    console.log("movePoolPriceDown.amountB", amountB, state);
    const swapper = ISwapper__factory.connect(swapperAddress, signer);
    const tokenADecimals = await IERC20Metadata__factory.connect(state.tokenA, signer).decimals()
    const tokenAName = await TokenUtils.tokenSymbol(state.tokenA);
    const tokenBName = await TokenUtils.tokenSymbol(state.tokenB);
    const swapAmount = amountB;
    let priceA;
    let priceB;
    let priceABefore;
    let priceBBefore;
    const signerBalanceOfTokenB = await TokenUtils.balanceOf(state.tokenB, signer.address);
    if (signerBalanceOfTokenB.lt(swapAmount)) {
      await TokenUtils.getToken(state.tokenB, signer.address, amountB, silent);
    }

    if (!silent) {
      console.log('Moving price down...');
    }
    priceABefore = await swapper.getPrice(state.pool, state.tokenA, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
    priceBBefore = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
    if (!silent) {
      console.log(tokenBName, '(tokenB) price', formatUnits(priceBBefore, tokenADecimals));
      console.log('swap in pool tokenB to tokenA...', tokenBName, '->', tokenAName);
    }
    await TokenUtils.transfer(state.tokenB, signer, swapper.address, swapAmount.toString(), silent);
    await swapper.connect(signer).swap(state.pool, state.tokenB, state.tokenA, signer.address, priceImpactTolerance, {gasLimit: 19_000_000,});
    priceA = await swapper.getPrice(state.pool, state.tokenA, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
    priceB = await swapper.getPrice(state.pool, state.tokenB, MaticAddresses.ZERO_ADDRESS, 0, {gasLimit: 19_000_000});
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