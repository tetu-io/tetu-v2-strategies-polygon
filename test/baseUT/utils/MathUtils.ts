/// @param accuracy 10 for 1e-10
import { BigNumber } from 'ethers';
import { formatUnits, parseUnits } from 'ethers/lib/utils';

/**
 * true if b1 < b2 less than on given number of percents, i.e. 1%
 */
export function differenceInPercentsLessThan(b1: BigNumber, b2: BigNumber, percents100: number = 1): boolean {
  if (b1.eq(0)) {
    return b2.eq(0);
  }
  const a = +formatUnits(b1.sub(b2).mul(100).mul(1e3).div(b1).abs(), 3);
  console.log('differenceInPercentsLessThan', a, percents100);
  return a <= percents100;
}

/**
 * true if b1 < b2 less than on given number of percents, i.e. 1%
 */
export function differenceInPercentsNumLessThan(b1: number, b2: number, percents100: number = 1): boolean {
  if (b1 === 0) {
    return b2 === 0;
  }
  const a = Math.abs((b1 - b2) * 100 / b1);
  console.log('differenceInPercentsNumLessThan', a, percents100);
  return a <= percents100;
}

/**
 * If an asset has decimals i.e. 6
 * and we need to convert amount "0.123456789" to the asset amount
 * we will have overflow/underflow error.
 *
 * Trim decimals to the correct value to avoid error "fractional component exceeds decimals"
 * @param n
 * @param decimals
 */
export function trimDecimals(n: string, decimals: number){
  n+=""

  if (n.indexOf(".") === -1) {
    return n;
  }

  const arr = n.split(".");
  const fraction = arr[1] .substring(0, decimals);
  return arr[0] + "." + fraction;
}