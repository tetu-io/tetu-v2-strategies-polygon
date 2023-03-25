/**
 * Utils to deploy and setup TetuConverter app
 */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {ConverterController__factory, IBorrowManager, IBorrowManager__factory} from "../../../typechain";
import {RunHelper} from "../../../scripts/utils/RunHelper";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {AdaptersHelper} from "./AdaptersHelper";

//region Data types
export interface IControllerSetupParams {
  minHealthFactor2: number;
  targetHealthFactor2: number;
  maxHealthFactor2: number;
  blocksPerDay: number; // i.e. 41142
  disableAave3: boolean;
  disableAaveTwo: boolean;
  disableDForce: boolean;
}

export interface IBorrowManagerSetupParams {
  /*
   *  Reward APR is taken into account with given factor. Decimals 18.
   *  The value is divided on {REWARDS_FACTOR_DENOMINATOR_18}
   */
  rewardsFactor: BigNumber;
}

export interface IDeployedContracts {
  controller?: string;
  tetuConverter?: string;
  borrowManager?: string;
  debtMonitor?: string;
  swapManager?: string;
  keeper?: string;
  priceOracle?: string;
}

export interface IDeployCoreResults {
  controller: string;
  tetuConverter: string;
  borrowManager: string;
  debtMonitor: string;
  swapManager: string;
  keeper: string;
  priceOracle: string;
  tetuLiquidator: string;
  controllerSetupParams: IControllerSetupParams;
  borrowManagerSetupParams: IBorrowManagerSetupParams;
  gelatoOpsReady: string;
}

export interface IPlatformAdapterResult {
  lendingPlatformTitle: string;
  platformAdapterAddress: string;
  converters: string[];
  /* All cTokens (actual for DForce and HundredFinance only) */
  cTokensActive?: string[];
  /* We need to manually set priceOracle for HundredFinance only */
  priceOracle?: string;
}

export interface IPlatformAdapterAssets {
  leftAssets: string[];
  rightAssets: string[];
}

export interface ITargetHealthFactorValue {
  asset: string;
  healthFactor2: number;
}
//endregion Data types

const GAS_DEPLOY_LIMIT = 8_000_000;

export class DeployTetuConverterApp {
//region Main script
  static async deployApp(
    signer: SignerWithAddress,
    gelatoOpsReady: string,
    params?: IControllerSetupParams,
  ) : Promise<IDeployCoreResults> {

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    /// Initial settings
    const tetuLiquidatorAddress = MaticAddresses.TETU_LIQUIDATOR;
    const controllerSetupParams: IControllerSetupParams = params || {
      blocksPerDay: 41142,
      minHealthFactor2: 105,
      targetHealthFactor2: 200,
      maxHealthFactor2: 400,
      disableAave3: false,
      disableAaveTwo: false,
      disableDForce: false
    };
    const borrowManagerSetupParams: IBorrowManagerSetupParams = {
      rewardsFactor: parseUnits("0.5", 18)
    };

    const targetHealthFactorsAssets = [
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.USDT_TOKEN,
      MaticAddresses.DAI_TOKEN,
      MaticAddresses.WETH_TOKEN,
      MaticAddresses.WMATIC_TOKEN,
      MaticAddresses.WBTC_TOKEN
    ];
    const targetHealthFactorsValues = [
      115, // MaticAddresses.USDC,
      115, // MaticAddresses.USDT,
      115, // MaticAddresses.DAI,
      200, // MaticAddresses.WETH,
      200, // MaticAddresses.WMATIC,
      200, // MaticAddresses.WBTC
    ];

    const aave3Pool = MaticAddresses.AAVE3_POOL;
    const aave3AssetPairs = DeployTetuConverterApp.generateAssetPairs([
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.USDT_TOKEN,
      MaticAddresses.DAI_TOKEN,
      MaticAddresses.WETH_TOKEN,
      MaticAddresses.WMATIC_TOKEN,
      MaticAddresses.WBTC_TOKEN
      // MaticAddresses.MaticX,
      // MaticAddresses.stMATIC,
      // MaticAddresses.miMATIC
    ]);

    const aaveTwoPool = MaticAddresses.AAVE_LENDING_POOL;
    const aaveTwoPairs = DeployTetuConverterApp.generateAssetPairs([
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.USDT_TOKEN,
      MaticAddresses.DAI_TOKEN,
      MaticAddresses.WETH_TOKEN,
      MaticAddresses.WMATIC_TOKEN,
      MaticAddresses.WBTC_TOKEN
    ]);

    const dForceComptroller = MaticAddresses.DFORCE_CONTROLLER;
    const dForceCTokens = [
      MaticAddresses.DFORCE_IDAI,
      MaticAddresses.DFORCE_IMATIC,
      MaticAddresses.DFORCE_IUSDC,
      MaticAddresses.DFORCE_IWETH,
      MaticAddresses.DFORCE_IUSDT,
      MaticAddresses.DFORCE_IWBTC,
    ];
    const dForcePairs = DeployTetuConverterApp.generateAssetPairs([
      MaticAddresses.USDC_TOKEN,
      MaticAddresses.USDT_TOKEN,
      MaticAddresses.DAI_TOKEN,
      MaticAddresses.WETH_TOKEN,
      MaticAddresses.WMATIC_TOKEN,
      MaticAddresses.WBTC_TOKEN
    ]);

    ///////////////////////////////////////////////////////////////////////////////////////////////////


    console.log("Deploy contracts");
    // Deploy all core contracts
    const deployCoreResults = await DeployTetuConverterApp.deployCoreContracts(
      signer,
      gelatoOpsReady,
      tetuLiquidatorAddress,
      controllerSetupParams,
      borrowManagerSetupParams
    );

    console.log("Deploy platform adapters");
    const borrowManager = IBorrowManager__factory.connect(deployCoreResults.borrowManager, signer);
    const deployedPlatformAdapters: IPlatformAdapterResult[] = [];

    // Deploy all Platform adapters and pool adapters
    const platformAdapterAave3 = controllerSetupParams.disableAave3
      ? undefined
      : await DeployTetuConverterApp.createPlatformAdapterAAVE3(signer,
        deployCoreResults.controller,
        aave3Pool
      );
    if (platformAdapterAave3) {
      console.log("Register platform adapter AAVE3");
      deployedPlatformAdapters.push(platformAdapterAave3);

      await DeployTetuConverterApp.registerPlatformAdapter(
        borrowManager,
        platformAdapterAave3.platformAdapterAddress,
        aave3AssetPairs
      );
    }

    const platformAdapterAaveTwo = controllerSetupParams.disableAaveTwo
      ? undefined
      : await DeployTetuConverterApp.createPlatformAdapterAAVETwo(signer,
        deployCoreResults.controller,
        aaveTwoPool
      );
    if (platformAdapterAaveTwo) {
      console.log("Register platform adapter AAVE2");
      deployedPlatformAdapters.push(platformAdapterAaveTwo);
      await DeployTetuConverterApp.registerPlatformAdapter(
        borrowManager,
        platformAdapterAaveTwo.platformAdapterAddress,
        aaveTwoPairs
      );
    }

    const platformAdapterDForce = controllerSetupParams.disableDForce
      ? undefined
      : await DeployTetuConverterApp.createPlatformAdapterDForce(signer,
        deployCoreResults.controller,
        dForceComptroller,
        dForceCTokens
      );
    if (platformAdapterDForce) {
      console.log("Register platform adapter DForce");
      deployedPlatformAdapters.push(platformAdapterDForce);
      await DeployTetuConverterApp.registerPlatformAdapter(
        borrowManager,
        platformAdapterDForce.platformAdapterAddress,
        dForcePairs
      );
    }

    console.log("setTargetHealthFactors");
    // set target health factors
    await RunHelper.runAndWait(
      () =>  borrowManager.setTargetHealthFactors(
        targetHealthFactorsAssets,
        targetHealthFactorsValues,
        {gasLimit: GAS_DEPLOY_LIMIT}
      )
    );

    return deployCoreResults;
  }
//endregion Main script

//region Setup core
  static async deployCoreContracts(
    deployer: SignerWithAddress,
    gelatoOpsReady: string,
    tetuLiquidator: string,
    controllerSetupParams: IControllerSetupParams,
    borrowManagerSetupParams: IBorrowManagerSetupParams,
    alreadyDeployed?: IDeployedContracts
  ) : Promise<IDeployCoreResults> {
    const priceOracle = alreadyDeployed?.priceOracle
      || (await CoreContractsHelper.createPriceOracle(deployer)).address;
    const controller = alreadyDeployed?.controller
      || (await CoreContractsHelper.deployController(deployer, tetuLiquidator, priceOracle)).address;

    const borrowManager = alreadyDeployed?.borrowManager || (await CoreContractsHelper.createBorrowManager(
      deployer,
      controller,
      borrowManagerSetupParams.rewardsFactor
    )).address;
    const keeper = alreadyDeployed?.keeper
      || (await CoreContractsHelper.createKeeper(deployer, controller, gelatoOpsReady)).address;

    const debtMonitor = alreadyDeployed?.debtMonitor
      || (await CoreContractsHelper.createDebtMonitor(deployer, controller, borrowManager)).address;
    const swapManager = alreadyDeployed?.swapManager
      || (await CoreContractsHelper.createSwapManager(deployer, controller, tetuLiquidator, priceOracle)).address;
    const tetuConverter = alreadyDeployed?.tetuConverter
      || (await CoreContractsHelper.createTetuConverter(
        deployer,
        controller,
        borrowManager,
        debtMonitor,
        swapManager,
        keeper,
        priceOracle
      )).address;

    await RunHelper.runAndWait(
      () => ConverterController__factory.connect(controller, deployer).initialize(
        deployer.address,
        controllerSetupParams.blocksPerDay,
        controllerSetupParams.minHealthFactor2,
        controllerSetupParams.targetHealthFactor2,
        controllerSetupParams.maxHealthFactor2,
        tetuConverter,
        borrowManager,
        debtMonitor,
        keeper,
        swapManager,
        {gasLimit: GAS_DEPLOY_LIMIT}
      )
    );

    return {
      controller,
      tetuConverter,
      borrowManager,
      debtMonitor,
      swapManager,
      keeper,
      priceOracle,
      tetuLiquidator,
      controllerSetupParams,
      borrowManagerSetupParams,
      gelatoOpsReady
    }
  }
//endregion Setup core

//region Platform adapters
  static async createPlatformAdapterAAVE3(
    deployer: SignerWithAddress,
    controller: string,
    aavePoolAddress: string
  ) : Promise<IPlatformAdapterResult> {
    const converterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
    const converterEModde = await AdaptersHelper.createAave3PoolAdapterEMode(deployer);
    const platformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
      deployer,
      controller,
      aavePoolAddress,
      converterNormal.address,
      converterEModde.address,
    );

    return {
      lendingPlatformTitle: "AAVE v3",
      converters: [converterNormal.address, converterEModde.address],
      platformAdapterAddress: platformAdapter.address
    }
  }

  static async createPlatformAdapterAAVETwo(
    deployer: SignerWithAddress,
    controller: string,
    aavePoolAddress: string
  ) : Promise<IPlatformAdapterResult> {
    const converterNormal = await AdaptersHelper.createAaveTwoPoolAdapter(deployer);
    const platformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
      deployer,
      controller,
      aavePoolAddress,
      converterNormal.address,
    );

    return {
      lendingPlatformTitle: "AAVE-TWO",
      converters: [converterNormal.address],
      platformAdapterAddress: platformAdapter.address
    }
  }

  static async createPlatformAdapterDForce(
    deployer: SignerWithAddress,
    controller: string,
    comptroller: string,
    cTokensActive: string[]
  ) : Promise<IPlatformAdapterResult> {
    const converterNormal = await AdaptersHelper.createDForcePoolAdapter(deployer);
    const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
      deployer,
      controller,
      comptroller,
      converterNormal.address,
      cTokensActive,
    );

    return {
      lendingPlatformTitle: "DForce",
      converters: [converterNormal.address],
      platformAdapterAddress: platformAdapter.address,
      cTokensActive
    }
  }
//endregion Platform adapters

//region Utils
  static async registerPlatformAdapter(
    borrowManager: IBorrowManager,
    platformAdapter: string,
    assetPairs: IPlatformAdapterAssets
  ) {
    console.log("registerPlatformAdapter", platformAdapter, assetPairs);
    await RunHelper.runAndWait(
      () => borrowManager.addAssetPairs(
        platformAdapter,
        assetPairs.leftAssets,
        assetPairs.rightAssets,
        {gasLimit: GAS_DEPLOY_LIMIT}
      )
    );
  }

  static generateAssetPairs(tokens: string[]) : IPlatformAdapterAssets {
    const leftAssets: string[] = [];
    const rightAssets: string[] = [];
    for (let i = 0; i < tokens.length; ++i) {
      for (let j = i + 1; j < tokens.length; ++j) {
        leftAssets.push(tokens[i]);
        rightAssets.push(tokens[j]);
      }
    }
    return {leftAssets, rightAssets};
  }
//endregion Utils

}
