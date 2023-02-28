import {
  BalancerComposableStableStrategy,
  BalancerComposableStableStrategy__factory,
  IBalancerGauge__factory,
  IBorrowManager__factory,
  IConverterController__factory, IERC20__factory, ISplitter__factory,
  IStrategyV2,
  ITetuConverter__factory, ITetuLiquidator,
  StrategyBaseV2__factory,
  TetuVaultV2,
  VaultFactory__factory
} from "../../../../../typechain";
import {Misc} from "../../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../../scripts/MaticAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {DeployerUtilsLocal} from "../../../../../scripts/utils/DeployerUtilsLocal";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {BigNumber} from "ethers";
import hre from "hardhat";
import {writeFileSync} from "fs";
import {formatUnits} from "ethers/lib/utils";
import {UniversalTestUtils} from "../../../../baseUT/utils/UniversalTestUtils";
import {StrategyTestUtils} from "../../../../baseUT/utils/StrategyTestUtils";

export interface ISetThresholdsInputParams {
  reinvestThresholdPercent?: number;
  rewardLiquidationThresholds?: {
    asset: string,
    threshold: BigNumber
  }[];
}

/**
 * All balances
 */
export interface IState {
  title: string;
  block: number;
  blockTimestamp: number;
  signer: {
    usdc: BigNumber;
  }
  user: {
    usdc: BigNumber;
  }
  strategy: {
    usdc: BigNumber;
    usdt: BigNumber;
    dai: BigNumber;
    bal: BigNumber;
    bptPool: BigNumber;
    totalAssets: BigNumber;
    investedAssets: BigNumber;
  }
  gauge: {
    strategyBalance: BigNumber;
  }
  balancerPool: {
    bbAmUsdc: BigNumber;
    bbAmUsdt: BigNumber;
    bbAmDai: BigNumber;
  }
  splitter: {
    usdc: BigNumber;
    totalAssets: BigNumber;
  }
  vault: {
    usdc: BigNumber;
    userShares: BigNumber;
    signerShares: BigNumber;
    userUsdc: BigNumber;
    signerUsdc: BigNumber;
    sharePrice: BigNumber;
    totalSupply: BigNumber;
    totalAssets: BigNumber;
  },
  insurance: {
    usdc: BigNumber;
  },
  baseAmounts: {
    usdc: BigNumber;
    usdt: BigNumber;
    dai: BigNumber;
    bal: BigNumber;
  }
}

export interface IPutInitialAmountsBalancesResults {
  balanceUser: BigNumber;
  balanceSigner: BigNumber;
}

/**
 * Utils for integration tests of BalancerComposableStableStrategy
 */
export class BalancerIntTestUtils {
  /**
   * set up health factors in tetu converter
   * set min health factor 1.02
   * for dai and usdt set target health factor = 1.05
   */
  public static async setTetConverterHealthFactors(signer: SignerWithAddress, tetuConverter: string) {
    const controllerAddress = await ITetuConverter__factory.connect(tetuConverter, signer).controller();
    const controller = IConverterController__factory.connect(controllerAddress, signer);
    const governance = await controller.governance();
    const controllerAsGovernance = IConverterController__factory.connect(
      controllerAddress,
      await Misc.impersonate(governance)
    );

    const borrowManagerAddress = await controller.borrowManager();
    await controllerAsGovernance.setMinHealthFactor2(102);
    const borrowManagerAsGovernance = IBorrowManager__factory.connect(
      borrowManagerAddress,
      await Misc.impersonate(governance)
    );

    await controllerAsGovernance.setTargetHealthFactor2(112);
    await borrowManagerAsGovernance.setTargetHealthFactors(
      [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN, MaticAddresses.USDT_TOKEN],
      [112, 112, 112]
    );
  }

  /**
   * deploy own splitter to be able to add console messages to the splitter
   */
  public static async deployAndSetCustomSplitter(signer: SignerWithAddress, core: CoreAddresses) {
    const splitterImpl = await DeployerUtils.deployContract(signer, 'StrategySplitterV2')
    await VaultFactory__factory.connect(
      core.vaultFactory,
      await DeployerUtilsLocal.getControllerGovernance(signer)
    ).setSplitterImpl(splitterImpl.address);
  }

  /**
   * Set reinvest and reward-liquidation thresholds
   */
  public static async setThresholds(
    strategy: IStrategyV2,
    user: SignerWithAddress,
    params?: ISetThresholdsInputParams
  ) {
    const controller = await StrategyBaseV2__factory.connect(strategy.address, user).controller();
    // const platformVoter = await IController__factory.connect(controller, user).platformVoter();
    // const strategyAsPlatformVoter = await StrategyBaseV2__factory.connect(
    //   strategy.address,
    //   await Misc.impersonate(platformVoter)
    // );

    const operator = await UniversalTestUtils.getAnOperator(strategy.address, user);
    const strategyAsOperator = await BalancerComposableStableStrategy__factory.connect(strategy.address, operator);
    if (params?.rewardLiquidationThresholds) {
      for (const p of params?.rewardLiquidationThresholds) {
        await strategyAsOperator.setLiquidationThreshold(p.asset, p.threshold);
      }
    }

    if (params?.reinvestThresholdPercent) {
      await strategyAsOperator.setReinvestThresholdPercent(params.reinvestThresholdPercent); // 100_000 / 100
    }
  }

  public static async getState(
    signer: SignerWithAddress,
    user: SignerWithAddress,
    strategy: BalancerComposableStableStrategy,
    vault: TetuVaultV2,
    title?: string,
  ) : Promise<IState>{
    const gauge = "0x1c514fEc643AdD86aeF0ef14F4add28cC3425306";
    const balancerPool = "0x48e6b98ef6329f8f0a30ebb8c7c960330d648085";
    const bbAmDai = "0x178E029173417b1F9C8bC16DCeC6f697bC323746";
    const bbAmUsdc = "0xF93579002DBE8046c43FEfE86ec78b1112247BB8";
    const bbAmUsdt = "0xFf4ce5AAAb5a627bf82f4A571AB1cE94Aa365eA6";
    const splitterAddress = await vault.splitter();
    const insurance = await vault.insurance();
    const block = await hre.ethers.provider.getBlock("latest");

    // console.log("!", user.address, signer.address, balancerPool, bbAmUsdc);
    // // await IERC20__factory.connect(bbAmUsdc, user).balanceOf(balancerPool);
    // console.log("!!", user.address, signer.address, balancerPool, bbAmUsdt);
    // await IERC20__factory.connect(bbAmUsdt, signer).balanceOf(balancerPool);
    // console.log("!!!");
    // await IERC20__factory.connect(bbAmDai, user).balanceOf(balancerPool);
    console.log("!!!!");

    const dest = {
      title: title || "no-name",
      block: block.number,
      blockTimestamp: block.timestamp,
      signer: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(signer.address),
      },
      user: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(user.address),
      },
      strategy: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(strategy.address),
        usdt: await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, user).balanceOf(strategy.address),
        dai: await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, user).balanceOf(strategy.address),
        bal: await IERC20__factory.connect(MaticAddresses.BAL_TOKEN, user).balanceOf(strategy.address),
        bptPool: await IERC20__factory.connect(balancerPool, user).balanceOf(strategy.address),
        totalAssets: await strategy.totalAssets(),
        investedAssets: await StrategyBaseV2__factory.connect(strategy.address, user).investedAssets()
      },
      gauge: {
        strategyBalance: await IBalancerGauge__factory.connect(gauge, user).balanceOf(strategy.address),
      },
      balancerPool: {
        bbAmUsdc: await IERC20__factory.connect(bbAmUsdc, user).balanceOf(balancerPool),
        bbAmUsdt: await IERC20__factory.connect(bbAmUsdt, user).balanceOf(balancerPool),
        bbAmDai: await IERC20__factory.connect(bbAmDai, user).balanceOf(balancerPool),
      },
      splitter: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(splitterAddress),
        totalAssets: await ISplitter__factory.connect(splitterAddress, user).totalAssets(),
      },
      vault: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(vault.address),
        userShares: await vault.balanceOf(user.address),
        signerShares: await vault.balanceOf(signer.address),
        userUsdc: await vault.convertToAssets(await vault.balanceOf(user.address)),
        signerUsdc: await vault.convertToAssets(await vault.balanceOf(signer.address)),
        sharePrice: await vault.sharePrice(),
        totalSupply: await vault.totalSupply(),
        totalAssets: await vault.totalAssets(),
      },
      insurance: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, user).balanceOf(insurance),
      },
      baseAmounts: {
        usdc: await strategy.baseAmounts(MaticAddresses.USDC_TOKEN),
        usdt: await strategy.baseAmounts(MaticAddresses.USDT_TOKEN),
        dai: await strategy.baseAmounts(MaticAddresses.DAI_TOKEN),
        bal: await strategy.baseAmounts(MaticAddresses.BAL_TOKEN),
      }
    }


    console.log("State", dest);
    return dest;
  }

  public static async saveListStatesToCSV(pathOut: string, states: IState[]) {

    const headers = [
      "title",
      "block",
      "timestamp",

      "$signer",
      "$user",

      "vault-user-shares",
      "vault-signer-shares",

      "vault-$user",
      "vault-signer",

      "sharePrice-vault",
      "totalSupply-vault",
      "totalAssets-vault",

      "$insurance",
      "$strategy",
      "usdt-strategy",
      "dai-strategy",
      "bal-strategy",
      "bptp-strategy",
      "totalAssets-strategy",
      "investedAssets-strategy",
      "bptp-gauge",
      "$vault",
      "$splitter",
      "totalAssets-splitter",
      "bbAmUsdc-pool",
      "bbAmUsdt-pool",
      "bbAmDai-pool",
    ];
    const decimalsSharedPrice = 6;
    const decimalsUSDC = 6;
    const decimalsUSDT = 6;
    const decimalsDAI = 18;
    const decimalsBAL = 18;
    const decimalsBbAmUsdc = 18;
    const decimalsBbAmUsdt = 18;
    const decimalsBbAmDai = 18;
    const decimalsBptp = 18;
    const decimals = [
      0,
      0,
      0,
      decimalsUSDC, // signer.usdc
      decimalsUSDC, // user.usdc
      decimalsUSDC, // vault.userShares
      decimalsUSDC, // vault.signerShares
      decimalsUSDC, // vault.userUsdc
      decimalsUSDC, // vault.signerUsdc
      decimalsSharedPrice, // shared price
      decimalsUSDC, // vault.totlaSupply
      decimalsUSDC, // vault.totalAssets
      decimalsUSDC, // insurance.usdc
      decimalsUSDC, // strategy.usdc
      decimalsUSDT, // strategy.usdt
      decimalsDAI, // strategy.dai
      decimalsBAL, // strategy.bal
      decimalsBptp, // strategy.bptPool
      decimalsUSDC, // strategy.totalAssets
      decimalsUSDC, // strategy.investedAssets
      decimalsBptp, // gauge.strategyBalance
      decimalsUSDC, // vault.usdc
      decimalsUSDC, // splitter.usdc
      decimalsUSDC, // splitter.totalAssets,
      decimalsBbAmUsdc,
      decimalsBbAmUsdt,
      decimalsBbAmDai
    ];
    writeFileSync(pathOut, headers.join(";") + "\n", {encoding: 'utf8', flag: "a" });
    for (const item of states) {
      const line = [
        item.title,
        item.block,
        item.blockTimestamp,

        item.signer.usdc,
        item.user.usdc,

        item.vault.userShares,
        item.vault.signerShares,

        item.vault.userUsdc,
        item.vault.signerUsdc,

        item.vault.sharePrice,
        item.vault.totalSupply,
        item.vault.totalAssets,

        item.insurance.usdc,
        item.strategy.usdc,
        item.strategy.usdt,
        item.strategy.dai,
        item.strategy.bal,
        item.strategy.bptPool,
        item.strategy.totalAssets,
        item.strategy.investedAssets,
        item.gauge.strategyBalance,
        item.vault.usdc,
        item.splitter.usdc,
        item.splitter.totalAssets,
        item.balancerPool.bbAmUsdc,
        item.balancerPool.bbAmUsdt,
        item.balancerPool.bbAmDai
      ];
      writeFileSync(pathOut,
        line.map((x, index) =>
          typeof x === "object"
            ? +formatUnits(x, decimals[index])
            : "" + x
        ).join(";") + "\n",
        {encoding: 'utf8', flag: "a"}
      );
    }
  }

  public static getTotalUsdAmount(state: IState) : BigNumber {
    return state.user.usdc.add(
      state.signer.usdc
    ).add(
      state.vault.usdc
    ).add(
      state.insurance.usdc
    ).add(
      state.strategy.usdc
    ).add(
      state.splitter.usdc
    );
  }

  /**
   * Get initial state marked as "enter"
   * and final state marked as "final"
   * @param states
   */
  public static outputProfit(states: IState[]) {
    if (states.length < 2) return;

    const enter: IState = states[0];
    const final: IState = states[states.length - 1];

    this.outputProfitEnterFinal(enter, final);
  }

  public static outputProfitEnterFinal(enter: IState, final: IState) {
    // ethereum timestamp is in seconds
    // https://ethereum.stackexchange.com/questions/7853/is-the-block-timestamp-value-in-solidity-seconds-or-milliseconds
    const timeSeconds = (final.blockTimestamp - enter.blockTimestamp);
    const initialAmount = this.getTotalUsdAmount((enter));
    const finalAmount = this.getTotalUsdAmount(final);
    const amount = finalAmount.sub(initialAmount);
    const amountNum = +formatUnits(amount, 6);
    const apr = amountNum * 365
      / (timeSeconds / (24*60*60))
      / +formatUnits(initialAmount, 6)
      * 100;
    console.log("final.blockTimestamp", final.blockTimestamp);
    console.log("enter.blockTimestamp", enter.blockTimestamp);
    console.log("final.getTotalUsdAmount", this.getTotalUsdAmount(final));
    console.log("enter.getTotalUsdAmount", this.getTotalUsdAmount(enter));
    console.log("Initial amount", initialAmount);
    console.log("Final amount", initialAmount);
    console.log("Total profit", amountNum);
    console.log("Duration in seconds", timeSeconds);
    console.log("Duration in days", timeSeconds / (24*60*60));
    console.log("Estimated APR, %", apr);
  }

  /**
   *  put DEPOSIT_AMOUNT => user, DEPOSIT_AMOUNT/2 => signer, DEPOSIT_AMOUNT/2 => liquidator
   */
  public static async putInitialAmountsToBalances(
    asset: string,
    user: SignerWithAddress,
    signer: SignerWithAddress,
    liquidator: ITetuLiquidator,
    amount: number
  ) : Promise<IPutInitialAmountsBalancesResults>{
    const userBalance = await StrategyTestUtils.getUnderlying(user, asset, amount, liquidator, [signer.address]);

    // put half of signer's balance to liquidator
    const signerBalance = userBalance;
    await IERC20__factory.connect(asset, signer).transfer(liquidator.address, signerBalance.div(2));
    return {
      balanceSigner: await IERC20__factory.connect(asset, signer).balanceOf(signer.address),
      balanceUser: await IERC20__factory.connect(asset, signer).balanceOf(user.address),
    }
  }

}