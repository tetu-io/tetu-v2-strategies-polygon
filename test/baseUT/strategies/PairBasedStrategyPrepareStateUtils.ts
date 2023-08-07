import {IBuilderResults} from "./PairBasedStrategyBuilder";
import {
    AlgebraLib,
    ControllerV2__factory,
    ConverterStrategyBase__factory,
    KyberLib,
    UniswapV3Lib
} from "../../../typechain";
import {PackedData} from "../utils/PackedData";
import {BigNumber} from "ethers";
import {PairStrategyLiquidityUtils} from "./PairStrategyLiquidityUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {UniversalUtils} from "./UniversalUtils";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {IERC20Metadata__factory} from "../../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {getConverterAddress, Misc} from "../../../scripts/utils/Misc";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "./AppPlatforms";

/**
 * Utils to set up "current state of pair strategy" in tests
 */
export class PairBasedStrategyPrepareStateUtils {

  static getLib(platform: string, b: IBuilderResults): UniswapV3Lib | AlgebraLib | KyberLib {
    return platform === PLATFORM_ALGEBRA
      ? b.libAlgebra
      : platform === PLATFORM_KYBER
        ? b.libKyber
        : b.libUniv3;
  }

  /** Set up "neeRebalance = true" */
  static async prepareNeedRebalanceOn(signer: SignerWithAddress, signer2: SignerWithAddress, b: IBuilderResults) {
    const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);
    const platform = await converterStrategyBase.PLATFORM();
    const state = await PackedData.getDefaultState(b.strategy);

    // move strategy to "need to rebalance" state
    const lib = this.getLib(platform, b);
    let countRebalance = 0;
    for (let i = 0; i < 10; ++i) {
      const swapAmount = await this.getSwapAmount2(
        signer,
        b,
        state.tokenA,
        state.tokenB,
        true,
        0.1
      );
      await UniversalUtils.movePoolPriceUp(signer2, state.pool, state.tokenA, state.tokenB, b.swapper, swapAmount, 40000);
      if (await b.strategy.needRebalance()) {
        if (countRebalance === 0) {
          await b.strategy.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
          countRebalance++;
        } else {
          break;
        }
      }
    }
  }

  /** Setup fuse thresholds. Values are selected relative to the current prices */
  static async prepareFuse(b: IBuilderResults, triggerOn: boolean) {
    console.log("activate fuse ON");
    // lib.getPrice gives incorrect value of the price of token A (i.e. 1.001734 instead of 1.0)
    // so, let's use prices from the oracle

    const pricesAB = await b.facadeLib2.getOracleAssetsPrices(b.converter.address, MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN);
    const priceA = +formatUnits(pricesAB[0], 18).toString();
    const priceB = +formatUnits(pricesAB[1], 18).toString();
    console.log("priceA, priceB", priceA, priceB);

    const ttA = [priceA - 0.0008, priceA - 0.0006, priceA + 0.0008, priceA + 0.0006].map(x => parseUnits(x.toString(), 18));
    const ttB = [
      priceB - 0.0008,
      priceB - 0.0006,
      priceB + (triggerOn ? -0.0001 : 0.0004), // (!) fuse ON/OFF
      priceB + (triggerOn ? -0.0002 : 0.0002),
    ].map(x => parseUnits(x.toString(), 18));

    await b.strategy.setFuseThresholds(0, [ttA[0], ttA[1], ttA[2], ttA[3]]);
    await b.strategy.setFuseThresholds(1, [ttB[0], ttB[1], ttB[2], ttB[3]]);
  }

  /** Put addition amounts of tokenA and tokenB to balance of the profit holder */
  static async prepareToHardwork(signer: SignerWithAddress, b: IBuilderResults) {
    const state = await PackedData.getDefaultState(b.strategy);

    await TokenUtils.getToken(
      state.tokenA,
      state.profitHolder,
      parseUnits('100', await IERC20Metadata__factory.connect(state.tokenA, signer).decimals())
    );
    await TokenUtils.getToken(
      state.tokenB,
      state.profitHolder,
      parseUnits('100', await IERC20Metadata__factory.connect(state.tokenB, signer).decimals())
    );
  }

  /**
   * Deploy new implemenation of TetuConverter-contract and upgrade proxy
   */
  static async injectTetuConverter(signer: SignerWithAddress) {
    const core = await DeployerUtilsLocal.getCoreAddresses();
    const tetuConverter = getConverterAddress();

    const converterLogic = await DeployerUtils.deployContract(signer, "TetuConverter");
    const controller = ControllerV2__factory.connect(core.controller, signer);
    const governance = await controller.governance();
    const controllerAsGov = controller.connect(await Misc.impersonate(governance));

    await controllerAsGov.announceProxyUpgrade([tetuConverter], [converterLogic.address]);
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerAsGov.upgradeProxy([tetuConverter]);
  }

  /**
   * Get swap amount to move price up/down in the pool
   * @param signer
   * @param b
   * @param tokenA
   * @param tokenB
   * @param priceTokenBUp
   *  true - move price of token B up == swap A to B
   *  false - move price of token B down == swap B to A
   * @param overlapRatio
   *  amount to swap = amount in the current tick * (1 + overlapRatio)
   *  Value >= 0
   * @return
   *  priceTokenBUp === true: amount of token A to swap
   *  priceTokenBUp === false: amount of token B to swap
   */
  static async getSwapAmount2(
    signer: SignerWithAddress,
    b: IBuilderResults,
    tokenA: string,
    tokenB: string,
    priceTokenBUp: boolean,
    overlapRatio: number
  ): Promise<BigNumber> {
    const platform = await ConverterStrategyBase__factory.connect(b.strategy.address, signer).PLATFORM();
    const lib = this.getLib(platform, b);
    const pricesAB = await b.facadeLib2.getOracleAssetsPrices(b.converter.address, MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN);

    const amountsInCurrentTick = await PairStrategyLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, platform, lib, b.pool);
    console.log("amountsInCurrentTick", amountsInCurrentTick);

    if (priceTokenBUp) {
      // calculate amount B that we are going to receive
      const amountBOut = amountsInCurrentTick[1].mul(
        Misc.ONE18.add(parseUnits(overlapRatio.toString(), 18))
      ).div(Misc.ONE18);

      console.log("amountBOut", amountBOut);
      const amountAIn = await PairStrategyLiquidityUtils.quoteExactOutputSingle(
        signer,
        b,
        tokenA,
        tokenB,
        amountBOut
      );
      console.log("amountAIn.to.up", amountAIn);
      return amountAIn;
    } else {
      // calculate amount A that we are going to receive
      const amountAOut = amountsInCurrentTick[0].mul(
        Misc.ONE18.add(parseUnits(overlapRatio.toString(), 18))
      ).div(Misc.ONE18);

      console.log("amountAOut", amountAOut);
      const amountBIn = await PairStrategyLiquidityUtils.quoteExactOutputSingle(
        signer,
        b,
        tokenB,
        tokenA,
        amountAOut
      );
      console.log("amountBIn.to.down", amountBIn);
      return amountBIn;
    }
  }
}