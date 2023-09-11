import {IStrategyV2__factory} from "../../typechain";
import {ethers} from "hardhat";

export class NSRUtils {
  static async isStrategyEligibleForNSR(strategyAdr: string) {
    const version = await IStrategyV2__factory.connect(strategyAdr, ethers.provider).STRATEGY_VERSION();
    const name = await IStrategyV2__factory.connect(strategyAdr, ethers.provider).NAME();

    const names = new Set<string>([
      'UniswapV3 Converter Strategy',
      'Kyber Converter Strategy',
      'Algebra Converter Strategy',
    ]);

    return Number(version.charAt(0)) > 1 && names.has(name);
  }
}