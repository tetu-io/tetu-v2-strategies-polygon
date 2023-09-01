import {MockHelper} from "../helpers/MockHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {parseUnits} from "ethers/lib/utils";
import {IERC20Metadata__factory, MockAggregator, MockSwapper} from "../../../typechain";

export interface IMockAggregatorParams {
  priceOracle: string;

  token0: string;
  token1: string;

  /** true - increase output amount on {percentToIncrease} */
  increaseOutput?: boolean; // true by default
  /** Percent of changing output amount, DENOMINATOR = 100_000, so 1000 = 1% */
  percentToIncrease?: number; // 0.1% by default

  /** Use same increaseOutput for both pairs token0:token1 and token1:token0 */
  singleDirection?: boolean; // true by default

  amountToken0?: string; // 100_000 by default
  amountToken1?: string; // 100_000 by default
}

export class MockAggregatorUtils {
  static async createMockAggregator(signer: SignerWithAddress, p: IMockAggregatorParams): Promise<MockAggregator> {
    const dest = await MockHelper.createMockAggregator(signer, p.priceOracle);
    await dest.setupLiquidate(
      p.token0,
      p.token1,
      p.increaseOutput ?? true,
      p.percentToIncrease ?? 100 // 0.1% by default
    );
    await dest.setupLiquidate(
      p.token1,
      p.token0,
      p.singleDirection
        ? p.increaseOutput ?? true
        : !(p.increaseOutput ?? true),
      p.percentToIncrease ?? 100 // 0.1% by default
    );

    await TokenUtils.getToken(p.token0, dest.address,
      parseUnits(p?.amountToken0 || "100000", await IERC20Metadata__factory.connect(p.token0, signer).decimals())
    );
    await TokenUtils.getToken(p.token1, dest.address,
      parseUnits(p?.amountToken1 || "100000", await IERC20Metadata__factory.connect(p.token1, signer).decimals())
    );

    return dest;
  }

  static async createMockSwapper(signer: SignerWithAddress, p: IMockAggregatorParams): Promise<MockSwapper> {
    const dest = await MockHelper.createMockSwapper(signer, p.priceOracle, p.token0, p.token1);
    await dest.setupSwap(
      p.token0,
      p.token1,
      p.increaseOutput ?? true,
      p.percentToIncrease ?? 100 // 0.1% by default
    );
    await dest.setupSwap(
      p.token1,
      p.token0,
      p.singleDirection
        ? p.increaseOutput ?? true
        : !(p.increaseOutput ?? true),
      p.percentToIncrease ?? 100 // 0.1% by default
    );

    await TokenUtils.getToken(p.token0, dest.address,
      parseUnits(p?.amountToken0 || "100000", await IERC20Metadata__factory.connect(p.token0, signer).decimals())
    );
    await TokenUtils.getToken(p.token1, dest.address,
      parseUnits(p?.amountToken1 || "100000", await IERC20Metadata__factory.connect(p.token1, signer).decimals())
    );

    await dest.setupReserves();

    return dest;
  }
}