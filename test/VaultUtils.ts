import { IERC20__factory, IStrategyV2__factory, StrategySplitterV2__factory, TetuVaultV2 } from '../typechain';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { TokenUtils } from '../scripts/utils/TokenUtils';
import { BigNumber, ContractTransaction, utils } from 'ethers';
import { Misc } from '../scripts/utils/Misc';
import { DeployerUtilsLocal } from '../scripts/utils/DeployerUtilsLocal';

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
      .is.greaterThanOrEqual(+utils.formatUnits(amount, underlyingDecimals), 'not enough balance');

    const vaultTotalAssets = await vaultForUser.totalAssets();
    const totalSupply = await IERC20__factory.connect(vault.address, user).totalSupply();
    if (!totalSupply.isZero() && vaultTotalAssets.isZero()) {
      throw new Error('Wrong underlying balance! Check strategy implementation for _rewardPoolBalance()');
    }

    await TokenUtils.approve(underlying, user, vault.address, amount.toString());
    console.log('Vault utils: deposit', BigNumber.from(amount).toString());
    return vaultForUser.deposit(BigNumber.from(amount), user.address, { gasLimit: 19_000_000 });
  }


  public static async doHardWorkAndCheck(
    vault: TetuVaultV2,
    positiveCheck = true,
  ): Promise<IDoHardworkAndCheckResults> {
    const start = Date.now();
    const dest: IDoHardworkAndCheckResults = {
      strategy: [],
      earned: [],
      lost: [],
    };

    const underlying = await vault.asset();
    const underlyingDecimals = await TokenUtils.decimals(underlying);

    const ppfsBefore = +utils.formatUnits(await vault.sharePrice(), underlyingDecimals);
    const underlyingBalanceBefore = +utils.formatUnits(await vault.totalAssets(), underlyingDecimals);

    console.log('start hard works');
    const splitterAddress = await vault.splitter();
    const splitter = StrategySplitterV2__factory.connect(splitterAddress, vault.signer);
    const splitterSigner = await DeployerUtilsLocal.impersonate(splitterAddress);

    const subStrategies = await splitter.allStrategies();
    for (const subStrategy of subStrategies) {
      const strategy = IStrategyV2__factory.connect(subStrategy, vault.signer);
      const strategyName = await strategy.NAME();
      console.log(`Call doHardWork, strategy=${strategyName}`);

      // handle HardWork-event to extract earned and lost values
      const { earned, lost } = await strategy.connect(splitterSigner).callStatic.doHardWork();
      await strategy.connect(splitterSigner).doHardWork({gasLimit: 19_000_000});
      console.log(`Strategy=${strategyName} step earned=${earned} lost=${lost}`);

      dest.strategy.push(strategy.address);
      dest.earned.push(BigNumber.from(earned));
      dest.lost.push(BigNumber.from(lost));
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
    console.log(
      '- Earned by the strategies:',
      dest.earned.reduce((p, c) => c = p.add(c), BigNumber.from(0)).toString(),
    );
    console.log('- Lost by the strategies:', dest.lost.reduce((p, c) => c = p.add(c), BigNumber.from(0)).toString());
    console.log('--------------------------');
    // TODO !!! check Gauges, Bribes, Invest fund?


    Misc.printDuration('doHardWorkAndCheck completed', start);

    return dest;
  }

}
