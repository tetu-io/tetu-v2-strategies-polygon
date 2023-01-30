import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ICoreContractsWrapper} from "../../CoreContractsWrapper";
import {
  BalancerComposableStableStrategy__factory, ControllerV2__factory,
  IBalancerGauge__factory, IController__factory,
  IERC20__factory, ISplitter__factory,
  IStrategyV2,
  StrategyBaseV2__factory,
  TetuVaultV2
} from "../../../typechain";
import {IToolsContractsWrapper} from "../../ToolsContractsWrapper";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {BigNumber, utils} from "ethers";
import {Misc} from "../../../scripts/utils/Misc";
import {PPFS_NO_INCREASE, VaultUtils} from "../../VaultUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {PriceCalculatorUtils} from "../../PriceCalculatorUtils";
import {MaticAddresses} from "../../../scripts/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";

interface IBalances {
  userBalance: BigNumber;
  signerBalance: BigNumber;
}

export interface IDoHardWorkLoopInputParams {
  /// 50_000 for 0.5
  compoundRate?: number;
  /// 1000 for 1%
  reinvestThresholdPercent?: number;
}

export class DoHardWorkLoopBase {

  public readonly signer: SignerWithAddress;
  public readonly user: SignerWithAddress;
  public readonly core: ICoreContractsWrapper;
  public readonly tools: IToolsContractsWrapper;
  public readonly underlying: string;
  public readonly vault: TetuVaultV2;
  public readonly strategy: IStrategyV2;
  public readonly balanceTolerance: number;
  public readonly finalBalanceTolerance: number;

  vaultAsUser: TetuVaultV2;
  underlyingDecimals = 0;

  loops = 0;
  startTs = 0;
  cRatio = 0;
  isUserDeposited = true;
  stratEarned = BigNumber.from(0);
  priceCache = new Map<string, BigNumber>();
  totalToClaimInTetuN = 0;
  toClaimCheckTolerance = 0.3;

  feeDenominator = BigNumber.from(100_000);
  depositFee = BigNumber.from(0);
  withdrawFee = BigNumber.from(0);

  initialDepositWithFee = BigNumber.from(0);

  initialBalances: IBalances;

  constructor(
    signer: SignerWithAddress,
    user: SignerWithAddress,
    core: ICoreContractsWrapper,
    tools: IToolsContractsWrapper,
    underlying: string,
    vault: TetuVaultV2,
    strategy: IStrategyV2,
    balanceTolerance: number,
    finalBalanceTolerance: number,
  ) {
    this.signer = signer;
    this.user = user;
    this.core = core;
    this.tools = tools;
    this.underlying = underlying;
    this.vault = vault;
    this.strategy = strategy;
    this.balanceTolerance = balanceTolerance;
    this.finalBalanceTolerance = finalBalanceTolerance;

    this.vaultAsUser = vault.connect(user);
    this.initialBalances = {
      userBalance: BigNumber.from(0),
      signerBalance: BigNumber.from(0)
    }
  }

  public async start(
    deposit: BigNumber,
    loops: number,
    loopValue: number,
    advanceBlocks: boolean,
    params: IDoHardWorkLoopInputParams,
    stateRegistrar?: (title: string, h: DoHardWorkLoopBase) => Promise<void>
  ) {
    const start = Date.now();
    this.loops = loops;
    await this.init(params);
    this.initialDepositWithFee = this.subDepositFee(deposit); // call it after fees init()

    // put half of signer's balance to liquidator
    await IERC20__factory.connect(this.underlying, this.signer).transfer(this.tools.liquidator.address, deposit.div(2));

    if (stateRegistrar) {
      await stateRegistrar("init", this);
    }

    // user enters to vault with all "deposit" amount, signer enters with "depoit/2"
    await this.enterToVault();
    await this.initialSnapshot();
    if (stateRegistrar) {
      await stateRegistrar("beforeLoop", this);
    }
    await this.loop(loops, loopValue, advanceBlocks, stateRegistrar);
    await this.postLoopCheck();
    Misc.printDuration('HardWork test finished', start);
    if (stateRegistrar) {
      await stateRegistrar("final", this);
    }
  }

//region Fee utils
  protected calcDepositFee(amount: BigNumber): BigNumber {
    return amount.mul(this.depositFee).div(this.feeDenominator);
  }
  protected subDepositFee(amount: BigNumber): BigNumber {
    return amount.sub(this.calcDepositFee(amount));
  }

  protected addWithdrawFee(amount: BigNumber): BigNumber {
    return amount.mul(this.feeDenominator).div(this.feeDenominator.sub(this.withdrawFee));
  }
  protected calcWithdrawFee(amount: BigNumber): BigNumber {
    return amount.mul(this.withdrawFee).div(this.feeDenominator);
  }
  protected subWithdrawFee(amount: BigNumber): BigNumber {
    return amount.sub(this.calcWithdrawFee(amount));
  }
//endregion Fee utils

//region Initialization
  protected async init(
    params: IDoHardWorkLoopInputParams
  ) {
    this.underlyingDecimals = await TokenUtils.decimals(this.underlying);
    this.feeDenominator = await this.vault.FEE_DENOMINATOR();
    this.depositFee = await this.vault.depositFee();
    this.withdrawFee = await this.vault.withdrawFee();

    this.initialBalances = {
      userBalance: await this.userBalance(),
      signerBalance: await TokenUtils.balanceOf(this.underlying, this.signer.address)
    }
    console.log("initialBalances", this.initialBalances);

    const controller = await StrategyBaseV2__factory.connect(this.strategy.address, this.user).controller();
    const platformVoter = await IController__factory.connect(controller, this.user).platformVoter();
    const strategyAsPlatformVoter = await StrategyBaseV2__factory.connect(
      this.strategy.address,
      await Misc.impersonate(platformVoter)
    );
    if (params.compoundRate) {
      await strategyAsPlatformVoter.setCompoundRatio(params.compoundRate);
    }

    const controllerAsUser = await ControllerV2__factory.connect(controller, this.user);
    const operators = await controllerAsUser.operatorsList();
    const strategyAsOperator = await BalancerComposableStableStrategy__factory.connect(
      strategyAsPlatformVoter.address,
      await Misc.impersonate(operators[0])
    );
    // await strategyAsOperator.setRewardLiquidationThreshold(MaticAddresses.USDC_TOKEN, parseUnits("100", 6)); // TODO
    if (params.reinvestThresholdPercent) {
      await strategyAsOperator.setReinvestThresholdPercent(params.reinvestThresholdPercent); // 100_000 / 100
    }
  }

  protected async initialSnapshot() {
    console.log('>>>initialSnapshot start')
    // TODO capture initial asset and reward balances

    this.startTs = await Misc.getBlockTsFromChain();
    this.cRatio = (await this.strategy.compoundRatio()).toNumber();
    console.log('initialSnapshot end')
  }

  /**
   * signer and user enter to the vault
   * we should have not zero balance if user exit the vault for properly check
   */
  protected async enterToVault() {
    console.log('--- Enter to vault')

    const balanceUser = await TokenUtils.balanceOf(this.underlying, this.user.address);
    const balanceSigner = await TokenUtils.balanceOf(this.underlying, this.signer.address);

    // initial deposit from signer
    await VaultUtils.deposit(this.signer, this.vault, balanceSigner);
    console.log('enterToVault: deposited for signer');

    // initial deposit from user
    await this.initialDepositFromUser(balanceUser);
    console.log('enterToVault: deposited for user');

    // remove excess tokens
    const excessBalUser = await TokenUtils.balanceOf(this.underlying, this.user.address);
    if (!excessBalUser.isZero()) {
      await TokenUtils.transfer(this.underlying, this.user, this.tools.liquidator.address, excessBalUser.toString());
    }
    const excessBalSigner = await TokenUtils.balanceOf(this.underlying, this.signer.address);
    if (!excessBalSigner.isZero()) {
      await TokenUtils.transfer(this.underlying, this.signer, this.tools.liquidator.address, excessBalSigner.toString());
    }

    expect(await TokenUtils.balanceOf(this.underlying, this.user.address)).eq(0);
    console.log('--- Enter to vault end')
  }

  protected async initialDepositFromUser(amount: BigNumber) {
    console.log('INITIAL DEPOSIT from user', amount.toString());

    await VaultUtils.deposit(this.user, this.vault, amount);
    expect(await this.userBalanceInVault()).gte(this.subDepositFee(amount));

  }
//endregion Initialization

//region Loop
  protected async loop(
    loops: number,
    loopValue: number,
    advanceBlocks: boolean,
    stateRegistrar?: (title: string, h: DoHardWorkLoopBase) => Promise<void>,
  ) {
    console.log('loop... loops, loopValue, advanceBlocks', loops, loopValue, advanceBlocks);
    for (let i = 0; i < loops; i++) {
      console.log('\n=====================\nloop i', i);
      const start = Date.now();

      // *********** DO HARD WORK **************
      if (advanceBlocks) {
        await TimeUtils.advanceNBlocks(loopValue);
      } else {
        await TimeUtils.advanceBlocksOnTs(loopValue);
      }
      await this.doHardWork();
      // await this.loopPrintROIAndSaveEarned(i);
      await this.loopEndCheck();
      await this.loopEndActions(i, loops);
      Misc.printDuration(i + ' Loop ended', start);
      if (stateRegistrar) {
        await stateRegistrar(i.toString(), this);
      }
    }
  }

  protected async loopEndCheck() {
    // ** check to claim
    if (this.totalToClaimInTetuN !== 0 && this.cRatio !== 0) {
      const earnedN = +utils.formatUnits(this.stratEarned);
      const earnedNAdjusted = earnedN / (this.cRatio / 10000);
      expect(earnedNAdjusted).is.greaterThanOrEqual(this.totalToClaimInTetuN * this.toClaimCheckTolerance); // very approximately
    }
  }

//region End actions
  /** Simplest version: single deposit, single withdrawing */
  protected async loopEndActions(i: number, numberLoops: number) {
    console.log("loopEndActions", i);
    const start = Date.now();
    // we need to enter and exit from the vault between loops for properly check all mechanic
    if (i === numberLoops - 1) {
      this.isUserDeposited = false;
      console.log("!!!Withdraw all");
      await this.withdraw(true, BigNumber.from(0));
    // } else if (i === 0) {
    //   this.isUserDeposited = true;
    //   const underlyingBalance = await TokenUtils.balanceOf(this.underlying, this.user.address);
    //   console.log("!!!Deposit", BigNumber.from(underlyingBalance));
    //   await this.deposit(BigNumber.from(underlyingBalance));
    }
    Misc.printDuration('fLoopEndActions completed', start);
  }

  protected async loopEndActionsMain(i: number) {
    console.log("loopEndActions", i);
    const start = Date.now();
    // we need to enter and exit from the vault between loops for properly check all mechanic
    if (this.isUserDeposited && i % 2 === 0) {
      this.isUserDeposited = false;
      if (i % 4 === 0) {
        console.log("!!!Withdraw all");
        await this.withdraw(true, BigNumber.from(0));
      } else {
        const userXTokenBal = await TokenUtils.balanceOf(this.vault.address, this.user.address);
        const userAssetsBal = await this.vaultAsUser.convertToAssets(userXTokenBal);
        const toWithdraw = BigNumber.from(userAssetsBal).mul(95).div(100);
        console.log("!!!Withdraw", toWithdraw);
        await this.withdraw(false, toWithdraw);
      }

    } else if (!this.isUserDeposited && i % 2 !== 0) {
      this.isUserDeposited = true;
      const uBal = await TokenUtils.balanceOf(this.underlying, this.user.address);
      console.log("!!!Deposit", BigNumber.from(uBal).div(3));
      await this.deposit(BigNumber.from(uBal).div(3));
      console.log("!!!Deposit", BigNumber.from(uBal).div(3));
      await this.deposit(BigNumber.from(uBal).div(3));
    }
    Misc.printDuration('fLoopEndActions completed', start);
  }
//endregion End actions

//endregion Loop

  protected async userBalanceInVault(): Promise<BigNumber> {
    const userShares = await TokenUtils.balanceOf(this.vault.address, this.user.address);
    const userBalance = await this.vaultAsUser.convertToAssets(userShares);
    console.log('userBalanceInVault', userBalance.toString());
    return userBalance;
  }

  protected async userCheckBalanceInVault(userExpectedBalance: BigNumber) {
    // assume that at this point we deposited all expected amount except userWithdrew amount
    const userBalance = await this.userBalanceInVault();
    // avoid rounding errors
    const userBalanceN = +utils.formatUnits(userBalance, this.underlyingDecimals);
    const userBalanceExpectedN = +utils.formatUnits(userExpectedBalance, this.underlyingDecimals);
    console.log('userBalanceN, userBalanceExpectedN', userBalanceN, userBalanceExpectedN);

    console.log('Vault User balance +-:', DoHardWorkLoopBase.toPercent(userBalanceN, userBalanceExpectedN));
    expect(userBalanceN).is.greaterThanOrEqual(userBalanceExpectedN - (userBalanceExpectedN * this.balanceTolerance),
      'User has wrong balance inside the vault.\n' +
      'If you expect not zero balance it means the vault has a nature of PPFS decreasing.\n' +
      'It is not always wrong but you should triple check behavior and reasonable tolerance value.\n' +
      'If you expect zero balance and it has something inside IT IS NOT GOOD!\n');
  }

  protected async userBalance(): Promise<BigNumber> {
    const balance = await TokenUtils.balanceOf(this.underlying, this.user.address);
    console.log('userBalance', balance.toString());
    return balance;
  }

  protected async userCheckBalance(userBalanceExpected: BigNumber) {
    console.log('userBalanceExpected', userBalanceExpected.toString());
    const userUndBal = await this.userBalance();
    const userUndBalN = +utils.formatUnits(userUndBal, this.underlyingDecimals);
    const userBalanceExpectedN = +utils.formatUnits(userBalanceExpected, this.underlyingDecimals);
    console.log('userUndBalN, expected', userUndBalN, userBalanceExpectedN);
    console.log('Asset User balance +-:', DoHardWorkLoopBase.toPercent(userUndBalN, userBalanceExpectedN));
    expect(userUndBalN).is.greaterThanOrEqual(userBalanceExpectedN - (userBalanceExpectedN * this.balanceTolerance),
      'User has not enough balance');
  }

  protected async withdraw(exit: boolean, amount: BigNumber) {
    console.log('WITHDRAW exit, amount', exit, amount.toString());
    // no actions if zero balance
    if ((await TokenUtils.balanceOf(this.vault.address, this.user.address)).isZero()) {
      return;
    }
    console.log('PPFS before withdraw', (await this.vault.sharePrice()).toString());

    if (exit) {
      const balanceInVault = await this.userBalanceInVault();
      console.log('exit');
      await this.vaultAsUser.withdrawAll();
      await this.userCheckBalanceInVault(BigNumber.from(0));
      await this.userCheckBalance(this.subWithdrawFee(balanceInVault));

    } else {
      console.log('Withdraw', amount.toString());
      const userBalance = await this.userBalance();
      const userBalanceInVault = await this.userBalanceInVault();

      await this.vaultAsUser.withdraw(amount, this.user.address, this.user.address);

      await this.userCheckBalance(userBalance.add(amount));
      await this.userCheckBalanceInVault(userBalanceInVault.sub(this.addWithdrawFee(amount)));
    }
    console.log('PPFS after withdraw', (await this.vault.sharePrice()).toString());
  }

  // don't use for initial deposit
  protected async deposit(amount: BigNumber) {
    console.log('DEPOSIT', amount.toString());
    console.log('PPFS before deposit', (await this.vault.sharePrice()).toString());

    const userBalance = await this.userBalance();
    const userBalanceInVault = await this.userBalanceInVault();

    await VaultUtils.deposit(this.user, this.vault, amount);

    await this.userCheckBalanceInVault(userBalanceInVault.add(this.subDepositFee(amount)));
    await this.userCheckBalance(userBalance.sub(amount));
    console.log('PPFS after deposit', (await this.vault.sharePrice()).toString());
  }

  protected async doHardWork() {
    await VaultUtils.doHardWorkAndCheck(this.vault);

    // distribute all forwarded amounts back to the vault
    await this.core.forwarder.distributeAll(this.vault.address);
  }

  protected async postLoopCheck() {
    console.log('postLoopCheck...');
    // wait enough time for get rewards for liquidation
    // we need to have strategy without rewards tokens in the end
    await TimeUtils.advanceNBlocks(3000);
    await this.withdraw(true, BigNumber.from(0));
    // exit for signer
    await this.vault.connect(this.signer).withdrawAll();
    // await this.strategy.withdrawAllToSplitter();

    // expect(await this.strategy.totalAssets()).is.eq(0); // Converter strategy may have dust

    // need to call hard work to sell a little excess rewards
    await this.strategy.doHardWork();


    // strategy should not contain any tokens in the end
    // const rts = await this.strategy.rewardTokens();
    // console.log('rts', rts);
    /*for (const rt of rts) {
      if (rt.toLowerCase() === this.underlying.toLowerCase()) {
        continue;
      }
      const rtBal = await TokenUtils.balanceOf(rt, this.strategy.address);
      console.log('rt balance in strategy', rt, rtBal.toString());
      expect(rtBal).is.eq(0, 'Strategy contains not liquidated rewards');
    }*/

    // check vault balance // TODO check vault balance
    // const vaultBalanceAfter = await TokenUtils.balanceOf(this.core.psVault.address, this.vault.address);
    // expect(vaultBalanceAfter.sub(this.vaultRTBal)).is.not.eq("0", "vault reward should increase");

    if (this.cRatio !== 0 && !PPFS_NO_INCREASE.has(await this.strategy.NAME())) {
      // check ps balance
      // const psBalanceAfter = await TokenUtils.balanceOf(this.core.tetu.address, this.core.psVault.address);
      // expect(psBalanceAfter.sub(this.psBal)).is.not.eq("0", "ps balance should increase");

      // check ps PPFS
      // const psSharePriceAfter = await this.core.psVault.getPricePerFullShare();
      // expect(psSharePriceAfter.sub(this.psPPFS)).is.not.eq("0", "ps share price should increase");
    }

    // check reward for user // TODO
    // const rewardBalanceAfter = await TokenUtils.balanceOf(this.core.psVault.address, this.user.address);
    // expect(rewardBalanceAfter.sub(this.userRTBal).toString())
    //   .is.not.eq("0", "should have earned xTETU rewards");

      // .mul(this.feeDenominator.sub(this.depositFee)).div(this.feeDenominator)
      // .mul(this.feeDenominator.sub(this.withdrawFee)).div(this.feeDenominator);


    // TODO check final user and signer balances
    // some pools have auto compounding so user balance can increase
    const finalBalances: IBalances = {
      userBalance: await this.userBalance(),
      signerBalance: await TokenUtils.balanceOf(this.underlying, this.signer.address)
    }

    const difference: IBalances = {
      userBalance: finalBalances.userBalance.sub(this.initialBalances.userBalance),
      signerBalance: finalBalances.signerBalance.sub(this.initialBalances.signerBalance),
    }
    console.log("Initial balances", this.initialBalances);
    console.log("Final balances", finalBalances);
    console.log("Difference of balances", difference);

    console.log("User balance changes, percents", finalBalances.userBalance
      .sub(this.initialBalances.userBalance)
      .mul(100_000)
      .div(this.initialBalances.userBalance)
      .toNumber() / 1000
    );
    console.log("Signer balance changes, percents", finalBalances.signerBalance
      .sub(this.initialBalances.signerBalance)
      .mul(100_000)
      .div(this.initialBalances.signerBalance)
      .toNumber() / 1000
    );
  }

  private async getPrice(token: string): Promise<BigNumber> {
    console.log('getPrice', token)
    token = token.toLowerCase();
    if (this.priceCache.has(token)) {
      return this.priceCache.get(token) as BigNumber;
    }
    let price;
    if (token === this.core.tetu.address.toLowerCase()) {
      price = await PriceCalculatorUtils.getPriceWithDefaultOutput(token, this.tools.liquidator);
    // } else if (token === this.core.psVault.address.toLowerCase()) {
    //   // assume that PS price didn't change dramatically
    //   price = await this.tools.calculator.getPriceWithDefaultOutput(this.core.rewardToken.address);
    } else {
      price = await PriceCalculatorUtils.getPriceCached(token, this.tools.liquidator);
    }
    this.priceCache.set(token, price);
    console.log('price is', price.toString());
    return price;
  }

  private async strategyEarned() {
    // TODO calc how much strategy earned
    // let result = BigNumber.from(0);
    // const platform = await this.strategy.PLATFORM();
    // if (platform === 24) {
    //   const splitter = ISplitter__factory.connect(this.strategy.address, this.signer);
    //   const strategies = await splitter.allStrategies();
    //   for (const s of strategies) {
    //     result = result.add(await this.core.bookkeeper.targetTokenEarned(s));
    //   }
    // } else {
    //   result = await this.core.bookkeeper.targetTokenEarned(this.strategy.address);
    // }
    // return result;
    return BigNumber.from(0); // TODO
  }

  protected static toPercent(actual: number, expected: number): string {
    if (actual === 0 && expected === 0) return '0%';
    const percent = (actual / expected * 100) - 100;
    return percent.toFixed(6) + '%';
  }
}
