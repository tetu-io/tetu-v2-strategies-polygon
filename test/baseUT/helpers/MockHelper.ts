import {
  Aave3AggregatorInterfaceMock,
  BalancerComposableStableDepositorFacade,
  BalancerComposableStableStrategyAccess,
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

  public static async createConverterStrategyBaseLibFacade(signer: SignerWithAddress): Promise<ConverterStrategyBaseLibFacade> {
    return (await DeployerUtils.deployContract(
      signer,
      'ConverterStrategyBaseLibFacade',
    )) as ConverterStrategyBaseLibFacade;
  }

  public static async createBalancerComposableStableDepositorFacade(
    signer: SignerWithAddress,
    poolId: string = '0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b',
    rewardTokens: string[] = ['0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3'],
  ): Promise<BalancerComposableStableDepositorFacade> {
    const ret = (await DeployerUtils.deployContract(
      signer,
      'BalancerComposableStableDepositorFacade',
    )) as BalancerComposableStableDepositorFacade;
    ret.init(poolId, rewardTokens);
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

  public static async createBalancerComposableStableStrategyAccess(signer: SignerWithAddress): Promise<BalancerComposableStableStrategyAccess> {
    return (await DeployerUtils.deployContract(
      signer,
      'BalancerComposableStableStrategyAccess',
    )) as BalancerComposableStableStrategyAccess;
  }

  public static async createUniswapV3LibFacade(signer: SignerWithAddress): Promise<UniswapV3LibFacade> {
    return (await DeployerUtils.deployContract(
      signer,
      'UniswapV3LibFacade',
    )) as UniswapV3LibFacade;
  }
}
