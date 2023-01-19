import {
  BalancerComposableStableDepositorFacade,
  BalancerLogicLibFacade,
  MockConverterStrategy,
  MockConverterStrategy__factory, MockTetuConverterController,
  MockTetuConverterSingleCall, MockTetuLiquidatorSingleCall,
  PriceOracleMock, Uniswap2LibFacade
} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";

export class MockHelper {
  public static async createMockConverterStrategy(signer: SignerWithAddress) : Promise<MockConverterStrategy> {
    return MockConverterStrategy__factory.connect(
      (await DeployerUtils.deployProxy(signer, 'MockConverterStrategy')),
      signer
    );
  }

  public static async createPriceOracle(
    signer: SignerWithAddress,
    assets: string[],
    prices: BigNumber[]
  ) : Promise<PriceOracleMock> {
    return (await DeployerUtils.deployContract(
      signer,
      'PriceOracleMock',
      assets,
      prices
    )) as PriceOracleMock;
  }

  public static async createMockTetuConverterSingleCall(signer: SignerWithAddress): Promise<MockTetuConverterSingleCall> {
    return (await DeployerUtils.deployContract(
      signer,
      'MockTetuConverterSingleCall',
    )) as MockTetuConverterSingleCall;
  }

  public static async createMockTetuLiquidatorSingleCall(signer: SignerWithAddress): Promise<MockTetuLiquidatorSingleCall> {
    return (await DeployerUtils.deployContract(
      signer,
      'MockTetuLiquidatorSingleCall',
    )) as MockTetuLiquidatorSingleCall;
  }

  public static async createMockTetuConverterController(
    signer: SignerWithAddress,
    priceOracle: string
  ) : Promise<MockTetuConverterController> {
    return (await DeployerUtils.deployContract(
      signer,
      'MockTetuConverterController',
      priceOracle
    )) as MockTetuConverterController;
  }

  public static async createUniswap2LibFacade(signer: SignerWithAddress) : Promise<Uniswap2LibFacade> {
    return (await DeployerUtils.deployContract(signer, 'Uniswap2LibFacade')) as Uniswap2LibFacade;
  }

  public static async createBalancerLogicLibFacade(signer: SignerWithAddress) : Promise<BalancerLogicLibFacade> {
    return (await DeployerUtils.deployContract(signer, 'BalancerLogicLibFacade')) as BalancerLogicLibFacade;
  }

  public static async createBalancerComposableStableDepositorFacade(
    signer: SignerWithAddress,
    poolId: string = "0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b"
  ) : Promise<BalancerComposableStableDepositorFacade> {
    const ret = (await DeployerUtils.deployContract(
      signer,
      'BalancerComposableStableDepositorFacade',
    )) as BalancerComposableStableDepositorFacade;
    ret.init(poolId);
    return ret;
  }
}