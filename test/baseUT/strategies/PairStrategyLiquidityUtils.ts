import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {AlgebraLib, KyberLib, UniswapV3Lib} from "../../../typechain";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "./AppPlatforms";
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
        return UniswapV3LiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib as unknown as UniswapV3Lib, poolAddress);
      case PLATFORM_ALGEBRA:
        return AlgebraLiquidityUtils.getLiquidityAmountsInCurrentTickspacing(signer, lib as unknown as AlgebraLib, poolAddress);
      case PLATFORM_KYBER:
        return KyberLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib as unknown as KyberLib, poolAddress);
      default: throw Error(`PairStrategyLiquidityUtils unknown ${platform}`);
    }
  }
}