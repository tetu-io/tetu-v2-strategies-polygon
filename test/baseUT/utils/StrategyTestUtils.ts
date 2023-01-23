import {ICoreContractsWrapper} from "../../CoreContractsWrapper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IForwarder,
  ITetuLiquidator,
  TetuVaultV2,
  IStrategyV2,
} from "../../../typechain";
import {BigNumber, utils} from "ethers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {readFileSync} from "fs";
import {Misc} from "../../../scripts/utils/Misc";
import {DeployInfo} from "./DeployInfo";
import logSettings from "../../../log_settings";
import {Logger} from "tslog";
import {PriceCalculatorUtils} from "../../PriceCalculatorUtils";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {DeployerUtilsLocal, IVaultStrategyInfo} from "../../../scripts/utils/DeployerUtilsLocal";

const log: Logger = new Logger(logSettings);

export class StrategyTestUtils {

  public static async deploy(
    signer: SignerWithAddress,
    core: ICoreContractsWrapper,
    asset: string,
    vaultName: string,
    strategyDeployer: (vaultAddress: string) => Promise<IStrategyV2>,
    buffer = 0,
    depositFee = 0,
    withdrawFee = 0,
  ): Promise<IVaultStrategyInfo> {

    const start = Date.now();
    log.info("Starting deploy")
    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset,
      vaultName,
      strategyDeployer,
      core.controller,
      signer,
      buffer,
      depositFee,
      withdrawFee
    );
    const vault = data.vault;
    const strategy = data.strategy;

    expect((await strategy.asset()).toLowerCase()).is.eq(asset.toLowerCase());
    expect((await vault.asset()).toLowerCase()).is.eq(asset.toLowerCase());

    Misc.printDuration('Vault and strategy deployed and initialized', start);
    return {vault, strategy};
  }

  public static async checkStrategyRewardsBalance(strategy: IStrategyV2, balances: string[]) {
    const tokens:string[] = []; // await strategy.rewardTokens(); // TODO
    const cRatio = await strategy.compoundRatio();
    if (cRatio.toNumber() >= 1000) {
      return;
    }
    for (let i = 0; i < tokens.length; i++) {
      const rtDec = await TokenUtils.decimals(tokens[i]);
      const expected = utils.formatUnits(balances[i] || 0, rtDec);
      expect(+utils.formatUnits(await TokenUtils.balanceOf(tokens[i], strategy.address), rtDec))
        .is.approximately(+expected, 0.0000000001, 'strategy has wrong reward balance for ' + i);
    }
  }

  public static async deposit(
    user: SignerWithAddress,
    vault: TetuVaultV2,
    underlying: string,
    deposit: string
  ) {
    const dec = await TokenUtils.decimals(underlying);
    const bal = await TokenUtils.balanceOf(underlying, user.address);
    log.info('balance', utils.formatUnits(bal, dec), bal.toString());
    expect(+utils.formatUnits(bal, dec))
      .is.greaterThanOrEqual(+utils.formatUnits(deposit, dec), 'not enough balance')
    const vaultForUser = vault.connect(user);
    await TokenUtils.approve(underlying, user, vault.address, deposit);
    log.info('deposit', BigNumber.from(deposit).toString())
    await vaultForUser.deposit(BigNumber.from(deposit), user.address);
  }

  public static async saveStrategyRtBalances(strategy: IStrategyV2): Promise<BigNumber[]> {
    const rts: string[] = []; // await strategy.rewardTokens(); // TODO
    const balances: BigNumber[] = [];
    for (const rt of rts) {
      const b = await TokenUtils.balanceOf(rt, strategy.address);
      console.log('rt balance in strategy', rt, b);
      balances.push(b);
    }
    return balances;
  }

  public static async commonTests(strategy: IStrategyV2, underlying: string) {
    // TODO
    // expect(await strategy.unsalvageableTokens(underlying)).is.eq(true);
    // expect(await strategy.unsalvageableTokens(MaticAddresses.ZERO_ADDRESS)).is.eq(false);
    expect((await strategy.compoundRatio()).toNumber()).is.lessThanOrEqual(100_000)
    expect(await strategy.PLATFORM()).is.not.eq('');
    // expect((await strategy.assets()).length).is.not.eq(0);
    expect(!!(await strategy.totalAssets())).is.eq(true);
    // await strategy.emergencyExit();
    // expect(await strategy.pausedInvesting()).is.eq(true);
    // await strategy.continueInvesting();
    // expect(await strategy.pausedInvesting()).is.eq(false);
  }

  public static async initForwarder(forwarder: IForwarder) {
    const start = Date.now();
    // await forwarder.setLiquidityNumerator(30);
    // await forwarder.setLiquidityRouter(await DeployerUtilsLocal.getRouterByFactory(await DeployerUtilsLocal.getDefaultNetworkFactory()));
    // please set liquidation path for each test individually
    await StrategyTestUtils.setConversionPaths(forwarder);
    Misc.printDuration('Forwarder initialized', start);
  }

  public static async setConversionPaths(forwarder: IForwarder) {
    // TODO? Looks like we do not need to init Forwarder
    /*const net = (await ethers.provider.getNetwork()).chainId;
    const bc: string[] = JSON.parse(readFileSync(`./test/strategies/data/${net}/bc.json`, 'utf8'));

    const batch = 20;
    for (let i = 0; i < bc.length / batch; i++) {
      const l = bc.slice(i * batch, i * batch + batch)
      log.info('addBlueChipsLps', l.length);
      await forwarder.addBlueChipsLps(l);
    }

    const tokens: string[] = JSON.parse(readFileSync(`./test/strategies/data/${net}/tokens.json`, 'utf8'));
    const lps: string[] = JSON.parse(readFileSync(`./test/strategies/data/${net}/lps.json`, 'utf8'));
    for (let i = 0; i < tokens.length / batch; i++) {
      const t = tokens.slice(i * batch, i * batch + batch)
      const l = lps.slice(i * batch, i * batch + batch)
      // log.info('t', t)
      // log.info('l', l)
      log.info('addLargestLps', t.length);
      await forwarder.addLargestLps(t, l);
    }*/
  }

  public static async deployCoreAndInit(deployInfo: DeployInfo, deploy: boolean) {
    const signer = await DeployerUtilsLocal.impersonate();
    deployInfo.core = await DeployerUtilsLocal.getCoreAddressesWrapper(signer);
    deployInfo.tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
  }

  public static async getUnderlying(
    signer: SignerWithAddress,
    underlying: string,
    amountNum: number,
    liquidator: ITetuLiquidator,
    recipients: string[],
  ) {
    log.info('get underlying', amountNum, recipients.length, underlying);
    const start = Date.now();
    const underlyingName = await TokenUtils.tokenSymbol(underlying);
    const underlyingDecimals = await TokenUtils.decimals(underlying);
    const underlyingPrice = await PriceCalculatorUtils.getPriceCached(underlying, liquidator);
    const underlyingPriceNum = +utils.formatUnits(underlyingPrice);
    log.info('Underlying price: ', underlyingPriceNum, underlyingPrice);

    const amountAdjustedN = amountNum / underlyingPriceNum;
    const amountAdjusted = utils.parseUnits(amountAdjustedN.toFixed(underlyingDecimals), underlyingDecimals);
    log.info('Get underlying: ', underlyingName, amountAdjustedN);

    const amountAdjusted2 = amountAdjusted.mul(recipients.length + 1);

    const balance = amountAdjusted2;
    await TokenUtils.getToken(underlying, signer.address, amountAdjusted2);

    for (const recipient of recipients) {
      await TokenUtils.transfer(underlying, signer, recipient, balance.div(recipients.length + 1).toString())
    }
    const signerUnderlyingBalanceFinal = await TokenUtils.balanceOf(underlying, signer.address);
    Misc.printDuration('Get underlying finished for', start);
    return signerUnderlyingBalanceFinal;
  }

}
