import {HardhatUtils, POLYGON_NETWORK_ID} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {InjectUtils} from "../baseUT/strategies/InjectUtils";
import {
  ControllerV2__factory,
  ConverterStrategyBase__factory, IERC20__factory,
  IRebalancingV2Strategy__factory, KyberConverterStrategyEmergency,
  KyberConverterStrategyEmergency__factory,
  StrategySplitterV2__factory, TetuVaultV2__factory
} from "../../typechain";
import {IEventsSet} from "../baseUT/strategies/CaptureEvents";
import {Misc} from "../../scripts/utils/Misc";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {formatUnits} from "ethers/lib/utils";
import {IController__factory} from "../../typechain/factories/@tetu_io/tetu-converter/contracts/interfaces";

describe("Scb852-emergency-kyber @skip-on-coverage", () => {
  const BLOCK = -1;
  const STRATEGY = "0x792Bcc2f14FdCB9FAf7E12223a564e7459eA4201";
  const OPERATOR = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

  let snapshotBefore: string;
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID, BLOCK);
    snapshotBefore = await TimeUtils.snapshot();
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
    await HardhatUtils.restoreBlockFromEnv();
  });

  interface IBalances {
    signerUsdc: number;
    signerUsdt: number;
    strategyUsdc: number;
    strategyUsdt: number;
    governanceUsdc: number;
    governanceUsdt: number;
  }

  async function getBalances(signer: SignerWithAddress, strategy: KyberConverterStrategyEmergency, governance: string): Promise<IBalances> {
    return {
      signerUsdc: +formatUnits(await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, signer).balanceOf(signer.address), 6),
      signerUsdt: +formatUnits(await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(signer.address), 6),
      strategyUsdc: +formatUnits(await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, signer).balanceOf(strategy.address), 6),
      strategyUsdt: +formatUnits(await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(strategy.address), 6),
      governanceUsdc: +formatUnits(await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, signer).balanceOf(governance), 6),
      governanceUsdt: +formatUnits(await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(governance), 6),
    }
  }

  it("update kyber-strategy using flash loan, close debts, withdraw leftovers", async () => {
    const signer = await DeployerUtilsLocal.impersonate(OPERATOR);
    const strategy = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
    const states: IStateNum[] = [];
    const saver = async (title: string, e?: IEventsSet) => {
      const pathOut = "./tmp/scb-852.csv";
      const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
      states.push(state);
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
    };

    const converterStrategyBase = ConverterStrategyBase__factory.connect(strategy.address, signer);
    const vault = TetuVaultV2__factory.connect(
      await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer)).vault(),
      signer
    );

    const governance = await IController__factory.connect(await vault.controller(), signer).governance();

    await InjectUtils.injectStrategy(signer, STRATEGY, "KyberConverterStrategyEmergency");
    await saver("b");

    const kyberStrategy = KyberConverterStrategyEmergency__factory.connect(STRATEGY, await Misc.impersonate(OPERATOR));
    const directDebts = await kyberStrategy._emergencyGetDebtAmount(MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN);
    const reverseDebts = await kyberStrategy._emergencyGetDebtAmount(MaticAddresses.USDT_TOKEN, MaticAddresses.USDC_TOKEN);
    console.log("direct debts", directDebts);
    console.log("reverse", reverseDebts);

    const balancesBefore = await getBalances(signer, kyberStrategy, governance);
    console.log("Balances before", balancesBefore);

    await kyberStrategy.emergencyCloseDirectDebtsUsingFlashLoan();

    const balancesAfter = await getBalances(signer, kyberStrategy, governance);
    console.log("Balances after", balancesAfter);

    await saver("a");

    // salvage
    const balanceUsdc = await kyberStrategy.balanceOf(MaticAddresses.USDC_TOKEN);
    const balanceUsdt = await kyberStrategy.balanceOf(MaticAddresses.USDT_TOKEN);

    await kyberStrategy.salvage(MaticAddresses.USDC_TOKEN, balanceUsdc);
    await kyberStrategy.salvage(MaticAddresses.USDT_TOKEN, balanceUsdt);

    const balancesFinal = await getBalances(signer, kyberStrategy, governance);
    console.log("Balances final", balancesFinal);

    await saver("f");
  });
  it("apply kyber update", async () => {
    const VAULT = "0x0D397F4515007AE4822703b74b9922508837A04E";
    const SPLITTER = "0xA31cE671A0069020F7c87ce23F9cAAA7274C794c";
    const CONTROLLER = "0x33b27e0a2506a4a2fbc213a01c51d0451745343a";

    const signer = await DeployerUtilsLocal.impersonate(OPERATOR);
    const strategy = IRebalancingV2Strategy__factory.connect(STRATEGY, signer);
    const states: IStateNum[] = [];
    const governance = await IController__factory.connect(CONTROLLER, signer).governance();

    const controllerGov = await ControllerV2__factory.connect(CONTROLLER, await Misc.impersonate(governance));
    await controllerGov.upgradeProxy(["0x792Bcc2f14FdCB9FAf7E12223a564e7459eA4201"]);

    const kyberStrategy = KyberConverterStrategyEmergency__factory.connect(STRATEGY, await Misc.impersonate(OPERATOR));
    const directDebts = await kyberStrategy._emergencyGetDebtAmount(MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN);
    const reverseDebts = await kyberStrategy._emergencyGetDebtAmount(MaticAddresses.USDT_TOKEN, MaticAddresses.USDC_TOKEN);
    console.log("direct debts", directDebts);
    console.log("reverse", reverseDebts);

    const balancesBefore = await getBalances(signer, kyberStrategy, governance);
    console.log("Balances before", balancesBefore);

    await kyberStrategy.emergencyCloseDirectDebtsUsingFlashLoan();

    const balancesAfter = await getBalances(signer, kyberStrategy, governance);
    console.log("Balances after", balancesAfter);

    // salvage
    const balanceUsdc = await kyberStrategy.balanceOf(MaticAddresses.USDC_TOKEN);
    const balanceUsdt = await kyberStrategy.balanceOf(MaticAddresses.USDT_TOKEN);

    await kyberStrategy.salvage(MaticAddresses.USDC_TOKEN, balanceUsdc);
    await kyberStrategy.salvage(MaticAddresses.USDT_TOKEN, balanceUsdt);

    const balancesFinal = await getBalances(signer, kyberStrategy, governance);
    console.log("Balances final", balancesFinal);
  });
});