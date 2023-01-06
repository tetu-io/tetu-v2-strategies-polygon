import {
  MockConverterStrategy,
  MockConverterStrategy__factory, MockTetuConverterController,
  MockTetuConverterSingleCall, MockTetuLiquidatorSingleCall,
  PriceOracleMock
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
}