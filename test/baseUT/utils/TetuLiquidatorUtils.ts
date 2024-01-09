import {ITetuLiquidator} from "../../../typechain";

export interface ITetuLiquidatorPoolInfo extends ITetuLiquidator.PoolDataStruct {
  isBlueChip?: boolean; // default - true
  isLargePool?: boolean; // default - true
};

export class TetuLiquidatorUtils {
  static getLargePools(pools: ITetuLiquidatorPoolInfo[]): ITetuLiquidator.PoolDataStruct[] {
    return pools.filter(x => x.isLargePool ?? true);
  }

  static getBlueChips(pools: ITetuLiquidatorPoolInfo[]): ITetuLiquidator.PoolDataStruct[] {
    return pools.filter(x => x.isBlueChip ?? true);
  }
}