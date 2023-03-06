/// @param accuracy 10 for 1e-10
import {BigNumber} from "ethers";
import {formatUnits, parseUnits} from "ethers/lib/utils";

/** true if the given big numbers are equal to each other with given precision */
export function areAlmostEqual(b1: BigNumber, b2: BigNumber, precision: number = 8) : boolean {
  if (b1.eq(0)) {
    return b2.eq(0);
  }
  const nPrecision = parseUnits("1", precision);
  console.log("approx1", b1, b2);
  console.log("approx2", b1.sub(b2));
  console.log("approx3", b1.sub(b2).mul(nPrecision).div(b1).abs());
  console.log("approx4", b1.sub(b2).mul(nPrecision).div(b1).abs().mul(nPrecision));
  console.log("approx5", b1.sub(b2).mul(nPrecision).div(b1).abs().mul(nPrecision).toNumber());
  return b1.sub(b2).mul(nPrecision).div(b1).abs().mul(nPrecision).toNumber() === 0;
}

/**
 * true if b1 < b2 less than on given number of percents, i.e. 1%
 */
export function differenceInPercentsLessThan(b1: BigNumber, b2: BigNumber, percents100: number = 1) : boolean {
  if (b1.eq(0)) {
    return b2.eq(0);
  }
  const a = +formatUnits(b1.sub(b2).mul(100).mul(1e3).div(b1).abs(), 3);
  console.log("differenceInPercentsLessThan", a, percents100);
  return a <= percents100;
}