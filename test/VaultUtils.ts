import {
  IControllable__factory,
  IController,
  IController__factory, IERC20__factory,
  ISmartVault,
  ISmartVault__factory,
  IStrategy__factory,
  IStrategySplitter__factory
} from "../typechain";
import {expect} from "chai";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TokenUtils} from "./TokenUtils";
import {BigNumber, ContractTransaction, utils} from "ethers";
import axios from "axios";
import {CoreContractsWrapper} from "./CoreContractsWrapper";
import {MaticAddresses} from "../scripts/addresses/MaticAddresses";
import {MintHelperUtils} from "./MintHelperUtils";
import {Misc} from "../scripts/utils/tools/Misc";
import {ethers} from "hardhat";

export const PPFS_NO_INCREASE = new Set<string>([
  'QiStakingStrategyBase',
  'BalBridgedStakingStrategyBase',
  'MeshLpStrategyBase',
  'BalancerPoolStrategyBase',
  'PenroseStrategyBase',
])

export class VaultUtils {

  constructor(public vault: ISmartVault) {
  }

  public static async profitSharingRatio(controller: IController): Promise<number> {
    const ratio = (await controller.psNumerator()).toNumber()
      / (await controller.psDenominator()).toNumber();
    expect(ratio).is.not.lessThan(0);
    expect(ratio).is.not.greaterThan(100);
    return ratio;
  }

  public static async deposit(
    user: SignerWithAddress,
    vault: ISmartVault,
    amount: BigNumber,
    invest = true
  ): Promise<ContractTransaction> {
    const vaultForUser = vault.connect(user);
    const underlying = await vaultForUser.underlying();
    const dec = await TokenUtils.decimals(underlying);
    const bal = await TokenUtils.balanceOf(underlying, user.address);
    console.log('balance', utils.formatUnits(bal, dec), bal.toString());
    expect(+utils.formatUnits(bal, dec))
      .is.greaterThanOrEqual(+utils.formatUnits(amount, dec), 'not enough balance')

    const undBal = await vaultForUser.underlyingBalanceWithInvestment();
    const totalSupply = await IERC20__factory.connect(vault.address, user).totalSupply();
    if (!totalSupply.isZero() && undBal.isZero()) {
      throw new Error("Wrong underlying balance! Check strategy implementation for _rewardPoolBalance()");
    }

    await TokenUtils.approve(underlying, user, vault.address, amount.toString());
    console.log('Vault utils: deposit', BigNumber.from(amount).toString());
    if (invest) {
      return vaultForUser.depositAndInvest(BigNumber.from(amount));
    } else {
      return vaultForUser.deposit(BigNumber.from(amount));
    }
  }


  public static async getVaultInfoFromServer() {
    const net = await ethers.provider.getNetwork();
    let network;
    if (net.chainId === 137) {
      network = 'MATIC';
    } else if (net.chainId === 250) {
      network = 'FANTOM';
    } else {
      throw Error('unknown net ' + net.chainId);
    }
    return (await axios.get(`https://tetu-server-staging.herokuapp.com//api/v1/reader/vaultInfos?network=${network}`)).data;
  }

  public static async addRewardsXTetu(
    signer: SignerWithAddress,
    vault: ISmartVault,
    core: CoreContractsWrapper,
    amount: number,
    period = 60 * 60 * 24 * 2
  ) {
    const start = Date.now();
    const net = await ethers.provider.getNetwork();

    console.log("Add xTETU as reward to vault: ", amount.toString())
    const rtAdr = core.psVault.address;
    const tetuTokenAddress = MaticAddresses.TETU_TOKEN;
    if (core.rewardToken.address.toLowerCase() === tetuTokenAddress) {
      await TokenUtils.getToken(core.rewardToken.address, signer.address, utils.parseUnits(amount + ''));
    } else {
      await MintHelperUtils.mint(core.controller, core.announcer, amount * 2 + '', signer.address, false, period)
    }
    await TokenUtils.approve(core.rewardToken.address, signer, core.psVault.address, utils.parseUnits(amount + '').toString());
    await core.psVault.deposit(utils.parseUnits(amount + ''));
    const xTetuBal = await TokenUtils.balanceOf(core.psVault.address, signer.address);
    await TokenUtils.approve(rtAdr, signer, vault.address, xTetuBal.toString());
    await vault.notifyTargetRewardAmount(rtAdr, xTetuBal);
    Misc.printDuration('xTetu reward token added to vault', start);
  }

  public static async doHardWorkAndCheck(vault: ISmartVault, positiveCheck = true) {
    const start = Date.now();
    const controller = await IControllableExtended__factory.connect(vault.address, vault.signer).controller();
    const controllerCtr = IController__factory.connect(controller, vault.signer);
    const psVault = await controllerCtr.psVault();
    const psVaultCtr = ISmartVault__factory.connect(psVault, vault.signer);
    const und = await vault.underlying();
    const undDec = await TokenUtils.decimals(und);
    const rt = (await vault.rewardTokens())[0];
    const psRatio = (await controllerCtr.psNumerator()).toNumber() / (await controllerCtr.psDenominator()).toNumber()
    const strategy = await vault.strategy();
    const strategyCtr = IStrategy__factory.connect(strategy, vault.signer);
    const ppfsDecreaseAllowed = await vault.ppfsDecreaseAllowed();

    const ppfs = +utils.formatUnits(await vault.getPricePerFullShare(), undDec);
    const undBal = +utils.formatUnits(await vault.underlyingBalanceWithInvestment(), undDec);
    const psPpfs = +utils.formatUnits(await psVaultCtr.getPricePerFullShare());
    const rtBal = +utils.formatUnits(await TokenUtils.balanceOf(rt, vault.address));

    const strategyPlatform = (await strategyCtr.platform());
    if (strategyPlatform === 24) {
      console.log('splitter dohardworks');
      const splitter = IStrategySplitter__factory.connect(strategy, vault.signer);
      const subStrategies = await splitter.allStrategies();
      for (const subStrategy of subStrategies) {
        console.log('Call substrategy dohardwork', await IStrategy__factory.connect(subStrategy, vault.signer).STRATEGY_NAME())
        await IStrategy__factory.connect(subStrategy, vault.signer).doHardWork();
      }
    } else {
      await vault.doHardWork();
    }
    console.log('hard work called');

    const ppfsAfter = +utils.formatUnits(await vault.getPricePerFullShare(), undDec);
    const undBalAfter = +utils.formatUnits(await vault.underlyingBalanceWithInvestment(), undDec);
    const psPpfsAfter = +utils.formatUnits(await psVaultCtr.getPricePerFullShare());
    const rtBalAfter = +utils.formatUnits(await TokenUtils.balanceOf(rt, vault.address));
    const bbRatio = (await strategyCtr.buyBackRatio()).toNumber();

    console.log('-------- HARDWORK --------');
    console.log('- BB ratio:', bbRatio);
    console.log('- Vault Share price:', ppfsAfter);
    console.log('- Vault Share price change:', ppfsAfter - ppfs);
    console.log('- Vault und balance change:', undBalAfter - undBal);
    console.log('- Vault first RT change:', rtBalAfter - rtBal);
    console.log('- xTETU share price change:', psPpfsAfter - psPpfs);
    console.log('- PS ratio:', psRatio);
    console.log('--------------------------');

    if (positiveCheck) {
      if (bbRatio > 1000) {
        expect(psPpfsAfter).is.greaterThan(psPpfs,
          'PS didnt have any income, it means that rewards was not liquidated and properly sent to PS.' +
          ' Check reward tokens list and liquidation paths');
        if (psRatio !== 1) {
          expect(rtBalAfter).is.greaterThan(rtBal, 'With ps ratio less than 1 we should send a part of buybacks to vaults as rewards.');
        }
      }
      if (bbRatio !== 10000 && !ppfsDecreaseAllowed) {
        // it is a unique case where we send profit to vault instead of AC
        const strategyName = await strategyCtr.STRATEGY_NAME();
        if (!PPFS_NO_INCREASE.has(strategyName)) {
          expect(ppfsAfter).is.greaterThan(ppfs, 'With not 100% buybacks we should autocompound underlying asset');
        }
      }
    }
    Misc.printDuration('doHardWorkAndCheck completed', start);
  }

}
