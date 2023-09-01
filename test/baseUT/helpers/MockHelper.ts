import {
  Aave3AggregatorInterfaceMock,
  BalancerBoostedDepositorFacade,
  BalancerLogicLibFacade,
  BorrowLibFacade,
  ConverterStrategyBaseLibFacade, ConverterStrategyBaseLibFacade2, IterationPlanLibFacade,
  MockController,
  MockConverterStrategy,
  MockConverterStrategy__factory,
  MockForwarder,
  MockSplitterVault,
  MockTetuConverter,
  MockTetuConverterController,
  MockTetuLiquidatorSingleCall,
  MockVaultInsurance,
  PriceOracleMock,
  PairBasedStrategyLibFacade,
  PairBasedStrategyReaderAccessMock,
  UniswapV3LibFacade,
  PairBasedStrategyReader,
  UniswapV3ConverterStrategyLogicLibFacade,
  MockUniswapV3Pool, PairBasedStrategyLogicLibFacade, AppLibFacade, SwapHelper, MockAggregator, MockSwapper,
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

  public static async createConverterStrategyBaseLibFacade(signer: SignerWithAddress): Promise<ConverterStrategyBaseLibFacade> {
    return (await DeployerUtils.deployContract(
      signer,
      'ConverterStrategyBaseLibFacade',
    )) as ConverterStrategyBaseLibFacade;
  }

  public static async createAppLibFacade(signer: SignerWithAddress): Promise<AppLibFacade> {
    return (await DeployerUtils.deployContract(
        signer,
        'AppLibFacade',
    )) as AppLibFacade;
  }

  public static async createConverterStrategyBaseLibFacade2(signer: SignerWithAddress): Promise<ConverterStrategyBaseLibFacade2> {
    return (await DeployerUtils.deployContract(
      signer,
      'ConverterStrategyBaseLibFacade2',
    )) as ConverterStrategyBaseLibFacade2;
  }

  public static async createBalancerBoostedDepositorFacade(
    signer: SignerWithAddress,
    pool: string = MaticAddresses.BALANCER_POOL_T_USD,
    gauge: string = MaticAddresses.BALANCER_GAUGE_V2_T_USD
  ): Promise<BalancerBoostedDepositorFacade> {
    const ret = (await DeployerUtils.deployContract(
      signer,
      'BalancerBoostedDepositorFacade',
    )) as BalancerBoostedDepositorFacade;
    await ret.init(pool, gauge);
    return ret;
  }

  public static async createMockForwarder(signer: SignerWithAddress): Promise<MockForwarder> {
    return (await DeployerUtils.deployContract(signer, 'MockForwarder')) as MockForwarder;
  }

  public static async createMockController(signer: SignerWithAddress): Promise<MockController> {
    return (await DeployerUtils.deployContract(signer, 'MockController')) as MockController;
  }

  public static async createMockSplitter(signer: SignerWithAddress): Promise<MockSplitterVault> {
    return (await DeployerUtils.deployContract(signer, 'MockSplitterVault')) as MockSplitterVault;
  }

  public static async createMockVault(signer: SignerWithAddress): Promise<MockVaultInsurance> {
    return (await DeployerUtils.deployContract(signer, 'MockVaultInsurance')) as MockVaultInsurance;
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

  public static async createBorrowLibFacade(signer: SignerWithAddress): Promise<BorrowLibFacade> {
    return (await DeployerUtils.deployContract(signer, 'BorrowLibFacade')) as BorrowLibFacade;
  }

  public static async createIterationPlanLibFacade(signer: SignerWithAddress): Promise<IterationPlanLibFacade> {
    return (await DeployerUtils.deployContract(signer, 'IterationPlanLibFacade')) as IterationPlanLibFacade;
  }


  public static async createPairBasedStrategyReaderAccessMock(signer: SignerWithAddress): Promise<PairBasedStrategyReaderAccessMock> {
    return (await DeployerUtils.deployContract(signer, 'PairBasedStrategyReaderAccessMock')) as PairBasedStrategyReaderAccessMock;
  }

  public static async createPairBasedStrategyReader(signer: SignerWithAddress): Promise<PairBasedStrategyReader> {
    return (await DeployerUtils.deployContract(signer, 'PairBasedStrategyReader')) as PairBasedStrategyReader;
  }

  public static async createPairBasedStrategyLibFacade(signer: SignerWithAddress): Promise<PairBasedStrategyLibFacade> {
    return (await DeployerUtils.deployContract(signer, 'PairBasedStrategyLibFacade')) as PairBasedStrategyLibFacade;
  }

  public static async createPairBasedStrategyLogicLibFacade(signer: SignerWithAddress): Promise<PairBasedStrategyLogicLibFacade> {
    return (await DeployerUtils.deployContract(signer, 'PairBasedStrategyLogicLibFacade')) as PairBasedStrategyLogicLibFacade;
  }

  public static async createUniswapV3ConverterStrategyLogicLibFacade(signer: SignerWithAddress): Promise<UniswapV3ConverterStrategyLogicLibFacade> {
    return (await DeployerUtils.deployContract(signer, 'UniswapV3ConverterStrategyLogicLibFacade')) as UniswapV3ConverterStrategyLogicLibFacade;
  }

  // public static async createUniswapV3DebtLibFacade(signer: SignerWithAddress): Promise<UniswapV3DebtLibFacade> {
  //   return (await DeployerUtils.deployContract(signer, 'UniswapV3DebtLibFacade')) as UniswapV3DebtLibFacade;
  // }

  public static async createMockUniswapV3Pool(signer: SignerWithAddress): Promise<MockUniswapV3Pool> {
    return (await DeployerUtils.deployContract(signer, 'MockUniswapV3Pool')) as MockUniswapV3Pool;
  }

  public static async createSwapperHelper(signer: SignerWithAddress): Promise<SwapHelper> {
    return (await DeployerUtils.deployContract(signer, 'SwapHelper')) as SwapHelper;
  }

  public static async createMockAggregator(signer: SignerWithAddress, priceOracle: string): Promise<MockAggregator> {
    return (await DeployerUtils.deployContract(signer, 'MockAggregator', priceOracle)) as MockAggregator;
  }

  public static async createMockSwapper(signer: SignerWithAddress, priceOracle: string): Promise<MockSwapper> {
    return (await DeployerUtils.deployContract(signer, 'MockSwapper', priceOracle)) as MockSwapper;
  }
}
