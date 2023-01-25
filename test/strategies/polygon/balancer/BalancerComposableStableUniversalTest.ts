import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {startDefaultStrategyTest} from "../../base/DefaultSingleTokenStrategyTest";
import {config as dotEnvConfig} from "dotenv";
import {DeployInfo} from "../../../baseUT/utils/DeployInfo";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {
  BalancerComposableStableStrategy__factory, IBalancerGauge__factory, IERC20__factory, ISplitter__factory,
  IStrategyV2, StrategyBaseV2__factory
} from "../../../../typechain";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import { getConverterAddress } from '../../../../scripts/utils/Misc';
import {BigNumber} from "ethers";
import {DoHardWorkLoopBase} from "../../../baseUT/utils/DoHardWorkLoopBase";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";
import {writeFileSync} from "fs";
import {formatUnits} from "ethers/lib/utils";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: "boolean",
      default: false,
    },
    hardhatChainId: {
      type: "number",
      default: 137
    },
  }).argv;

// const {expect} = chai;
chai.use(chaiAsPromised);

interface IState {
  title: string;
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

async function getStates(title: string, h: DoHardWorkLoopBase) : Promise<IState>{
  const gauge = "0x1c514fEc643AdD86aeF0ef14F4add28cC3425306";
  const balancerPool = "0x48e6b98ef6329f8f0a30ebb8c7c960330d648085";
  const bbAmDai = "0x178E029173417b1F9C8bC16DCeC6f697bC323746";
  const bbAmUsdc = "0xF93579002DBE8046c43FEfE86ec78b1112247BB8";
  const bbAmUsdt = "0xFf4ce5AAAb5a627bf82f4A571AB1cE94Aa365eA6";
  const splitterAddress = await h.vault.splitter();
  const insurance = await h.vault.insurance();

  const dest = {
    title,
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
      userUsdc: await h.vault.balanceOf(h.user.address),
      signerUsdc: await h.vault.balanceOf(h.signer.address),
      sharePrice: await h.vault.sharePrice(),
      totalSupply: await h.vault.totalSupply(),
      totalAssets: await h.vault.totalAssets(),
    },
    insurance: {
      usdc: await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, h.user).balanceOf(insurance),
    }
  }

  console.log("State", dest);
  return dest;
}

describe('BalancerComposableStableUniversalTest', async () => {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  const deployInfo: DeployInfo = new DeployInfo();
  const states: IState[] = [];

  before(async function () {
    await StrategyTestUtils.deployCoreAndInit(deployInfo, argv.deployCoreContracts);
  });

  /** Save collected state to csv */
  after(async function() {
    const pathOut = "./tmp/ts2-snapshots.csv";

    const headers = [
      "title",
      "$signer",
      "$user",
      "vault-$user",
      "vault-$signer",
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
      decimalsUSDC, // signer.usdc
      decimalsUSDC, // user.usdc
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
        item.signer.usdc,
        item.user.usdc,
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
  });

  const strategyName = 'BalancerComposableStableStrategy';
  const assetName = 'USDC';
  const asset = PolygonAddresses.USDC_TOKEN;
  const vaultName = 'tetu' + assetName;
  const core = Addresses.getCore();

  const deployer = async (signer: SignerWithAddress) => {
    const controller = DeployerUtilsLocal.getController(signer);

    const strategyDeployer = async (splitterAddress: string) => {
      const strategy = BalancerComposableStableStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, strategyName),
        signer
      );

      await strategy.init(
        core.controller,
        splitterAddress,
        getConverterAddress(),
      );

      // Disable DForce (as it reverts on repay after block advance)
      await ConverterUtils.disableDForce(signer);

      return strategy as unknown as IStrategyV2;
    }

    console.log('getControllerGovernance...');
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    console.log('deployAndInitVaultAndStrategy...');
    return DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset, vaultName, strategyDeployer, controller, gov,
      100, 250, 500, false
    );
  }

  /* tslint:disable:no-floating-promises */
  await startDefaultStrategyTest(
    strategyName,
    asset,
    assetName,
    deployInfo,
    deployer,
    async (title, h) => {
      states.push(await getStates(title, h));
    }
  );
});
