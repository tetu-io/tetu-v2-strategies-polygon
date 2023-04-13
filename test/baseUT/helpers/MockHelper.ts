import {
  Aave3AggregatorInterfaceMock, BalancerBoostedDepositorFacade,
  BalancerLogicLibFacade,
  ConverterStrategyBaseLibFacade,
  MockConverterStrategy,
  MockConverterStrategy__factory,
  MockForwarder,
  MockTetuConverter,
  MockTetuConverterController,
  MockTetuLiquidatorSingleCall,
  PriceOracleMock, UniswapV3LibFacade,
} from '../../../typechain';
import { DeployerUtils } from '../../../scripts/utils/DeployerUtils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

export class MockHelper {
  public static async createMockConverterStrategy(signer: SignerWithAddress): Promise<MockConverterStrategy> {
    return MockConverterStrategy__factory.connect(
      (await DeployerUtils.deployProxy(signer, 'MockConverterStrategy')),
      signer,
    );
  }

  public static async createPriceOracle(
    signer: SignerWithAddress,
    assets: string[],
    prices: BigNumber[],
  ): Promise<PriceOracleMock> {
    return (await DeployerUtils.deployContract(
      signer,
      'PriceOracleMock',
      assets,
      prices,
    )) as PriceOracleMock;
  }

  public static async createMockTetuConverter(signer: SignerWithAddress): Promise<MockTetuConverter> {
    return (await DeployerUtils.deployContract(
      signer,
      'MockTetuConverter',
    )) as MockTetuConverter;
  }

  public static async createMockTetuLiquidatorSingleCall(signer: SignerWithAddress): Promise<MockTetuLiquidatorSingleCall> {
    return (await DeployerUtils.deployContract(
      signer,
      'MockTetuLiquidatorSingleCall',
    )) as MockTetuLiquidatorSingleCall;
  }

  public static async createMockTetuConverterController(
    signer: SignerWithAddress,
    priceOracle: string,
  ): Promise<MockTetuConverterController> {
    return (await DeployerUtils.deployContract(
      signer,
      'MockTetuConverterController',
      priceOracle,
    )) as MockTetuConverterController;
  }

  public static async createBalancerLogicLibFacade(signer: SignerWithAddress): Promise<BalancerLogicLibFacade> {
    return (await DeployerUtils.deployContract(signer, 'BalancerLogicLibFacade')) as BalancerLogicLibFacade;
  }

  public static async createConverterStrategyBaseFacade(signer: SignerWithAddress): Promise<ConverterStrategyBaseLibFacade> {
    return (await DeployerUtils.deployContract(
      signer,
      'ConverterStrategyBaseLibFacade',
    )) as ConverterStrategyBaseLibFacade;
  }

  public static async createBalancerBoostedDepositorFacade(
    signer: SignerWithAddress,
    pool: string = MaticAddresses.BALANCER_POOL_T_USD
  ): Promise<BalancerBoostedDepositorFacade> {
    const ret = (await DeployerUtils.deployContract(
      signer,
      'BalancerBoostedDepositorFacade',
    )) as BalancerBoostedDepositorFacade;
    await ret.init(pool);
    return ret;
  }

  public static async createMockForwarder(signer: SignerWithAddress): Promise<MockForwarder> {
    return (await DeployerUtils.deployContract(
      signer,
      'MockForwarder',
    )) as MockForwarder;
  }

  public static async createAave3AggregatorInterfaceMock(
    signer: SignerWithAddress,
    price: BigNumber,
  ): Promise<Aave3AggregatorInterfaceMock> {
    return (await DeployerUtils.deployContract(
      signer,
      'Aave3AggregatorInterfaceMock',
      price,
    )) as Aave3AggregatorInterfaceMock;
  }

  public static async createUniswapV3LibFacade(signer: SignerWithAddress): Promise<UniswapV3LibFacade> {
    return (await DeployerUtils.deployContract(
      signer,
      'UniswapV3LibFacade',
    )) as UniswapV3LibFacade;
  }
}
