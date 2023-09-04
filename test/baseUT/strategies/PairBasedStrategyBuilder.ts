import {Misc} from "../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {
    AlgebraConverterStrategy,
    AlgebraConverterStrategy__factory, AlgebraLib,
    ControllerV2,
    ControllerV2__factory,
    ConverterStrategyBase__factory, ConverterStrategyBaseLibFacade2,
    IController__factory,
    IERC20__factory,
    IERC20Metadata,
    IERC20Metadata__factory,
    IRebalancingV2Strategy,
    IRebalancingV2Strategy__factory,
    ISetupPairBasedStrategy__factory,
    IStrategyV2, ITetuConverter, ITetuConverter__factory, ITetuConverterCallback__factory,
    ITetuLiquidator,
    KyberConverterStrategy,
    KyberConverterStrategy__factory, KyberLib,
    StrategySplitterV2, SwapHelper,
    TetuVaultV2,
    UniswapV3ConverterStrategy,
    UniswapV3ConverterStrategy__factory, UniswapV3Lib,
    VaultFactory__factory
} from "../../../typechain";
import {DeployerUtilsLocal, IVaultStrategyInfo} from "../../../scripts/utils/DeployerUtilsLocal";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../utils/ConverterUtils";
import {IDefaultState, PackedData} from "../utils/PackedData";
import {PriceOracleImitatorUtils} from "../converter/PriceOracleImitatorUtils";
import {UniversalTestUtils} from "../utils/UniversalTestUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IStateParams} from "../utils/StateUtilsNum";
import {parseUnits} from "ethers/lib/utils";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "./AppPlatforms";
import {MockHelper} from "../helpers/MockHelper";

export const KYBER_PID = 40; // previous value was 21, new one is 40
export const KYBER_USDC_DAI_PID = 42;

export interface IBuilderParams {
  gov: string;
  pool: string;
  /** underlying in the pool */
  asset: string;
  vaultName: string;
  converter: string;
  signer: SignerWithAddress;
  signer2: SignerWithAddress;
  swapper: string;
  profitHolderTokens: string[];
  liquidatorPools: ITetuLiquidator.PoolDataStruct[];
  quoter: string;

  compoundRatio?: number;
  buffer?: number;
  depositFee?: number;
  withdrawFee?: number;
}

export interface IStrategyBasicInfo {
  strategy: IRebalancingV2Strategy;
  swapper: string;
  quoter: string;
  pool: string;
  lib: UniswapV3Lib | AlgebraLib | KyberLib;
  swapHelper?: SwapHelper;
}

export interface IBuilderResults extends IStrategyBasicInfo {
  gov: SignerWithAddress;

  core: CoreAddresses;
  vault: TetuVaultV2;
  insurance: string;
  splitter: StrategySplitterV2;
  asset: string;
  assetCtr: IERC20Metadata;
  assetDecimals: number;
  stateParams: IStateParams;
  operator: SignerWithAddress;
  converter: ITetuConverter;

  facadeLib2: ConverterStrategyBaseLibFacade2;
}

export class PairBasedStrategyBuilder {
  private static async setPriceImitator(
      signer: SignerWithAddress,
      state: IDefaultState,
      strategy: IRebalancingV2Strategy
  ){
    const platform = await ConverterStrategyBase__factory.connect(strategy.address, signer).PLATFORM();
    if (platform === PLATFORM_UNIV3) {
      await PriceOracleImitatorUtils.uniswapV3(signer, state.pool, state.tokenA);
    } else if (platform === PLATFORM_ALGEBRA) {
      await PriceOracleImitatorUtils.algebra(signer, state.pool, state.tokenA);
    } else if (platform === PLATFORM_KYBER) {
      await PriceOracleImitatorUtils.kyber(signer, state.pool, state.tokenA);
    } else throw Error(`setPriceImitator: unknown platform ${platform}`);
  }

  private static async build(
      p: IBuilderParams,
      controllerAsGov: ControllerV2,
      core: CoreAddresses,
      data: IVaultStrategyInfo,
      lib: UniswapV3Lib | AlgebraLib | KyberLib
  ): Promise<IBuilderResults> {
    const signer = p.signer;
    const gov = await Misc.impersonate(p.gov);

    const vault = data.vault;
    const strategy = IRebalancingV2Strategy__factory.connect(data.strategy.address, gov);

    // whitlist the strategy in the converter
    await ConverterUtils.whitelist([strategy.address]);
    const state = await PackedData.getDefaultState(strategy);

    // prices should be the same in the pool and in the oracle
    await this.setPriceImitator(signer, state, strategy);

    // prices should be the same in the pool and in the liquidator
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    const liquidatorOperator = await Misc.impersonate('0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94')
    await tools.liquidator.connect(liquidatorOperator).addLargestPools(p.liquidatorPools, true);
    await tools.liquidator.connect(liquidatorOperator).addBlueChipsPools(p.liquidatorPools, true);

    // approve asset to vault for both signers
    await IERC20__factory.connect(p.asset, signer).approve(vault.address, Misc.MAX_UINT);
    await IERC20__factory.connect(p.asset, p.signer2).approve(vault.address, Misc.MAX_UINT);

    await vault.setWithdrawRequestBlocks(0);

    await controllerAsGov.registerOperator(signer.address);
    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)

    // set profit holder
    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, p.profitHolderTokens)
    await ISetupPairBasedStrategy__factory.connect(strategy.address, operator).setStrategyProfitHolder(profitHolder.address);

    // set liquidation thresholds
    await ConverterStrategyBase__factory.connect(strategy.address, operator).setLiquidationThreshold(p.asset, parseUnits('0.001', 6));

    if (p.compoundRatio) {
      const platformVoter = await DeployerUtilsLocal.impersonate(await controllerAsGov.platformVoter());
      await ConverterStrategyBase__factory.connect(strategy.address, platformVoter).setCompoundRatio(p.compoundRatio);
    }

    return {
      gov,
      asset: p.asset,
      assetCtr: IERC20Metadata__factory.connect(p.asset, signer),
      core,
      insurance: await vault.insurance(),
      operator,
      pool: p.pool,
      splitter: data.splitter,
      vault,
      strategy,
      assetDecimals: await IERC20Metadata__factory.connect(p.asset, gov).decimals(),
      stateParams: {
        mainAssetSymbol: await IERC20Metadata__factory.connect(p.asset, signer).symbol()
      },
      swapper: p.swapper,
      facadeLib2: await MockHelper.createConverterStrategyBaseLibFacade2(signer),
      converter: ITetuConverter__factory.connect(p.converter, signer),
      quoter: p.quoter,

      lib,
      swapHelper: await MockHelper.createSwapperHelper(signer)
    }
  }

  static async buildUniv3(p: IBuilderParams): Promise<IBuilderResults> {
    const signer = p.signer;
    const gov = await Misc.impersonate(p.gov);
    const core = Addresses.getCore() as CoreAddresses;
    const controller = ControllerV2__factory.connect(core.controller, gov);

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      p.asset,
      p.vaultName,
      async(_splitterAddress: string) => {
        const _strategy = UniswapV3ConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          p.converter,
          p.pool,
          0,
          0,
          [0, 0, Misc.MAX_UINT, 0],
          [0, 0, Misc.MAX_UINT, 0],
        );

        return _strategy as unknown as IStrategyV2;
      },
      controller,
      gov,
      p.buffer ?? 0,
        p.depositFee ?? 300,
      p.withdrawFee ?? 300,
      false,
    );

    const lib = await DeployerUtils.deployContract(signer, 'UniswapV3Lib') as UniswapV3Lib;
    return this.build(p, controller, core, data, lib);
  }

  static async buildAlgebra(p: IBuilderParams): Promise<IBuilderResults> {
    const signer = p.signer;
    const gov = await Misc.impersonate(p.gov);
    const core = Addresses.getCore() as CoreAddresses;
    const controller = ControllerV2__factory.connect(core.controller, gov);

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
        p.asset,
        p.vaultName,
        async(_splitterAddress: string) => {
          const _strategy = AlgebraConverterStrategy__factory.connect(
              await DeployerUtils.deployProxy(signer, 'AlgebraConverterStrategy'),
              gov,
          );

          await _strategy.init(
              core.controller,
              _splitterAddress,
              p.converter,
              p.pool,
              0,
              0,
              true,
              {
                rewardToken: MaticAddresses.dQUICK_TOKEN,
                bonusRewardToken: MaticAddresses.WMATIC_TOKEN,
                pool: p.pool,
                startTime: 1663631794,
                endTime: 4104559500
              },
              [0, 0, Misc.MAX_UINT, 0],
              [0, 0, Misc.MAX_UINT, 0],
          );

          return _strategy as unknown as IStrategyV2;
        },
        controller,
        gov,
        1_000,
        300,
        300,
        false,
    );
    const lib = await DeployerUtils.deployContract(signer, 'AlgebraLib') as AlgebraLib;
    return this.build(p, controller, core, data, lib);
  }

  static async buildKyber(p: IBuilderParams): Promise<IBuilderResults> {
    const pId = KYBER_PID;

    const signer = p.signer;
    const gov = await Misc.impersonate(p.gov);
    const core = Addresses.getCore() as CoreAddresses;
    const controllerAsGov = DeployerUtilsLocal.getController(gov)

    // use the latest implementations
    const vaultLogic = await DeployerUtils.deployContract(signer, 'TetuVaultV2');
    const splitterLogic = await DeployerUtils.deployContract(signer, 'StrategySplitterV2');
    const vaultFactory = VaultFactory__factory.connect(core.vaultFactory, signer);
    await vaultFactory.connect(gov).setVaultImpl(vaultLogic.address);
    await vaultFactory.connect(gov).setSplitterImpl(splitterLogic.address);

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
        p.asset,
        p.vaultName,
        async(_splitterAddress: string) => {
          const _strategy = KyberConverterStrategy__factory.connect(
              await DeployerUtils.deployProxy(signer, 'KyberConverterStrategy'),
              gov,
          );

          await _strategy.init(
              core.controller,
              _splitterAddress,
              p.converter,
              p.pool,
              0,
              0,
              true,
              pId,
              [0, 0, Misc.MAX_UINT, 0],
              [0, 0, Misc.MAX_UINT, 0],
          );

          return _strategy as unknown as IStrategyV2;
        },
        controllerAsGov,
        gov,
        0,
        300,
        300,
        false,
    );
    const lib = await DeployerUtils.deployContract(signer, 'KyberLib') as KyberLib;
    return this.build(p, controllerAsGov, core, data, lib);
  }
}