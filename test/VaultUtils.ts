import {
  IERC20__factory,
  TetuVaultV2,
  IStrategyV2__factory,
  StrategySplitterV2__factory
} from "../typechain";
import {expect} from "chai";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TokenUtils} from "../scripts/utils/TokenUtils";
import {BigNumber, ContractTransaction, utils} from "ethers";
import {Misc} from "../scripts/utils/Misc";

/** Amounts earned/lost by the given strategies during the hardwork */
export interface IDoHardworkAndCheckResults {
  strategy: string[];
  earned: BigNumber[];
  lost: BigNumber[];
}

export const PPFS_NO_INCREASE = new Set<string>([
  // 'QiStakingStrategyBase',
  // 'BalBridgedStakingStrategyBase',
  // 'MeshLpStrategyBase',
  // 'BalancerPoolStrategyBase',
  // 'PenroseStrategyBase',
]);

export class VaultUtils {

  constructor(public vault: TetuVaultV2) {
  }

  public static async deposit(
    user: SignerWithAddress,
    vault: TetuVaultV2,
    amount: BigNumber,
  ): Promise<ContractTransaction> {
    const vaultForUser = vault.connect(user);
    const underlying = await vaultForUser.asset();
    const underlyingDecimals = await TokenUtils.decimals(underlying);
    const userBalance = await TokenUtils.balanceOf(underlying, user.address);
    console.log('balance', utils.formatUnits(userBalance, underlyingDecimals), userBalance.toString());
    expect(+utils.formatUnits(userBalance, underlyingDecimals))
      .is.greaterThanOrEqual(+utils.formatUnits(amount, underlyingDecimals), 'not enough balance')

    const vaultTotalAssets = await vaultForUser.totalAssets();
    const totalSupply = await IERC20__factory.connect(vault.address, user).totalSupply();
    if (!totalSupply.isZero() && vaultTotalAssets.isZero()) {
      throw new Error("Wrong underlying balance! Check strategy implementation for _rewardPoolBalance()");
    }

    await TokenUtils.approve(underlying, user, vault.address, amount.toString());
    console.log('Vault utils: deposit', BigNumber.from(amount).toString());
    return vaultForUser.deposit(BigNumber.from(amount), user.address);
  }


  public static async doHardWorkAndCheck(
    vault: TetuVaultV2,
    positiveCheck = true
  ) : Promise<IDoHardworkAndCheckResults> {
    const start = Date.now();
    const dest: IDoHardworkAndCheckResults = {
      strategy: [],
      earned: [],
      lost: []
    }

    const underlying = await vault.asset();
    const underlyingDecimals = await TokenUtils.decimals(underlying);

    const psRatio = 1;
    // const ppfsDecreaseAllowed = false; // await vault.ppfsDecreaseAllowed();

    const ppfsBefore = +utils.formatUnits(await vault.sharePrice(), underlyingDecimals);
    const underlyingBalanceBefore = +utils.formatUnits(await vault.totalAssets(), underlyingDecimals);

    console.log('start hard works');
    const splitterAddress = await vault.splitter();
    const splitter = StrategySplitterV2__factory.connect(splitterAddress, vault.signer);

    const subStrategies = await splitter.allStrategies();
    for (const subStrategy of subStrategies) {
      const strategy = IStrategyV2__factory.connect(subStrategy, vault.signer);
      const strategyName = await strategy.NAME();
      console.log(`Call doHardWork, strategy=${strategyName}`);

      // handle HardWork-event to extract earned and lost values
      // !TODO const {earned, lost} = await strategy.callStatic.doHardWork();
      await strategy.doHardWork();
      // console.log(`Strategy=${strategyName} earned=${earned} lost=${lost}`);
      //
      // dest.strategy.push(strategy.address);
      // dest.earned.push(BigNumber.from(earned));
      // dest.lost.push(BigNumber.from(lost));
    }

    console.log('hard works done');

    const ppfsAfter = +utils.formatUnits(await vault.sharePrice(), underlyingDecimals);
    const unerlyingBalanceAfter = +utils.formatUnits(await vault.totalAssets(), underlyingDecimals);

    console.log('-------- HARDWORK --------');
    console.log('- Vault Share price after:', ppfsAfter);
    console.log('- Vault Share price before:', ppfsBefore);
    console.log('- Vault Share price change:', ppfsAfter - ppfsBefore);
    console.log('- Vault underlying balance after:', unerlyingBalanceAfter);
    console.log('- Vault underlying balance before:', underlyingBalanceBefore);
    console.log('- Vault underlying balance change:', unerlyingBalanceAfter - underlyingBalanceBefore);
    console.log('- Earned by the strategies:', dest.earned.reduce((p, c) => c = p.add(c), BigNumber.from(0)));
    console.log('- Lost by the strategies:', dest.lost.reduce((p, c) => c = p.add(c), BigNumber.from(0)));
    console.log('- PS ratio:', psRatio);
    console.log('--------------------------');
    // TODO !!! check Gauges, Bribes, Invest fund?

    if (positiveCheck) {
      // if (cRatio > 1000) {
      //   expect(psPpfsAfter).is.greaterThan(psPpfs,
      //     'PS didnt have any income, it means that rewards was not liquidated and properly sent to PS.' +
      //     ' Check reward tokens list and liquidation paths');
        if (psRatio !== 1) {
          // expect(rtBalAfter).is.greaterThan(rtBal, 'With ps ratio less than 1 we should send a part of buybacks to vaults as rewards.');
        }
      // }

      // if (cRatio !== 10000 && !ppfsDecreaseAllowed) {
      //   // it is a unique case where we send profit to vault instead of AC
      //   const strategyName = await strategyCtr.STRATEGY_NAME();
      //   if (!PPFS_NO_INCREASE.has(strategyName)) {
      //     expect(ppfsAfter).is.greaterThan(ppfs, 'With not 100% buybacks we should autocompound underlying asset');
      //   }
      // }
    }
    Misc.printDuration('doHardWorkAndCheck completed', start);

    return dest;
  }

}
