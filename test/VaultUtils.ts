import {
  IERC20__factory,
  TetuVaultV2,
  IStrategyV2__factory,
  IGauge__factory, StrategySplitterV2__factory
} from "../typechain";
import {expect} from "chai";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TokenUtils} from "../scripts/utils/TokenUtils";
import {BigNumber, ContractTransaction, utils} from "ethers";
// import axios from "axios";
// import {MintHelperUtils} from "./MintHelperUtils";
import {Misc} from "../scripts/utils/Misc";
// import {ethers} from "hardhat";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {ICoreContractsWrapper} from "./CoreContractsWrapper";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {ethers} from "hardhat";
import axios from "axios";

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

  // public static async profitSharingRatio(controller: IController): Promise<number> {
  //   const ratio = (await controller.psNumerator()).toNumber()
  //     / (await controller.psDenominator()).toNumber();
  //   expect(ratio).is.not.lessThan(0);
  //   expect(ratio).is.not.greaterThan(100);
  //   return ratio;
  // }

  public static async deposit(
    user: SignerWithAddress,
    vault: TetuVaultV2,
    amount: BigNumber,
  ): Promise<ContractTransaction> {
    const vaultForUser = vault.connect(user);
    const underlying = await vaultForUser.asset();
    const dec = await TokenUtils.decimals(underlying);
    const bal = await TokenUtils.balanceOf(underlying, user.address);
    console.log('balance', utils.formatUnits(bal, dec), bal.toString());
    expect(+utils.formatUnits(bal, dec))
      .is.greaterThanOrEqual(+utils.formatUnits(amount, dec), 'not enough balance')

    const undBal = await vaultForUser.totalAssets();
    const totalSupply = await IERC20__factory.connect(vault.address, user).totalSupply();
    if (!totalSupply.isZero() && undBal.isZero()) {
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

    // const gauge = IGauge__factory.connect(await vault.gauge(), vault.signer);
    // const rt = Addresses.getCore().tetu; // TODO May we get reward tokens from the Gauge?
    const psRatio = 1;
    // const ppfsDecreaseAllowed = false; // await vault.ppfsDecreaseAllowed();

    const ppfs = +utils.formatUnits(await vault.sharePrice(), underlyingDecimals);
    const underlyingBalance = +utils.formatUnits(await vault.totalAssets(), underlyingDecimals);
    // const rtBal = +utils.formatUnits(await TokenUtils.balanceOf(rt, vault.address));

    console.log('splitter dohardworks');
    const splitterAddress = await vault.splitter();
    console.log("splitter", splitterAddress);
    const splitter = StrategySplitterV2__factory.connect(splitterAddress, vault.signer);

    const subStrategies = await splitter.allStrategies();
    for (const subStrategy of subStrategies) {
      const strategy = IStrategyV2__factory.connect(subStrategy, vault.signer);
      console.log('Call substrategy dohardwork', await strategy.NAME());

      // handle HardWork-event to extract earned and lost values
      const tx = await strategy.doHardWork();
      const receipt = await tx.wait();
      if (receipt.events) {
        console.log("Events", receipt);
        for (const event of receipt.events) {
          if (event.args && event.address === splitter.address) {
            dest.strategy.push(strategy.address);
            dest.earned.push(BigNumber.from(event.args[3]));
            dest.lost.push(BigNumber.from(event.args[4]));
            console.log("HardWork event is detected", event);
          }
        }
      }
    }

    console.log('hard works called');

    const ppfsAfter = +utils.formatUnits(await vault.sharePrice(), underlyingDecimals);
    const undBalAfter = +utils.formatUnits(await vault.totalAssets(), underlyingDecimals);
    // const psPpfsAfter = +utils.formatUnits(await psVaultCtr.getPricePerFullShare());
    // const rtBalAfter = +utils.formatUnits(await TokenUtils.balanceOf(rt, vault.address));

    console.log('-------- HARDWORK --------');
    console.log('- Vault Share price:', ppfsAfter);
    console.log('- Vault Share price change:', ppfsAfter - ppfs);
    console.log('- Vault und balance change:', undBalAfter - underlyingBalance);
    console.log('- Earned by the strategies:', dest.earned.reduce((p, c) => c = p.add(c), BigNumber.from(0)));
    console.log('- Lost by the strategies:', dest.lost.reduce((p, c) => c = p.add(c), BigNumber.from(0)));
    // console.log('- Vault first RT change:', rtBalAfter - rtBal);
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
