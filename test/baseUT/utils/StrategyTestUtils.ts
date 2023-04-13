import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {
  ConverterStrategyBase__factory,
  IERC20__factory,
  IForwarder,
  IStrategyV2,
  ITetuLiquidator,
  TetuVaultV2,
  VaultFactory__factory
} from '../../../typechain';
import {BigNumber, utils} from 'ethers';
import {expect} from 'chai';
import {Misc} from '../../../scripts/utils/Misc';
import {DeployInfo} from './DeployInfo';
import logSettings from '../../../log_settings';
import {Logger} from 'tslog';
import {PriceCalculatorUtils} from '../../PriceCalculatorUtils';
import {TokenUtils} from '../../../scripts/utils/TokenUtils';
import {DeployerUtilsLocal} from '../../../scripts/utils/DeployerUtilsLocal';
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {UniversalTestUtils} from "./UniversalTestUtils";

const log: Logger<undefined> = new Logger(logSettings);

export interface ISetThresholdsInputParams {
  reinvestThresholdPercent?: number;
  rewardLiquidationThresholds?: {
    asset: string,
    threshold: BigNumber
  }[];
}

export interface IPutInitialAmountsBalancesResults {
  balanceUser: BigNumber;
  balanceSigner: BigNumber;
}

export class StrategyTestUtils {

  public static async checkStrategyRewardsBalance(strategy: IStrategyV2, balances: string[]) {
    const tokens: string[] = []; // await strategy.rewardTokens(); // TODO
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
    deposit: string,
  ) {
    const dec = await TokenUtils.decimals(underlying);
    const bal = await TokenUtils.balanceOf(underlying, user.address);
    log.info('balance', utils.formatUnits(bal, dec), bal.toString());
    expect(+utils.formatUnits(bal, dec))
      .is.greaterThanOrEqual(+utils.formatUnits(deposit, dec), 'not enough balance');
    const vaultForUser = vault.connect(user);
    await TokenUtils.approve(underlying, user, vault.address, deposit);
    log.info('deposit', BigNumber.from(deposit).toString());
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
    expect((await strategy.compoundRatio()).toNumber()).is.lessThanOrEqual(100_000);
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
      await TokenUtils.transfer(underlying, signer, recipient, balance.div(recipients.length + 1).toString());
    }
    const signerUnderlyingBalanceFinal = await TokenUtils.balanceOf(underlying, signer.address);
    Misc.printDuration('Get underlying finished for', start);
    return signerUnderlyingBalanceFinal;
  }

  public static async deployAndSetCustomSplitter(signer: SignerWithAddress, core: CoreAddresses) {
    const splitterImpl = await DeployerUtils.deployContract(signer, 'StrategySplitterV2');
    await VaultFactory__factory.connect(
      core.vaultFactory,
      await DeployerUtilsLocal.getControllerGovernance(signer),
    ).setSplitterImpl(splitterImpl.address);
  }

  /**
   * Set reinvest and reward-liquidation thresholds
   */
  public static async setThresholds(
    strategy: IStrategyV2,
    user: SignerWithAddress,
    params?: ISetThresholdsInputParams,
  ) {
    const operator = await UniversalTestUtils.getAnOperator(strategy.address, user);
    const strategyAsOperator = await ConverterStrategyBase__factory.connect(strategy.address, operator);
    if (params?.rewardLiquidationThresholds) {
      for (const p of params?.rewardLiquidationThresholds) {
        await strategyAsOperator.setLiquidationThreshold(p.asset, p.threshold);
      }
    }

    if (params?.reinvestThresholdPercent) {
      await strategyAsOperator.setReinvestThresholdPercent(params.reinvestThresholdPercent); // 100_000 / 100
    }
  }

  /**
   *  put DEPOSIT_AMOUNT => user, DEPOSIT_AMOUNT/2 => signer, DEPOSIT_AMOUNT/2 => liquidator
   */
  public static async putInitialAmountsToBalances(
    asset: string,
    user: SignerWithAddress,
    signer: SignerWithAddress,
    liquidator: ITetuLiquidator,
    amount: number,
  ): Promise<IPutInitialAmountsBalancesResults> {
    // put half of signer's balance to liquidator
    const signerBalance = await StrategyTestUtils.getUnderlying(user, asset, amount, liquidator, [signer.address]);
    await IERC20__factory.connect(asset, signer).transfer(liquidator.address, signerBalance.div(2));
    return {
      balanceSigner: await IERC20__factory.connect(asset, signer).balanceOf(signer.address),
      balanceUser: await IERC20__factory.connect(asset, signer).balanceOf(user.address),
    }
  }
}
