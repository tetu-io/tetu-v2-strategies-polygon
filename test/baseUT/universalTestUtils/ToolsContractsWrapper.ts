import { ITetuConverter, ITetuLiquidator, Multicall } from '../../../typechain';


export interface IToolsContractsWrapper {
  liquidator: ITetuLiquidator;
  converter: ITetuConverter;
  multicall: Multicall;
}
