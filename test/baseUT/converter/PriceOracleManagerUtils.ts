import {
  Aave3AggregatorInterfaceMock,
  IAave3PriceOracle,
  IAave3PriceOracle__factory,
  IConverterController__factory,
  IPriceOracle__factory,
  ITetuConverter__factory,
} from '../../../typechain';
import { MaticAddresses } from '../../../scripts/addresses/MaticAddresses';
import { MockHelper } from '../helpers/MockHelper';
import { ConverterUtils } from '../utils/ConverterUtils';
import { getAaveTwoPlatformAdapter, getDForcePlatformAdapter, Misc } from '../../../scripts/utils/Misc';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {IAssetSourceInfo, IPriceOracleManager, PriceOracleManager} from "./PriceOracleManager";

export class PriceOracleManagerUtils {
  /**
   * Build a manager to modify prices in TetuConverter (===AAVE3) price oracle,
   * replace price-sources for the given tokens by mocks
   */
  public static async build(
    signer: SignerWithAddress,
    tetuConverterAddress: string,
    tokens: string[] = [MaticAddresses.DAI_TOKEN, MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN]
  ): Promise<IPriceOracleManager> {

    // Disable all lending platforms except AAVE3
    await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());
    await ConverterUtils.disablePlatformAdapter(signer, getAaveTwoPlatformAdapter());

    //  See first event for of ACLManager (AAVE_V3_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD")
    //  https://polygonscan.com/address/0xa72636cbcaa8f5ff95b2cc47f3cdee83f3294a0b#readContract
    const AAVE_V3_POOL_OWNER = '0xdc9a35b16db4e126cfedc41322b3a36454b1f772';
    const poolOwner = await Misc.impersonate(AAVE_V3_POOL_OWNER);

    // Set up mocked price-source to AAVE3's price oracle
    // Tetu converter uses same price oracle internally
    const AAVE_V3_PRICE_ORACLE = '0xb023e699F5a33916Ea823A16485e259257cA8Bd1';
    const priceOracleAsPoolOwner: IAave3PriceOracle = IAave3PriceOracle__factory.connect(AAVE_V3_PRICE_ORACLE, poolOwner);

    const sources: Aave3AggregatorInterfaceMock[] = [];
    const mapSources: Map<string, IAssetSourceInfo> = new Map<string, IAssetSourceInfo>();
    for (const token of tokens) {
      const price = await priceOracleAsPoolOwner.getAssetPrice(token);
      const source = await MockHelper.createAave3AggregatorInterfaceMock(signer, price);
      sources.push(source);
      mapSources.set(token, {aggregator: source, priceOriginal: price});
    }

    await priceOracleAsPoolOwner.setAssetSources(tokens, sources.map(x => x.address));

    const priceOracleAave3 = priceOracleAsPoolOwner.connect(signer);

    const priceOracleInTetuConverter = await IPriceOracle__factory.connect(
      await IConverterController__factory.connect(
        await ITetuConverter__factory.connect(tetuConverterAddress, signer).controller(),
        signer,
      ).priceOracle(),
      signer,
    );

    return new PriceOracleManager(priceOracleAave3, priceOracleInTetuConverter, mapSources);
  }


}
