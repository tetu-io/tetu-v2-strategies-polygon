import {BASE_NETWORK_ID, POLYGON_NETWORK_ID, ZKEVM_NETWORK_ID} from "./HardhatUtils";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";
import {PLATFORM_ALGEBRA, PLATFORM_PANCAKE, PLATFORM_UNIV3} from "../strategies/AppPlatforms";

export class PlatformUtils {
  static getTetuLiquidator(chainId: number): string {
    switch (chainId) {
      case BASE_NETWORK_ID: return BaseAddresses.TETU_LIQUIDATOR;
      case POLYGON_NETWORK_ID: return MaticAddresses.TETU_LIQUIDATOR;
      case ZKEVM_NETWORK_ID: return ZkevmAddresses.TETU_LIQUIDATOR;
      default: throw Error(`getTetuLiquidator: chain ${chainId} is not supported`);
    }
  }

  static getTetuConverter(chainId: number): string {
    switch (chainId) {
      case BASE_NETWORK_ID: return BaseAddresses.TETU_CONVERTER;
      case POLYGON_NETWORK_ID: return MaticAddresses.TETU_CONVERTER;
      case ZKEVM_NETWORK_ID: return ZkevmAddresses.TETU_CONVERTER;
      default: throw Error(`getTetuConverter: chain ${chainId} is not supported`);
    }
  }

  static getOneInch(chainId: number): string {
    switch (chainId) {
      case BASE_NETWORK_ID: return BaseAddresses.AGG_ONEINCH_V5;
      case POLYGON_NETWORK_ID: return MaticAddresses.AGG_ONEINCH_V5;
      case ZKEVM_NETWORK_ID: return ZkevmAddresses.AGG_ONEINCH_V5;
      default: throw Error(`getOneInch: chain ${chainId} is not supported`);
    }
  }

  static getErrorMessage(platform: string, error: string): string {
    return platform === PLATFORM_UNIV3
      ? "U3S" + error // "U3S-9 No rebalance needed"
      : platform === PLATFORM_ALGEBRA
        ? "AS" + error
        : platform === PLATFORM_PANCAKE
          ? "PS" + error
          : "KS" + error;
  }

}