import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {AlgebraLib, KyberLib, UniswapV3Lib} from "../../../typechain";
import {PLATFORM_ALGEBRA, PLATFORM_UNIV3} from "./AppPlatforms";
import {UniswapV3LiquidityUtils} from "../../strategies/polygon/uniswapv3/utils/UniswapV3LiquidityUtils";
import {AlgebraLiquidityUtils} from "../../strategies/polygon/algebra/utils/AlgebraLiquidityUtils";
import {KyberLiquidityUtils} from "../../strategies/polygon/kyber/utils/KyberLiquidityUtils";

export class PairStrategyLiquidityUtils {
  static async getLiquidityAmountsInCurrentTick(
    signer: SignerWithAddress,
    platform: string,
    lib: KyberLib | UniswapV3Lib | AlgebraLib,
    poolAddress: string
  ) {
    switch (platform) {
      case PLATFORM_UNIV3:
        if (!(lib instanceof UniswapV3Lib)) {
          throw Error("PairStrategyLiquidityUtils.wrong.lib");
        }
        return UniswapV3LiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib, poolAddress);
      case PLATFORM_ALGEBRA:
        if (!(lib instanceof AlgebraLib)) {
          throw Error("PairStrategyLiquidityUtils.wrong.lib");
        }
        return AlgebraLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib, poolAddress);
      case PLATFORM_KYBER:
        if (!(lib instanceof KyberLib)) {
          throw Error("PairStrategyLiquidityUtils.wrong.lib");
        }
        return KyberLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib, poolAddress);
      default: throw Error(`PairStrategyLiquidityUtils unknown ${platform}`);
    }
  }
}