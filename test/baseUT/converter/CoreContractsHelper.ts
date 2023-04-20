import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager,
  ConverterController,
  DebtMonitor,
  Keeper,
  PriceOracle,
  SwapManager,
  TetuConverter,
} from "../../../typechain";
import {BigNumber} from "ethers";
import {parseUnits} from "ethers/lib/utils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";

export class CoreContractsHelper {
  static async deployController(
    deployer: SignerWithAddress,
    tetuLiquidator: string,
    priceOracle: string
  ): Promise<ConverterController> {
    return (await DeployerUtils.deployContract(
      deployer,
      "ConverterController",
      tetuLiquidator,
      priceOracle
    )) as ConverterController;
  }

  static async createController(
    deployer: SignerWithAddress,
    tetuConverterFabric: (
      controller: ConverterController,
      borrowManager: string,
      debtMonitor: string,
      swapManager: string,
      keeper: string,
      priceOracle: string
    ) => Promise<string>,
    borrowManagerFabric: (controller: ConverterController) => Promise<string>,
    debtMonitorFabric: (
      controller: ConverterController,
      borrowManager: string
    ) => Promise<string>,
    keeperFabric: (controller: ConverterController) => Promise<string>,
    tetuLiquidatorFabric: () => Promise<string>,
    swapManagerFabric: (
      controller: ConverterController,
      tetuLiquidator: string,
      priceOracle: string
    ) => Promise<string>,
    priceOracleFabric: () => Promise<string>,
    minHealthFactor2: number = 101,
    targetHealthFactor2: number = 200,
    maxHealthFactor2: number = 400,
    countBlocksPerDay: number = 40000
  ): Promise<ConverterController> {
    const tetuLiquidator = await tetuLiquidatorFabric();
    const priceOracle = await priceOracleFabric();

    const controller = await this.deployController(deployer, tetuLiquidator, priceOracle);
    const borrowManager = await borrowManagerFabric(controller);
    const keeper = await keeperFabric(controller);

    const swapManager = await swapManagerFabric(controller, tetuLiquidator, priceOracle);
    const debtMonitor = await debtMonitorFabric(controller, borrowManager);

    const tetuConverter = await tetuConverterFabric(
      controller,
      borrowManager,
      debtMonitor,
      swapManager,
      keeper,
      priceOracle
    );

    await controller.initialize(
      deployer.address,
      countBlocksPerDay,
      minHealthFactor2,
      targetHealthFactor2,
      maxHealthFactor2,
      tetuConverter,
      borrowManager,
      debtMonitor,
      keeper,
      swapManager,
      1000
    );
    return controller;
  }

  public static async createDebtMonitor(
    signer: SignerWithAddress,
    controllerAddress: string,
    borrowManager: string
    // thresholdAPR: number = 0,
    // thresholdCountBlocks: number = 0
  ): Promise<DebtMonitor> {
    return (await DeployerUtils.deployContract(
      signer,
      "DebtMonitor",
      controllerAddress,
      borrowManager,
      // thresholdAPR,
      // thresholdCountBlocks
    )) as DebtMonitor;
  }

  public static async createTetuConverter(
    signer: SignerWithAddress,
    controller: string,
    borrowManager: string,
    debtMonitor: string,
    swapManager: string,
    keeper: string,
    priceOracle: string
  ): Promise<TetuConverter> {
    return (await DeployerUtils.deployContract(
      signer,
      "TetuConverter",
      controller,
      borrowManager,
      debtMonitor,
      swapManager,
      keeper,
      priceOracle
    )) as TetuConverter;
  }

  /** Create BorrowManager with mock as adapter */
  public static async createBorrowManager(
    signer: SignerWithAddress,
    controller: string,
    rewardsFactor: BigNumber = parseUnits("0.9") // rewardsFactor must be less 1
  ): Promise<BorrowManager> {
    return (await DeployerUtils.deployContract(
      signer,
      "BorrowManager",
      controller,
      rewardsFactor
    )) as BorrowManager;
  }

  /** Create SwapManager */
  public static async createSwapManager(
    signer: SignerWithAddress,
    controller: string,
    tetuLiquidator: string,
    priceOracle: string
  ): Promise<SwapManager> {
    return (await DeployerUtils.deployContract(
      signer,
      "SwapManager",
      controller,
      tetuLiquidator,
      priceOracle
    )) as SwapManager;
  }

  public static async createKeeper(
    signer: SignerWithAddress,
    controller: string,
    gelatoOpsAddress: string,
    blocksPerDayAutoUpdatePeriodSecs: number = 2 * 7 * 24 * 60 * 60 // 2 weeks by default
  ): Promise<Keeper> {
    return (await DeployerUtils.deployContract(
      signer,
      "Keeper",
      controller,
      gelatoOpsAddress,
      blocksPerDayAutoUpdatePeriodSecs
    )) as Keeper;
  }

  public static async createPriceOracle(
    signer: SignerWithAddress,
    priceOracleAave3?: string
  ): Promise<PriceOracle> {
    return (await DeployerUtils.deployContract(
      signer,
      "@tetu_io/tetu-converter/contracts/core/PriceOracle.sol:PriceOracle",
      priceOracleAave3 || MaticAddresses.AAVE3_PRICE_ORACLE
    )) as PriceOracle;
  }
}
