/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ConverterUtils} from "../utils/ConverterUtils";
import {getAaveTwoPlatformAdapter, getDForcePlatformAdapter, Misc} from "../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {
  AggregatorInterface,
  IAave3PriceOracle,
  IAave3PriceOracle__factory,
  IBVault__factory,
  IComposableStablePool__factory,
  ILinearPool__factory,
  IUniswapV3Pool__factory
} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";

export class PriceOracleImitatorUtils {
  public static async getPrice(signer: SignerWithAddress, token: string): Promise<BigNumber> {
    const aave3Oracle = IAave3PriceOracle__factory.connect(MaticAddresses.AAVE3_PRICE_ORACLE, signer);
    return aave3Oracle.getAssetPrice(token)
  }

  public static async balancerBoosted(
    signer: SignerWithAddress,
    pool: string,
    stableToken: string,
    stableTokenPrice: string = '100000000'
  ) {
    // Disable all lending platforms except AAVE3
    await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());
    await ConverterUtils.disablePlatformAdapter(signer, getAaveTwoPlatformAdapter());

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
    await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());
    await ConverterUtils.disablePlatformAdapter(signer, getAaveTwoPlatformAdapter());

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
}