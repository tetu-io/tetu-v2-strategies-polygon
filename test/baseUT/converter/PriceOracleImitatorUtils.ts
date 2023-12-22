/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ConverterUtils} from "../utils/ConverterUtils";
import {getAaveTwoPlatformAdapter, Misc} from "../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {
  AggregatorInterface,
  IAave3PriceOracle,
  IAave3PriceOracle__factory,
  IAlgebraPool__factory,
  IBVault__factory,
  IComposableStablePool__factory, IERC20Metadata__factory,
  ILinearPool__factory,
  IMoonwellComptroller__factory, IMoonwellPriceOracle__factory,
  IPancakeV3Pool__factory,
  IPool__factory,
  IPriceOracle__factory,
  IUniswapV3Pool__factory,
} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";
import {BASE_NETWORK_ID, POLYGON_NETWORK_ID} from "../utils/HardhatUtils";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";
import {parseUnits} from "ethers/lib/utils";

export class PriceOracleImitatorUtils {
  public static async getPrice(signer: SignerWithAddress, token: string): Promise<BigNumber> {
    const chainId = Misc.getChainId()
    if (chainId === POLYGON_NETWORK_ID) {
      const aave3Oracle = IAave3PriceOracle__factory.connect(MaticAddresses.AAVE3_PRICE_ORACLE, signer);
      return aave3Oracle.getAssetPrice(token)
    } else if (chainId === BASE_NETWORK_ID) {
      const priceOracle = IPriceOracle__factory.connect(BaseAddresses.TETU_CONVERTER_PRICE_ORACLE, signer)
      return (await priceOracle.getAssetPrice(token)).div(parseUnits('1', 10))
    } else {
      throw new Error(`PriceOracleImitatorUtils.getPrice: unsupported chainId ${chainId}`)
    }
  }

  public static async balancerBoosted(
    signer: SignerWithAddress,
    pool: string,
    stableToken: string,
    stableTokenPrice: string = '100000000'
  ) {
    // Disable all lending platforms except AAVE3
    // await ConverterUtils.disablePlatformAdapter(signer, await getDForcePlatformAdapter(signer));
    await ConverterUtils.disablePlatformAdapter(signer, await getAaveTwoPlatformAdapter(signer));

    const poolOwner = await Misc.impersonate(MaticAddresses.AAVE3_POOL_OWNER);
    const priceOracleAsPoolOwner: IAave3PriceOracle = IAave3PriceOracle__factory.connect(MaticAddresses.AAVE3_PRICE_ORACLE, poolOwner);

    // get volatile tokens
    const balancerBoostedPool = IComposableStablePool__factory.connect(pool, signer)
    const balancerVault = IBVault__factory.connect(MaticAddresses.BALANCER_VAULT, signer)
    const volatileTokens = []
    const poolTokens = await balancerVault.getPoolTokens(await balancerBoostedPool.getPoolId())
    const rootBptIndex = (await balancerBoostedPool.getBptIndex()).toNumber()
    for (let i = 0; i < poolTokens.tokens.length; i++) {
      if (i !== rootBptIndex) {
        const linearPool = ILinearPool__factory.connect(poolTokens.tokens[i], signer)
        const mainToken = await linearPool.getMainToken()
        if (mainToken.toLowerCase() !== stableToken.toLowerCase()) {
          volatileTokens.push(mainToken)
        }

        await balancerBoostedPool.updateTokenRateCache(poolTokens.tokens[i])
      }
    }
    console.log(volatileTokens)

    const tokens = [
      stableToken,
    ]
    const sources: AggregatorInterface[] = [
      await DeployerUtils.deployContract(signer, 'Aave3PriceSourceFixed', stableTokenPrice) as AggregatorInterface,
    ]

    for (const volatileToken of volatileTokens) {
      tokens.push(volatileToken)
      sources.push(await DeployerUtils.deployContract(signer, 'Aave3PriceSourceBalancerBoosted', pool, volatileToken, stableToken) as AggregatorInterface)
    }

    await priceOracleAsPoolOwner.setAssetSources(tokens, sources.map(x => x.address))
  }

  public static async uniswapV3(
    signer: SignerWithAddress,
    pool: string,
    stableToken: string,
    stableTokenPrice: string = '100000000'
  ) {
    // Disable all lending platforms except AAVE3
    // await ConverterUtils.disablePlatformAdapter(signer, await getDForcePlatformAdapter(signer));
    await ConverterUtils.disablePlatformAdapter(signer, await getAaveTwoPlatformAdapter(signer));

    const poolOwner = await Misc.impersonate(MaticAddresses.AAVE3_POOL_OWNER);
    const priceOracleAsPoolOwner: IAave3PriceOracle = IAave3PriceOracle__factory.connect(MaticAddresses.AAVE3_PRICE_ORACLE, poolOwner);

    const univ3Pool = IUniswapV3Pool__factory.connect(pool, signer)
    const token0 = await univ3Pool.token0()
    const token1 = await univ3Pool.token1()
    const volatileToken = token0.toLowerCase() === stableToken.toLowerCase() ? token1 : token0
    const sources: AggregatorInterface[] = [
      await DeployerUtils.deployContract(signer, 'Aave3PriceSourceFixed', stableTokenPrice) as AggregatorInterface,
      await DeployerUtils.deployContract(signer, 'Aave3PriceSourceUniswapV3', pool, volatileToken) as AggregatorInterface
    ]

    await priceOracleAsPoolOwner.setAssetSources([stableToken, volatileToken], sources.map(x => x.address));
  }

  public static async algebra(
    signer: SignerWithAddress,
    pool: string,
    stableToken: string,
    stableTokenPrice: string = '100000000'
  ) {
    // Disable all lending platforms except AAVE3
    // await ConverterUtils.disablePlatformAdapter(signer, await getDForcePlatformAdapter(signer));
    await ConverterUtils.disablePlatformAdapter(signer, await getAaveTwoPlatformAdapter(signer));

    const poolOwner = await Misc.impersonate(MaticAddresses.AAVE3_POOL_OWNER);
    const priceOracleAsPoolOwner: IAave3PriceOracle = IAave3PriceOracle__factory.connect(MaticAddresses.AAVE3_PRICE_ORACLE, poolOwner);

    const algebraPool = IAlgebraPool__factory.connect(pool, signer)
    const token0 = await algebraPool.token0()
    const token1 = await algebraPool.token1()
    const volatileToken = token0.toLowerCase() === stableToken.toLowerCase() ? token1 : token0
    const sources: AggregatorInterface[] = [
      await DeployerUtils.deployContract(signer, 'Aave3PriceSourceFixed', stableTokenPrice) as AggregatorInterface,
      await DeployerUtils.deployContract(signer, 'Aave3PriceSourceAlgebra', pool, volatileToken) as AggregatorInterface
    ]

    await priceOracleAsPoolOwner.setAssetSources([stableToken, volatileToken], sources.map(x => x.address));
  }

  public static async kyber(
    signer: SignerWithAddress,
    pool: string,
    stableToken: string,
    stableTokenPrice: string = '100000000'
  ) {
    // Disable all lending platforms except AAVE3
    // await ConverterUtils.disablePlatformAdapter(signer, await getDForcePlatformAdapter(signer));
    await ConverterUtils.disablePlatformAdapter(signer, await getAaveTwoPlatformAdapter(signer));

    const poolOwner = await Misc.impersonate(MaticAddresses.AAVE3_POOL_OWNER);
    const priceOracleAsPoolOwner: IAave3PriceOracle = IAave3PriceOracle__factory.connect(MaticAddresses.AAVE3_PRICE_ORACLE, poolOwner);

    const algebraPool = IPool__factory.connect(pool, signer)
    const token0 = await algebraPool.token0()
    const token1 = await algebraPool.token1()
    const volatileToken = token0.toLowerCase() === stableToken.toLowerCase() ? token1 : token0
    const sources: AggregatorInterface[] = [
      await DeployerUtils.deployContract(signer, 'Aave3PriceSourceFixed', stableTokenPrice) as AggregatorInterface,
      await DeployerUtils.deployContract(signer, 'Aave3PriceSourceKyber', pool, volatileToken) as AggregatorInterface
    ]

    await priceOracleAsPoolOwner.setAssetSources([stableToken, volatileToken], sources.map(x => x.address));
  }

  public static async pancakeBaseChain(
    signer: SignerWithAddress,
    pool: string,
    stableToken: string,
    stableTokenPrice: string = "1"
  ) {
    const comptroller = IMoonwellComptroller__factory.connect(BaseAddresses.MOONWELL_COMPTROLLER, signer);
    const admin = await Misc.impersonate(await comptroller.admin());
    const priceOracle = await comptroller.oracle();

    const pancakePool = IPancakeV3Pool__factory.connect(pool, signer);
    const token0 = await pancakePool.token0();
    const token1 = await pancakePool.token1();
    const volatileToken = token0.toLowerCase() === stableToken.toLowerCase() ? token1 : token0

    await IMoonwellPriceOracle__factory.connect(priceOracle, admin).setFeed(
      await IERC20Metadata__factory.connect(stableToken, signer).symbol(),
      (await DeployerUtils.deployContract(signer, 'MoonwellAggregatorV3Fixed', parseUnits(stableTokenPrice, 8))).address
    );

    await IMoonwellPriceOracle__factory.connect(priceOracle, admin).setFeed(
      await IERC20Metadata__factory.connect(volatileToken, signer).symbol(),
      (await DeployerUtils.deployContract(signer, 'MoonwellAggregatorV3PancakePool', pool, volatileToken)).address
    );
  }
}