import {ethers} from "hardhat";
import {IToolsContractsWrapper} from "../ToolsContractsWrapper";
import {StrategyTestUtils} from "./StrategyTestUtils";
import {
  IForwarder,
  ITetuLiquidator,
  TetuVaultV2,
  TetuVaultV2__factory,
  IStrategyV2
} from "../../typechain";
import {VaultUtils} from "../VaultUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ICoreContractsWrapper} from "../CoreContractsWrapper";
import {DoHardWorkLoopBase} from "./DoHardWorkLoopBase";
import {DeployInfo} from "./DeployInfo";
import {SpecificStrategyTest} from "./SpecificStrategyTest";
import {BigNumber} from "ethers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployerUtilsLocal, IVaultStrategyInfo} from "../../scripts/utils/DeployerUtilsLocal";
import {Misc} from "../../scripts/utils/Misc";
import {TokenUtils} from "../../scripts/utils/TokenUtils";
import {parseUnits} from "ethers/lib/utils";

async function universalStrategyTest(
  name: string,
  deployInfo: DeployInfo,
  deployer: (signer: SignerWithAddress) => Promise<IVaultStrategyInfo>,
  hardworkInitiator: (
    signer: SignerWithAddress,
    user: SignerWithAddress,
    core: ICoreContractsWrapper,
    tools: IToolsContractsWrapper,
    underlying: string,
    vault: TetuVaultV2,
    strategy: IStrategyV2,
    balanceTolerance: number
  ) => DoHardWorkLoopBase,
  forwarderConfigurator: ((forwarder: IForwarder) => Promise<void>) | null = null,
  ppfsDecreaseAllowed = false,
  balanceTolerance = 0,
  deposit = 100_000,
  loops = 9,
  loopValue = 300,
  advanceBlocks = true,
  specificTests: SpecificStrategyTest[] | null = null,
) {

  describe(name + "_Test", async function () {
    let snapshotBefore: string;
    let snapshot: string;
    let signer: SignerWithAddress;
    let user: SignerWithAddress;
    let asset: string;
    let vault: TetuVaultV2;
    let strategy: IStrategyV2;
    let userBalance: BigNumber;

    before(async function () {
      const start = Date.now();
      snapshotBefore = await TimeUtils.snapshot();
      signer = await DeployerUtilsLocal.impersonate();
      user = (await ethers.getSigners())[1];
      const core = deployInfo.core as ICoreContractsWrapper;

      const data = await deployer(signer);
      vault = data.vault;
      strategy = data.strategy;
      asset = await vault.asset();

      if (forwarderConfigurator !== null) {
        await forwarderConfigurator(core.forwarder);
      }
      if (ppfsDecreaseAllowed) {
        // await core.vaultController.changePpfsDecreasePermissions([vault.address], true);
      }
      // const firstRt = (await strategy.rewardTokens())[0];
      // if (firstRt.toLowerCase() === core.psVault.address.toLowerCase()) {
      //   await VaultUtils.addRewardsXTetu(signer, vault, core, 1);
      // }

      // set class variables for keep objects links
      deployInfo.signer = signer;
      deployInfo.user = user;
      deployInfo.asset = asset;
      deployInfo.vault = vault;
      deployInfo.strategy = strategy;

      // get asset
      if (await core.controller.isValidVault(asset)) {
        console.log('asset is a vault, need to wrap into xToken');
        const svUnd = TetuVaultV2__factory.connect(asset, signer);
        const svUndToken = await svUnd.asset();
        const svUndTokenBal = await StrategyTestUtils.getUnderlying(
          svUndToken,
          deposit,
          user,
          deployInfo?.tools?.liquidator as ITetuLiquidator,
          [signer.address],
        );
        console.log('svUndTokenBal', svUndTokenBal.toString());
        await VaultUtils.deposit(signer, svUnd, svUndTokenBal);
        await VaultUtils.deposit(user, svUnd, svUndTokenBal);
        userBalance = await TokenUtils.balanceOf(asset, signer.address);
      } else {
        userBalance = await StrategyTestUtils.getUnderlying(
          asset,
          deposit,
          user,
          deployInfo?.tools?.liquidator as ITetuLiquidator,
          [signer.address],
        );
      }
      await TokenUtils.wrapNetworkToken(signer, parseUnits('10000000').toString());
      Misc.printDuration('Test Preparations completed', start);
    });

    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    after(async function () {
      await TimeUtils.rollback(snapshotBefore);
    });

    it("doHardWork loop", async function () {
      const core = deployInfo.core as ICoreContractsWrapper;
      const tools = deployInfo.tools as IToolsContractsWrapper;
      await hardworkInitiator(
        signer,
        user,
        core,
        tools,
        asset,
        vault,
        strategy,
        balanceTolerance,
      ).start(userBalance, loops, loopValue, advanceBlocks);
    });

    it("common test should be ok", async () => {
      await StrategyTestUtils.commonTests(strategy, asset);
    });

    if (specificTests) {
      specificTests?.forEach(test => test.do(deployInfo));
    }
  });
}

export {universalStrategyTest};
