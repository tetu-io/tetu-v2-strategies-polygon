import {BigNumber} from "ethers";
import {DoHardWorkLoopBase} from "./DoHardWorkLoopBase";
import hre from "hardhat";
import {
  BalancerComposableStableStrategy__factory,
  IBalancerGauge__factory, IController__factory,
  IERC20__factory,
  ISplitter__factory, IStrategyV2,
  StrategyBaseV2__factory
} from "../../../typechain";
import {MaticAddresses} from "../../../scripts/MaticAddresses";
import {writeFileSync} from "fs";
import {formatUnits} from "ethers/lib/utils";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtilsLocal, IVaultStrategyInfo} from "../../../scripts/utils/DeployerUtilsLocal";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {Misc} from "../../../scripts/utils/Misc";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";

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
  }
}

export interface IMakeStrategyDeployerInputParams {
  buffer?: number;
  depositFee?: number;
  withdrawFee?: number;
  wait?: boolean;
  vaultName?: string;
  strategyName?: string;
}

/**
 * Utils for universal test
 */
export class UniversalTestUtils {
  static async getStates(title: string, h: DoHardWorkLoopBase) : Promise<IState>{
    const gauge = "0x1c514fEc643AdD86aeF0ef14F4add28cC3425306";
    const balancerPool = "0x48e6b98ef6329f8f0a30ebb8c7c960330d648085";
    const bbAmDai = "0x178E029173417b1F9C8bC16DCeC6f697bC323746";
    const bbAmUsdc = "0xF93579002DBE8046c43FEfE86ec78b1112247BB8";
    const bbAmUsdt = "0xFf4ce5AAAb5a627bf82f4A571AB1cE94Aa365eA6";
    const splitterAddress = await h.vault.splitter();
    const insurance = await h.vault.insurance();
    const block = await hre.ethers.provider.getBlock("latest");

    const dest = {
      title,
      block: block.number,
      blockTimestamp: block.timestamp,
      signer: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, h.user).balanceOf(h.signer.address),
      },
      user: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, h.user).balanceOf(h.user.address),
      },
      strategy: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, h.user).balanceOf(h.strategy.address),
        usdt: await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, h.user).balanceOf(h.strategy.address),
        dai: await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, h.user).balanceOf(h.strategy.address),
        bal: await IERC20__factory.connect(MaticAddresses.BAL_TOKEN, h.user).balanceOf(h.strategy.address),
        bptPool: await IERC20__factory.connect(balancerPool, h.user).balanceOf(h.strategy.address),
        totalAssets: await h.strategy.totalAssets(),
        investedAssets: await StrategyBaseV2__factory.connect(h.strategy.address, h.user).investedAssets()
      },
      gauge: {
        strategyBalance: await IBalancerGauge__factory.connect(gauge, h.user).balanceOf(h.strategy.address),
      },
      balancerPool: {
        bbAmUsdc: await IERC20__factory.connect(bbAmUsdc, h.user).balanceOf(balancerPool),
        bbAmUsdt: await IERC20__factory.connect(bbAmUsdt, h.user).balanceOf(balancerPool),
        bbAmDai: await IERC20__factory.connect(bbAmDai, h.user).balanceOf(balancerPool),
      },
      splitter: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, h.user).balanceOf(splitterAddress),
        totalAssets: await ISplitter__factory.connect(splitterAddress, h.user).totalAssets(),
      },
      vault: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, h.user).balanceOf(h.vault.address),
        userShares: await h.vault.balanceOf(h.user.address),
        signerShares: await h.vault.balanceOf(h.signer.address),
        userUsdc: await h.vault.convertToAssets(await h.vault.balanceOf(h.user.address)),
        signerUsdc: await h.vault.convertToAssets(await h.vault.balanceOf(h.signer.address)),
        sharePrice: await h.vault.sharePrice(),
        totalSupply: await h.vault.totalSupply(),
        totalAssets: await h.vault.totalAssets(),
      },
      insurance: {
        usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, h.user).balanceOf(insurance),
      },
    }


    console.log("State", dest);
    return dest;
  }

  static async saveListStatesToCSV(pathOut: string, states: IState[]) {

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

  static getTotalUsdAmount(state: IState) : BigNumber {
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
  static outputProfit(states: IState[]) {
    if (states.length < 2) return;

    const enter: IState = states[0];
    const final: IState = states[states.length - 1];

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
    console.log("final.getTotalUsdAmount", this.getTotalUsdAmount(enter));
    console.log("Initial amount", initialAmount);
    console.log("Final amount", initialAmount);
    console.log("Total profit", amountNum);
    console.log("Duration in seconds", timeSeconds);
    console.log("Duration in days", timeSeconds / (24*60*60));
    console.log("Estimated APR, %", apr);

  }

  static async makeStrategyDeployer(
    core: CoreAddresses,
    asset: string,
    tetuConverterAddress: string,
    params?: IMakeStrategyDeployerInputParams
  ) : Promise<((signer: SignerWithAddress) => Promise<IVaultStrategyInfo>)> {
    return async (signer: SignerWithAddress) => {
      const controller = DeployerUtilsLocal.getController(signer);

      const strategyDeployer = async (splitterAddress: string) => {
        const strategyProxy = await DeployerUtils.deployProxy(signer, params?.strategyName || "strategy");
        const strategy = BalancerComposableStableStrategy__factory.connect(strategyProxy, signer);
        await strategy.init(core.controller, splitterAddress, tetuConverterAddress);
        return strategy as unknown as IStrategyV2;
      }

      const governance = await DeployerUtilsLocal.getControllerGovernance(signer);
      return DeployerUtilsLocal.deployAndInitVaultAndStrategy(
        asset,
        params?.vaultName || "vault",
        strategyDeployer,
        controller,
        governance,
        params?.buffer || 100,
        params?.depositFee || 250,
        params?.withdrawFee || 500,
        params?.wait || false
      );
    }
  }

  static async setCompoundRatio(strategy: IStrategyV2, user: SignerWithAddress, compoundRate?: number) {
    if (compoundRate) {
      const controller = await StrategyBaseV2__factory.connect(strategy.address, user).controller();
      const platformVoter = await IController__factory.connect(controller, user).platformVoter();
      const strategyAsPlatformVoter = await StrategyBaseV2__factory.connect(
        strategy.address,
        await Misc.impersonate(platformVoter)
      );
      await strategyAsPlatformVoter.setCompoundRatio(compoundRate);
    }
  }

  /**
   * Move all available {asset} from balance of the {user} to {liquidator}
   */
  static async removeExcessTokens(asset: string, user: SignerWithAddress, liquidator: string) {
    const excessBalance = await TokenUtils.balanceOf(asset, user.address);
    if (!excessBalance.isZero()) {
      await TokenUtils.transfer(asset, user, liquidator, excessBalance.toString());
    }
  }
}