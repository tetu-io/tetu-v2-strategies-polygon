import {
  Aave3AggregatorInterfaceMock,
  IAave3PriceOracle,
  IAave3PriceOracle__factory,
  IConverterController__factory,
  IPriceOracle,
  IPriceOracle__factory,
  ITetuConverter__factory,
} from '../../../../../typechain';
import { MaticAddresses } from '../../../../../scripts/addresses/MaticAddresses';
import { MockHelper } from '../../../../baseUT/helpers/MockHelper';
import { ConverterUtils } from '../../../../baseUT/utils/ConverterUtils';
import {
  getAaveTwoPlatformAdapter,
  getDForcePlatformAdapter,
  getHundredFinancePlatformAdapter,
  Misc,
} from '../../../../../scripts/utils/Misc';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

export interface IPriceOracles {
  daiPriceSource: Aave3AggregatorInterfaceMock;
  usdcPriceSource: Aave3AggregatorInterfaceMock;
  usdtPriceSource: Aave3AggregatorInterfaceMock;

  priceOracleAave3: IAave3PriceOracle;
  priceOracleInTetuConverter: IPriceOracle;
}

export class PriceOracleUtils {
  public static async setupMockedPriceOracleSources(
    signer: SignerWithAddress,
    tetuConverterAddress: string,
  ): Promise<IPriceOracles> {

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
    const priceOracleAsPoolOwner: IAave3PriceOracle = IAave3PriceOracle__factory.connect(
      AAVE_V3_PRICE_ORACLE,
      poolOwner,
    );

    const priceDai = await priceOracleAsPoolOwner.getAssetPrice(MaticAddresses.DAI_TOKEN);
    const priceUsdc = await priceOracleAsPoolOwner.getAssetPrice(MaticAddresses.USDC_TOKEN);
    const priceUsdt = await priceOracleAsPoolOwner.getAssetPrice(MaticAddresses.USDT_TOKEN);

    const daiPriceSource = await MockHelper.createAave3AggregatorInterfaceMock(signer, priceDai);
    const usdcPriceSource = await MockHelper.createAave3AggregatorInterfaceMock(signer, priceUsdc);
    const usdtPriceSource = await MockHelper.createAave3AggregatorInterfaceMock(signer, priceUsdt);

    await priceOracleAsPoolOwner.setAssetSources([MaticAddresses.DAI_TOKEN], [daiPriceSource.address]);
    await priceOracleAsPoolOwner.setAssetSources([MaticAddresses.USDC_TOKEN], [usdcPriceSource.address]);
    await priceOracleAsPoolOwner.setAssetSources([MaticAddresses.USDT_TOKEN], [usdtPriceSource.address]);

    const priceOracleAave3 = priceOracleAsPoolOwner.connect(signer);

    const priceOracleInTetuConverter = await IPriceOracle__factory.connect(
      await IConverterController__factory.connect(
        await ITetuConverter__factory.connect(tetuConverterAddress, signer).controller(),
        signer,
      ).priceOracle(),
      signer,
    );

    return {
      daiPriceSource,
      priceOracleAave3,
      priceOracleInTetuConverter,
      usdcPriceSource,
      usdtPriceSource,
    };
  }

  public static async decPriceDai(priceOracles: IPriceOracles, percent: number) {
    const daiPrice = await priceOracles.daiPriceSource.price();
    const daiNewPrice = daiPrice.mul(100 - percent).div(100);
    await priceOracles.daiPriceSource.setPrice(daiNewPrice);
  }

  public static async incPriceUsdt(priceOracles: IPriceOracles, percent: number) {
    const usdtPrice = await priceOracles.usdtPriceSource.price();
    const usdtNewPrice = usdtPrice.mul(100 + percent).div(100);
    await priceOracles.usdtPriceSource.setPrice(usdtNewPrice);
  }
}
