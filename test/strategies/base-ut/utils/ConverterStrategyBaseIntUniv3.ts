import {
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

export class ConverterStrategyBaseIntUniv3 {
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
  static async build(
    signer: SignerWithAddress,
    signer2: SignerWithAddress,
    core: CoreAddresses,
    asset: string,
    pool: string,
    gov: SignerWithAddress
  ): Promise<ConverterStrategyBaseIntUniv3> {
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
          MaticAddresses.TETU_CONVERTER,
          MaticAddresses.UNISWAPV3_USDC_USDT_100,
          0,
          0,
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

    const dest = new ConverterStrategyBaseIntUniv3(
      ConverterStrategyBase__factory.connect(data.strategy.address, gov),
      data.vault,
      data.splitter,
      await data.vault.insurance(),
      asset
    );

    // setup converter
    const strategy = UniswapV3ConverterStrategy__factory.connect(data.strategy.address, gov);
    await ConverterUtils.whitelist([strategy.address]);
    const state = await strategy.getState();
    await PriceOracleImitatorUtils.uniswapV3(signer, state.pool, state.tokenA)

    await IERC20__factory.connect(asset, signer).approve(data.vault.address, Misc.MAX_UINT);
    await IERC20__factory.connect(asset, signer2).approve(data.vault.address, Misc.MAX_UINT);

    await ControllerV2__factory.connect(core.controller, gov).registerOperator(signer.address);

    await data.vault.setWithdrawRequestBlocks(0);

    return dest;
  }
}