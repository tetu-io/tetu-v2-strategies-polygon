import {Misc} from "../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {
  ControllerV2__factory,
  IController__factory,
  IERC20__factory,
  IERC20Metadata,
  IERC20Metadata__factory, IPairBasedDefaultStateProvider,
  IPairBasedDefaultStateProvider__factory,
  IRebalancingV2Strategy, IRebalancingV2Strategy__factory,
  ISetupPairBasedStrategy__factory,
  IStrategyV2,
  StrategyBaseV2,
  StrategyBaseV2__factory,
  StrategySplitterV2,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory
} from "../../../typechain";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../utils/ConverterUtils";
import {PackedData} from "../utils/PackedData";
import {PriceOracleImitatorUtils} from "../converter/PriceOracleImitatorUtils";
import {UniversalTestUtils} from "../utils/UniversalTestUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IStateParams} from "../utils/StateUtilsNum";

export interface IUniswapV3BuilderParams {
  gov: string;
  pool: string;
  /** underlying in the pool */
  asset: string;
  /** not-underlying in the pool */
  secondAsset: string;
  vaultName: string;
  converter: string;
  signer: SignerWithAddress;
  signer2: SignerWithAddress;
}

export interface IUniswapV3BuilderResults {
  gov: SignerWithAddress;

  core: CoreAddresses;
  strategy: IRebalancingV2Strategy;
  vault: TetuVaultV2;
  insurance: string;
  splitter: StrategySplitterV2;
  pool: string;
  asset: string;
  assetCtr: IERC20Metadata;
  assetDecimals: number;
  stateParams: IStateParams;
  operator: SignerWithAddress;
}

export class UniswapV3Builder {
  static async build(p: IUniswapV3BuilderParams): Promise<IUniswapV3BuilderResults> {
    const signer = p.signer;
    const gov = await Misc.impersonate(p.gov);

    const core = Addresses.getCore() as CoreAddresses;
    const pool = p.pool;
    const assetCtr = IERC20Metadata__factory.connect(p.asset, signer);
    const assetDecimals = await IERC20Metadata__factory.connect(p.asset, gov).decimals();

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
          pool,
          0,
          0,
          [0, 0, Misc.MAX_UINT, 0],
          [0, 0, Misc.MAX_UINT, 0],
        );

        return _strategy as unknown as IStrategyV2;
      },
      IController__factory.connect(core.controller, gov),
      gov,
      0,
      300,
      300,
      false,
    );

    const vault = data.vault;
    const strategy = IRebalancingV2Strategy__factory.connect(data.strategy.address, gov);
    const splitter = data.splitter;
    const insurance = await vault.insurance();

    // setup converter
    await ConverterUtils.whitelist([strategy.address]);
    const state = await PackedData.getDefaultState(strategy);

    // prices should be the same in the pool and in the oracle
    await PriceOracleImitatorUtils.uniswapV3(signer, state.pool, state.tokenA);

    // prices should be the same in the pool and in the liquidator
    const pools = [
      {
        pool: state.pool,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.USDC_TOKEN,
        tokenOut: MaticAddresses.USDT_TOKEN,
      },
    ]
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    const liquidatorOperator = await Misc.impersonate('0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94')
    await tools.liquidator.connect(liquidatorOperator).addLargestPools(pools, true);
    await tools.liquidator.connect(liquidatorOperator).addBlueChipsPools(pools, true);

    // ---

    await IERC20__factory.connect(p.asset, signer).approve(vault.address, Misc.MAX_UINT);
    await IERC20__factory.connect(p.asset, p.signer2).approve(vault.address, Misc.MAX_UINT);

    await ControllerV2__factory.connect(core.controller, gov).registerOperator(signer.address);

    await vault.setWithdrawRequestBlocks(0);

    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [p.asset, p.secondAsset])
    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)
    await ISetupPairBasedStrategy__factory.connect(strategy.address, operator).setStrategyProfitHolder(profitHolder.address);

    const stateParams = {
      mainAssetSymbol: await IERC20Metadata__factory.connect(p.asset, signer).symbol()
    }

    return {
      gov,
      asset: p.asset,
      assetCtr,
      core,
      insurance,
      operator,
      pool,
      stateParams,
      splitter,
      vault,
      strategy,
      assetDecimals
    }
  }
}