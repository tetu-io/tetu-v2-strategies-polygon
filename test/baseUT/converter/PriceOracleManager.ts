import {
  Aave3AggregatorInterfaceMock,
  IAave3PriceOracle,
  IAave3PriceOracle__factory,
  IConverterController__factory,
  IPriceOracle,
  IPriceOracle__factory,
  ITetuConverter__factory,
} from '../../../typechain';
import { MaticAddresses } from '../../../scripts/addresses/MaticAddresses';
import { MockHelper } from '../helpers/MockHelper';
import { ConverterUtils } from '../utils/ConverterUtils';
import { getAaveTwoPlatformAdapter, getDForcePlatformAdapter, Misc } from '../../../scripts/utils/Misc';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {BigNumber} from "ethers";

/**
 * Allow to modify prices in TetuConvertor's (=== AAVE3) price oracle
 */
export interface IPriceOracleManager {
  priceOracleAave3: IAave3PriceOracle;
  priceOracleInTetuConverter: IPriceOracle;

  setPrice(token: string, price: BigNumber): Promise<void>;
  resetPrice(token: string): Promise<void>;
  decPrice(token: string, percent: number): Promise<void>;
  incPrice(token: string, percent: number): Promise<void>;
  sourceInfo(token: string): IAssetSourceInfo;
}

export interface IAssetSourceInfo {
  aggregator: Aave3AggregatorInterfaceMock;
  priceOriginal: BigNumber;
}

/**
 * Allow to modify prices in TetuConvertor's (=== AAVE3) price oracle
 */
export class PriceOracleManager implements IPriceOracleManager {
  public readonly sources: Map<string, IAssetSourceInfo>;
  public priceOracleAave3: IAave3PriceOracle;
  public priceOracleInTetuConverter: IPriceOracle;

  constructor(
    priceOracleAave3: IAave3PriceOracle,
    priceOracleInTetuConverter: IPriceOracle,
    sources: Map<string, IAssetSourceInfo>
  ) {
    this.priceOracleAave3 = priceOracleAave3;
    this.priceOracleInTetuConverter = priceOracleInTetuConverter;
    this.sources = sources;
  }

  private getSourceInfo(token: string) : IAssetSourceInfo {
    const source = this.sources.get(token);
    if (! source) {
      throw new Error(`PriceOracleManager doesn't have source for ${token}`);
    }
    return source;
  }

  public async setPrice(token: string, newPrice: BigNumber): Promise<void> {
    const source = this.getSourceInfo(token);
    await source.aggregator.setPrice(newPrice);
  }

  public async resetPrice(token: string): Promise<void> {
    const source = this.getSourceInfo(token);
    await source.aggregator.setPrice(source.priceOriginal);
  }

  public async decPrice(token: string, percent: number): Promise<void> {
    const source = this.getSourceInfo(token);
    const price = await source.aggregator.price();
    const newPrice = price.mul(100 - percent).div(100);
    await source.aggregator.setPrice(newPrice);
  }

  public async incPrice(token: string, percent: number): Promise<void> {
    const source = this.getSourceInfo(token);
    const price = await source.aggregator.price();
    const newPrice = price.mul(100 + percent).div(100);
    await source.aggregator.setPrice(newPrice);
  }

  public sourceInfo(token: string): IAssetSourceInfo {
    return this.getSourceInfo(token);
  }
}
