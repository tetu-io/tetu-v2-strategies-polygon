import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ICoreContractsWrapper} from "../CoreContractsWrapper";
import {IStrategyV2, TetuVaultV2} from "../../typechain";
import {IToolsContractsWrapper} from "../ToolsContractsWrapper";
import {TokenUtils} from "../../scripts/utils/TokenUtils";
import {BigNumber, utils} from "ethers";
import {Misc} from "../../scripts/utils/Misc";
import {PPFS_NO_INCREASE, VaultUtils} from "../VaultUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {PriceCalculatorUtils} from "../PriceCalculatorUtils";


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
  // private vaultRt: string;
  vaultForUser: TetuVaultV2;
  undDec = 0;
  userDeposited = BigNumber.from(0);
  userDepositedWithFee = BigNumber.from(0);
  signerDeposited = BigNumber.from(0);
  userWithdrew = BigNumber.from(0);
  userWithdrewWithFee = BigNumber.from(0);
  userRTBal = BigNumber.from(0);
  vaultRTBal = BigNumber.from(0);
  psBal = BigNumber.from(0);
  psPPFS = BigNumber.from(0);

  loops = 0;
  loopStartTs = 0;
  startTs = 0;
  cRatio = 0;
  isUserDeposited = true;
  stratEarnedTotal = BigNumber.from(0);
  stratEarned = BigNumber.from(0);
  vaultPPFS = BigNumber.from(0);
  priceCache = new Map<string, BigNumber>();
  totalToClaimInTetuN = 0;
  toClaimCheckTolerance = 0.3;

  feeDenominator = BigNumber.from(100_000);
  depositFee = BigNumber.from(0);
  withdrawFee = BigNumber.from(0);

  initialDepositWithFee = BigNumber.from(0);

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

    this.vaultForUser = vault.connect(user);
    // this.vaultRt = this.core.psVault.address;
  }

  public async start(deposit: BigNumber, loops: number, loopValue: number, advanceBlocks: boolean) {
    const start = Date.now();
    this.loops = loops;
    await this.init();
    this.initialDepositWithFee = this.subDepositFee(deposit); // call it after fees init()
    await this.initialCheckVault();
    await this.enterToVault(deposit);
    await this.initialSnapshot();
    await this.loop(loops, loopValue, advanceBlocks);
    await this.postLoopCheck();
    Misc.printDuration('HardWork test finished', start);
  }

  protected calcDepositFee(amount: BigNumber): BigNumber {
    return amount.mul(this.depositFee).div(this.feeDenominator);
  }
  protected subDepositFee(amount: BigNumber): BigNumber {
    return amount.sub(this.calcDepositFee(amount));
  }

  protected calcWithdrawFee(amount: BigNumber): BigNumber {
    return amount.mul(this.withdrawFee).div(this.feeDenominator);
  }
  protected subWithdrawFee(amount: BigNumber): BigNumber {
    return amount.sub(this.calcWithdrawFee(amount));
  }

  protected async init() {
    this.undDec = await TokenUtils.decimals(this.underlying);
    // this.vaultRt = (await this.vault.rewardTokens())[0].toLowerCase()
    this.feeDenominator = await this.vault.FEE_DENOMINATOR();
    this.depositFee = await this.vault.depositFee();
    this.withdrawFee = await this.vault.withdrawFee();
  }

  protected async initialCheckVault() {
    // expect((await this.vault.rewardTokens())[0].toLowerCase()).eq(this.vaultRt.toLowerCase());
  }

  protected async initialSnapshot() {
    console.log('>>>initialSnapshot start')
    // TODO capture initial asset and reward balances
    // this.userRTBal = await TokenUtils.balanceOf(this.vaultRt, this.user.address);
    // this.vaultRTBal = await TokenUtils.balanceOf(this.vaultRt, this.vault.address);
    // this.psBal = await TokenUtils.balanceOf(this.vaultRt, this.core.psVault.address);
    // this.psPPFS = await this.core.psVault.getPricePerFullShare();
    this.startTs = await Misc.getBlockTsFromChain();
    this.cRatio = (await this.strategy.compoundRatio()).toNumber();
    console.log('initialSnapshot end')
  }

  // signer and user enter to the vault
  // we should have not zero balance if user exit the vault for properly check
  protected async enterToVault(deposit: BigNumber) {
    console.log('--- Enter to vault')
    // initial deposit from signer
    const signerDeposit = deposit.div(2)
    await VaultUtils.deposit(this.signer, this.vault, signerDeposit);
    console.log('enterToVault: deposited for signer');
    this.signerDeposited = this.subDepositFee(signerDeposit);
    await VaultUtils.deposit(this.user, this.vault, deposit);
    this.userDeposited = deposit;
    this.userDepositedWithFee = this.subDepositFee(deposit);
    console.log('enterToVault: deposited for user');
    await this.userCheckBalanceInVault();

    // remove excess tokens
    const excessBalUser = await TokenUtils.balanceOf(this.underlying, this.user.address);
    if (!excessBalUser.isZero()) {
      await TokenUtils.transfer(this.underlying, this.user, this.tools.liquidator.address, excessBalUser.toString());
    }
    const excessBalSigner = await TokenUtils.balanceOf(this.underlying, this.signer.address);
    if (!excessBalSigner.isZero()) {
      await TokenUtils.transfer(this.underlying, this.signer, this.tools.liquidator.address, excessBalSigner.toString());
    }
    await this.userCheckBalance();

    console.log('--- Enter to vault end')
  }

  protected async loopStartActions(i: number) {
    // const start = Date.now();
    // if (i > 1) {
    //   const den = (await this.core.controller.psDenominator()).toNumber();
    //   const newNum = +(den / i).toFixed()
    //   console.log('new ps ratio', newNum, den)
    //   await this.core.announcer.announceRatioChange(9, newNum, den);
    //   await TimeUtils.advanceBlocksOnTs(60 * 60 * 48);
    //   await this.core.controller.setPSNumeratorDenominator(newNum, den);
    // }
    // Misc.printDuration('fLoopStartActionsDefault completed', start);
  }

  protected async loopStartSnapshot() {
    this.loopStartTs = await Misc.getBlockTsFromChain();
    this.vaultPPFS = await this.vault.sharePrice();
    this.stratEarnedTotal = await this.strategyEarned();
  }

  protected async loopEndCheck() {
    // ** check to claim
    if (this.totalToClaimInTetuN !== 0 && this.cRatio !== 0) {
      const earnedN = +utils.formatUnits(this.stratEarned);
      const earnedNAdjusted = earnedN / (this.cRatio / 10000);
      expect(earnedNAdjusted).is.greaterThanOrEqual(this.totalToClaimInTetuN * this.toClaimCheckTolerance); // very approximately
    }
  }

  protected async userCheckBalanceInVault() {
    // assume that at this point we deposited all expected amount except userWithdrew amount
    console.log('userCheckBalanceInVault userDepositedWithFee, userWithdrew, diff',
      this.userDepositedWithFee.toString(), this.userWithdrew.toString(), this.userDepositedWithFee.sub(this.userWithdrew).toString());
    const userShares = await TokenUtils.balanceOf(this.vault.address, this.user.address);
    const userBalance = await this.vaultForUser.convertToAssets(userShares);
    console.log('userShares, balance', userShares.toString(), userBalance.toString());
    // avoid rounding errors
    const userBalanceN = +utils.formatUnits(userBalance, this.undDec);
    const userBalanceExpectedN = +utils.formatUnits(this.userDepositedWithFee.sub(this.userWithdrew), this.undDec);
    console.log('userBalanceN, userBalanceExpectedN', userBalanceN, userBalanceExpectedN);

    console.log('Vault User balance +-:', DoHardWorkLoopBase.toPercent(userBalanceN, userBalanceExpectedN));
    expect(userBalanceN).is.greaterThanOrEqual(userBalanceExpectedN - (userBalanceExpectedN * this.balanceTolerance),
      'User has wrong balance inside the vault.\n' +
      'If you expect not zero balance it means the vault has a nature of PPFS decreasing.\n' +
      'It is not always wrong but you should triple check behavior and reasonable tolerance value.\n' +
      'If you expect zero balance and it has something inside IT IS NOT GOOD!\n');
  }

  protected async userCheckBalance() {
    console.log('userCheckBalance userDeposited, userWithdrew',
      this.userDeposited.toString(), this.userWithdrew.toString());
    const userUndBal = await TokenUtils.balanceOf(this.underlying, this.user.address);
    const userUndBalN = +utils.formatUnits(userUndBal, this.undDec);
    const userBalanceExpected = this.initialDepositWithFee.add(this.userWithdrewWithFee).sub(this.userDeposited);
    const userBalanceExpectedN = +utils.formatUnits(userBalanceExpected, this.undDec);
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
    await this.userCheckBalanceInVault();
    await this.userCheckBalance();

    if (exit) {
      console.log('exit');
      await this.vaultForUser.withdrawAll();
      this.userWithdrew = this.userDepositedWithFee;
      this.userWithdrewWithFee = this.subWithdrawFee(this.userDepositedWithFee);
      await this.userCheckBalanceInVault();
      await this.userCheckBalance();
    } else {
      const userUndBal = await TokenUtils.balanceOf(this.underlying, this.user.address);
      console.log('Withdraw', amount.toString());
      await this.vaultForUser.withdraw(amount, this.user.address, this.user.address);
      const userUndBalAfter = await TokenUtils.balanceOf(this.underlying, this.user.address);
      const withdrawn = userUndBalAfter.sub(userUndBal);
      console.log('withdrawn', withdrawn.toString());
      expect(withdrawn).eq(this.subWithdrawFee(amount));
      this.userWithdrew = this.userWithdrew.add(amount);
      this.userWithdrewWithFee = this.userWithdrew.add(withdrawn);
      await this.userCheckBalance();
    }
    console.log('userWithdrew', this.userWithdrew.toString());
    console.log('PPFS after withdraw', (await this.vault.sharePrice()).toString());
  }

  // don't use for initial deposit
  protected async deposit(amount: BigNumber) {
    console.log('DEPOSIT', amount.toString());
    console.log('PPFS before deposit', (await this.vault.sharePrice()).toString());
    await this.userCheckBalanceInVault();
    await this.userCheckBalance();

    await VaultUtils.deposit(this.user, this.vault, amount);
    this.userDeposited = this.userDeposited.add(amount);
    this.userDepositedWithFee = this.userDepositedWithFee.add(this.subDepositFee(amount));

    await this.userCheckBalanceInVault();
    await this.userCheckBalance();
    console.log('PPFS after deposit', (await this.vault.sharePrice()).toString());
  }

  protected async loopEndActions(i: number) {
    const start = Date.now();
    // we need to enter and exit from the vault between loops for properly check all mechanic
    if (this.isUserDeposited && i % 2 === 0) {
      this.isUserDeposited = false;
      if (i % 4 === 0) {
        await this.withdraw(true, BigNumber.from(0));
      } else {
        const userXTokenBal = await TokenUtils.balanceOf(this.vault.address, this.user.address);
        const userAssetsBal = await this.vaultForUser.convertToAssets(userXTokenBal);
        const toWithdraw = BigNumber.from(userAssetsBal).mul(95).div(100);
        await this.withdraw(false, toWithdraw);
      }

    } else if (!this.isUserDeposited && i % 2 !== 0) {
      this.isUserDeposited = true;
      const uBal = await TokenUtils.balanceOf(this.underlying, this.user.address);
      console.log('.userDeposited, userWithdrew', this.userDeposited, this.userWithdrew);
      await this.deposit(BigNumber.from(uBal).div(3));
      await this.deposit(BigNumber.from(uBal).div(3));
    }
    Misc.printDuration('fLoopEndActions completed', start);
  }

  protected async loopPrintROIAndSaveEarned(i: number) {
    const start = Date.now();
    const stratEarnedTotal = await this.strategyEarned();
    const stratEarnedTotalN = +utils.formatUnits(stratEarnedTotal);
    this.stratEarned = stratEarnedTotal.sub(this.stratEarnedTotal);
    const stratEarnedN = +utils.formatUnits(this.stratEarned);
    const loopEndTs = await Misc.getBlockTsFromChain();
    const loopTime = loopEndTs - this.loopStartTs;

    const targetTokenPrice = await this.getPrice(this.core.tetu.address);
    const targetTokenPriceN = +utils.formatUnits(targetTokenPrice);
    const underlyingPrice = await this.getPrice(this.underlying);
    const underlyingPriceN = +utils.formatUnits(underlyingPrice);

    const tvl = await this.vault.totalAssets();
    const tvlN = +utils.formatUnits(tvl, this.undDec);

    const tvlUsdc = tvlN * underlyingPriceN;
    const earnedUsdc = stratEarnedTotalN * targetTokenPriceN;
    const earnedUsdcThisCycle = stratEarnedN * targetTokenPriceN;

    const roi = ((earnedUsdc / tvlUsdc) / (loopEndTs - this.startTs)) * 100 * Misc.SECONDS_OF_YEAR;
    const roiThisCycle = ((earnedUsdcThisCycle / tvlUsdc) / loopTime) * 100 * Misc.SECONDS_OF_YEAR;

    console.log('++++++++++++++++ ROI ' + i + ' ++++++++++++++++++++++++++')
    console.log('Loop time', (loopTime / 60 / 60).toFixed(1), 'hours');
    console.log('TETU earned total', stratEarnedTotalN);
    console.log('TETU earned for this loop', stratEarnedN);
    console.log('ROI total', roi);
    console.log('ROI current', roiThisCycle);
    console.log('+++++++++++++++++++++++++++++++++++++++++++++++')
    Misc.printDuration('fLoopPrintROIAndSaveEarned completed', start);
  }

  protected async afterBlockAdvance() {
    const start = Date.now();
    // ** calculate to claim
    this.totalToClaimInTetuN = 0;
    const isReadyToHardWork = await this.strategy.isReadyToHardWork();
    if (isReadyToHardWork) {
      const platform = await this.strategy.PLATFORM();
      // const tetuPriceN = +utils.formatUnits(await this.getPrice(this.core.tetu.address));
      let rts;
      // if (platform === 24) {
      //   rts = await ISplitter__factory.connect(this.strategy.address, this.signer).strategyRewardTokens();
      // } else {
      rts = []; // await this.strategy.rewardTokens(); // TODO we have no rewardTokens() at v2
      // }
      // for (let i = 0; i < rts.length; i++) {
      //   const rt = rts[i];
      //   const rtDec = await TokenUtils.decimals(rt);
      //   const rtPriceN = +utils.formatUnits(await this.getPrice(rt));
      //   // const toClaimInTetuN = +utils.formatUnits(toClaim[i], rtDec) * rtPriceN / tetuPriceN;
      //   // console.log('toClaim', i, toClaimInTetuN);
      //   this.totalToClaimInTetuN += toClaimInTetuN;
      // }
    }
    Misc.printDuration('fAfterBlocAdvance completed', start);
  }

  protected async doHardWork() {
    await VaultUtils.doHardWorkAndCheck(this.vault);
  }

  protected async loop(loops: number, loopValue: number, advanceBlocks: boolean) {
    console.log('loop... loops, loopValue, advanceBlocks', loops, loopValue, advanceBlocks);
    for (let i = 0; i < loops; i++) {
      console.log('\n=====================\nloop i', i);
      const start = Date.now();
      await this.loopStartActions(i);
      await this.loopStartSnapshot();

      // *********** DO HARD WORK **************
      if (advanceBlocks) {
        await TimeUtils.advanceNBlocks(loopValue);
      } else {
        await TimeUtils.advanceBlocksOnTs(loopValue);
      }
      await this.afterBlockAdvance();
      await this.doHardWork();
      await this.loopPrintROIAndSaveEarned(i);
      await this.loopEndCheck();
      await this.loopEndActions(i);
      Misc.printDuration(i + ' Loop ended', start);
    }
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
    const rts = await this.strategy.rewardTokens();
    console.log('rts', rts);
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

    console.log('userCheckBalance userDeposited, userWithdrew',
      this.userDeposited.toString(), this.userWithdrew.toString());
    const userBalance = this.initialDepositWithFee.sub(this.userDeposited).add(this.userWithdrew);
      // .mul(this.feeDenominator.sub(this.depositFee)).div(this.feeDenominator)
      // .mul(this.feeDenominator.sub(this.withdrawFee)).div(this.feeDenominator);
    const userBalanceN = +utils.formatUnits(userBalance, this.undDec);
    // some pools have auto compounding so user balance can increase
    const userUnderlyingBalanceAfter = await TokenUtils.balanceOf(this.underlying, this.user.address);
    const userUnderlyingBalanceAfterN = +utils.formatUnits(userUnderlyingBalanceAfter, this.undDec);
    console.log('userUnderlyingBalanceAfterN', userUnderlyingBalanceAfterN);
    const userBalanceExpected = userBalanceN - (userBalanceN * this.finalBalanceTolerance);
    console.log('User final balance +-: ', DoHardWorkLoopBase.toPercent(userUnderlyingBalanceAfterN, userBalanceN));
    expect(userUnderlyingBalanceAfterN).is.greaterThanOrEqual(userBalanceExpected, "user should have more underlying");

    const signerDepositedWithFee = this.signerDeposited
      .mul(this.feeDenominator.sub(this.depositFee)).div(this.feeDenominator)
      .mul(this.feeDenominator.sub(this.withdrawFee)).div(this.feeDenominator);
    const signerDepositedN = +utils.formatUnits(signerDepositedWithFee, this.undDec);
    const signerUnderlyingBalanceAfter = await TokenUtils.balanceOf(this.underlying, this.signer.address);
    const signerUnderlyingBalanceAfterN = +utils.formatUnits(signerUnderlyingBalanceAfter, this.undDec);
    const signerBalanceExpected = signerDepositedN - (signerDepositedN * this.finalBalanceTolerance);
    console.log('Signer final balance +-: ', DoHardWorkLoopBase.toPercent(signerUnderlyingBalanceAfterN, signerDepositedN));
    expect(signerUnderlyingBalanceAfterN).is.greaterThanOrEqual(signerBalanceExpected, "signer should have more underlying");
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
    /*let result = BigNumber.from(0);
    const platform = await this.strategy.PLATFORM();
    if (platform === 24) {
      const splitter = ISplitter__factory.connect(this.strategy.address, this.signer);
      const strategies = await splitter.allStrategies();
      for (const s of strategies) {
        result = result.add(await this.core.bookkeeper.targetTokenEarned(s));
      }
    } else {
      result = await this.core.bookkeeper.targetTokenEarned(this.strategy.address);
    }
    return result;*/
    return BigNumber.from(0); // TODO
  }

  protected static toPercent(actual: number, expected: number): string {
    if (actual === 0 && expected === 0) return '0%';
    const percent = (actual / expected * 100) - 100;
    return percent.toFixed(6) + '%';
  }
}
