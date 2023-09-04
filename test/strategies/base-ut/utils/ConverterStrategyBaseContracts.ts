import {
  BalancerBoostedStrategy__factory,
  ControllerV2__factory,
  ConverterStrategyBase, ConverterStrategyBase__factory,
  IController, IController__factory, IERC20__factory,
  IStrategyV2,
  StrategySplitterV2,
  TetuVaultV2,
  UniswapV3ConverterStrategy__factory
} from "../../../../typechain";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {Signer} from "ethers";
import {Provider} from "@ethersproject/providers";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {parseUnits} from "ethers/lib/utils";
import {PackedData} from "../../../baseUT/utils/PackedData";

const COMPOUND_RATIO = 50_000;
const REINVEST_THRESHOLD_PERCENT = 1_000;

export interface IConverterStrategyBaseContractsParams {
  converter?: string;
  buffer?: number;
  depositFee?: number;
  withdrawFee?: number;
  wait?: boolean;
}

export class ConverterStrategyBaseContracts {
  strategy: ConverterStrategyBase;
  vault: TetuVaultV2;
  splitter: StrategySplitterV2;
  insurance: string;
  asset: string;

  constructor(
    strategy: ConverterStrategyBase,
    vault: TetuVaultV2,
    splitter: StrategySplitterV2,
    insurance: string,
    asset: string
  ) {
   this.strategy = strategy;
   this.vault = vault;
   this.splitter = splitter;
   this.insurance = insurance;
   this.asset = asset
  }

  /**
   * Build UniswapV3ConverterStrategy for the given pool/asset
   */
  static async buildUniv3(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    core: CoreAddresses,
    asset: string,
    pool: string,
    gov: SignerWithAddress,
    p?: IConverterStrategyBaseContractsParams
  ): Promise<ConverterStrategyBaseContracts> {
    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset,
      'TetuV2_UniswapV3_USDC-USDT-0.01%',
      async(_splitterAddress: string) => {
        const _strategy = UniswapV3ConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          p?.converter || MaticAddresses.TETU_CONVERTER,
          MaticAddresses.UNISWAPV3_USDC_USDT_100,
          0,
          0,
          [0, 0, Misc.MAX_UINT, 0],
          [0, 0, Misc.MAX_UINT, 0],
        );

        return _strategy as unknown as IStrategyV2;
      },
      IController__factory.connect(core.controller, gov),
      gov,
      p?.buffer || 0,
      p?.depositFee || 300,
      p?.withdrawFee || 300,
      p?.wait || false,
    );

    const dest = new ConverterStrategyBaseContracts(
      ConverterStrategyBase__factory.connect(data.strategy.address, gov),
      data.vault,
      data.splitter,
      await data.vault.insurance(),
      asset
    );

    // setup converter
    const strategy = UniswapV3ConverterStrategy__factory.connect(data.strategy.address, gov);
    await ConverterUtils.whitelist([strategy.address], p?.converter || MaticAddresses.TETU_CONVERTER);
    const state = await PackedData.getDefaultState(strategy);
    await PriceOracleImitatorUtils.uniswapV3(signer, state.pool, state.tokenA)

    await IERC20__factory.connect(asset, signer).approve(data.vault.address, Misc.MAX_UINT);
    await IERC20__factory.connect(asset, signer2).approve(data.vault.address, Misc.MAX_UINT);

    await ControllerV2__factory.connect(core.controller, gov).registerOperator(signer.address);
    await data.vault.setWithdrawRequestBlocks(0);

    await ConverterUtils.disableAaveV2(signer)

    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
    await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, parseUnits('0.001', 6));

    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN]);
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address);

    return dest;
  }

  static async buildBalancer(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    core: CoreAddresses,
    asset: string,
    pool: string,
    gov: SignerWithAddress,
    p?: IConverterStrategyBaseContractsParams
  ): Promise<ConverterStrategyBaseContracts> {
    const converter = p?.converter || MaticAddresses.TETU_CONVERTER;
    const data = await UniversalTestUtils.makeStrategyDeployer(
      signer,
      core,
      asset,
      converter,
      'BalancerBoostedStrategy',
      async(strategyProxy: string, signerOrProvider: Signer | Provider, splitterAddress: string) => {
        const strategyContract = BalancerBoostedStrategy__factory.connect(strategyProxy, signer);
        await strategyContract.init(core.controller, splitterAddress, converter, pool, MaticAddresses.BALANCER_GAUGE_V2_T_USD);
        return strategyContract as unknown as IStrategyV2;
      },
      {
        depositFee: p?.depositFee || 300,
        buffer: p?.buffer || 0,
        withdrawFee: p?.withdrawFee || 300,
      },
    );

    const dest = new ConverterStrategyBaseContracts(
      ConverterStrategyBase__factory.connect(data.strategy.address, gov),
      data.vault,
      data.splitter,
      await data.vault.insurance(),
      asset
    );

    // setup converter
    const strategy = UniswapV3ConverterStrategy__factory.connect(data.strategy.address, gov);
    await ConverterUtils.whitelist([strategy.address], p?.converter || MaticAddresses.TETU_CONVERTER);

    await IERC20__factory.connect(asset, signer).approve(data.vault.address, Misc.MAX_UINT);
    await IERC20__factory.connect(asset, signer2).approve(data.vault.address, Misc.MAX_UINT);

    await ControllerV2__factory.connect(core.controller, gov).registerOperator(signer.address);

    await data.vault.setWithdrawRequestBlocks(0);


    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    await UniversalTestUtils.setCompoundRatio(strategy as unknown as IStrategyV2, signer2, COMPOUND_RATIO);
    await StrategyTestUtils.setThresholds(
      strategy as unknown as IStrategyV2,
      signer2,
      { reinvestThresholdPercent: REINVEST_THRESHOLD_PERCENT },
    );


    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)
    const pools = [
      {
        pool: MaticAddresses.UNISWAPV3_USDC_DAI_100,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.DAI_TOKEN,
        tokenOut: MaticAddresses.USDC_TOKEN,
      },
      {
        pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.USDT_TOKEN,
        tokenOut: MaticAddresses.USDC_TOKEN,
      },
    ]
    await tools.liquidator.connect(operator).addBlueChipsPools(pools, true)
    await tools.liquidator.connect(operator).addLargestPools(pools, true);

    return dest;
  }
}