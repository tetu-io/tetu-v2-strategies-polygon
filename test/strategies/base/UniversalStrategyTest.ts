import { ethers } from 'hardhat';
import { IToolsContractsWrapper } from '../../ToolsContractsWrapper';
import { StrategyTestUtils } from '../../baseUT/utils/StrategyTestUtils';
import { IERC20__factory, IForwarder, IStrategyV2, ITetuLiquidator, TetuVaultV2 } from '../../../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ICoreContractsWrapper } from '../../CoreContractsWrapper';
import { DoHardWorkLoopBase, IDoHardWorkLoopInputParams } from '../../baseUT/utils/DoHardWorkLoopBase';
import { DeployInfo } from '../../baseUT/utils/DeployInfo';
import { SpecificStrategyTest } from './SpecificStrategyTest';
import { BigNumber } from 'ethers';
import { TimeUtils } from '../../../scripts/utils/TimeUtils';
import { DeployerUtilsLocal, IVaultStrategyInfo } from '../../../scripts/utils/DeployerUtilsLocal';
import { Misc } from '../../../scripts/utils/Misc';

export interface IUniversalStrategyInputParams {
  /** only for strategies where we expect PPFS fluctuations */
  balanceTolerance: number;
  deposit: number;
  /** number of blocks, at least 3 */
  loops: number;
  /** number of blocks or timestamp value, the meaning depends on advanceBlocks */
  loopValue: number;
  /** use 'true' if farmable platform values depends on blocks, instead you can use timestamp */
  advanceBlocks: boolean;

  /** add custom liquidation path if necessary */
  forwarderConfigurator?: ((forwarder: IForwarder) => Promise<void>);
  /** only for strategies where we expect PPFS fluctuations */
  ppfsDecreaseAllowed?: boolean;
  specificTests: SpecificStrategyTest[];

  /**
   * Set of params to pass to DoHardWorkLoopBase
   */
  hwParams: IDoHardWorkLoopInputParams;

  /**
   * A function to take snapshot of all available balances
   * to be able to save the states to CSV at the end of the test.
   * @param title A title of moment (i.e. "init", "loop step 1", "final" and so on)
   * @param h
   */
  stateRegistrar?: (title: string, h: DoHardWorkLoopBase) => Promise<void>;

  /**
   * A function to initialize strategy after deploy, i.e. set up various thresholds
   */
  strategyInit?: (strategy: IStrategyV2, vault: TetuVaultV2, user: SignerWithAddress) => Promise<void>;

  rebalancingStrategy?: boolean;

  swap1?: (strategy: IStrategyV2, swapUser: SignerWithAddress) => Promise<void>;

  swap2?: (strategy: IStrategyV2, swapUser: SignerWithAddress) => Promise<void>;

  makeVolume?: (strategy: IStrategyV2, swapUser: SignerWithAddress) => Promise<void>;
}

/**
 * Tests are generated dynamically, see https://mochajs.org/#dynamically-generating-tests
 */
async function universalStrategyTest(
  name: string,
  deployInfo: DeployInfo,
  deployer: (signer: SignerWithAddress) => Promise<IVaultStrategyInfo>,
  hardworkInitiator: (
    signer: SignerWithAddress,
    user: SignerWithAddress,
    swapUser: SignerWithAddress,
    core: ICoreContractsWrapper,
    tools: IToolsContractsWrapper,
    underlying: string,
    vault: TetuVaultV2,
    strategy: IStrategyV2,
    balanceTolerance: number,
  ) => DoHardWorkLoopBase,
  params: IUniversalStrategyInputParams,
) {

  describe(name + '_Test', async function() {
    let snapshotBefore: string;
    let snapshot: string;
    let signer: SignerWithAddress;
    let user: SignerWithAddress;
    let swapUser: SignerWithAddress;
    let asset: string;
    let vault: TetuVaultV2;
    let strategy: IStrategyV2;
    let userBalance: BigNumber;

    //region Before, after
    before(async function() {
      const start = Date.now();
      snapshotBefore = await TimeUtils.snapshot();
      signer = await DeployerUtilsLocal.impersonate(); // governance by default
      user = (await ethers.getSigners())[1];
      swapUser = (await ethers.getSigners())[2];
      const core = deployInfo.core as ICoreContractsWrapper;

      const data = await deployer(signer);
      vault = data.vault;
      strategy = data.strategy;
      asset = await vault.asset();

      if (params.forwarderConfigurator !== undefined) {
        await params.forwarderConfigurator(core.forwarder);
      }
      if (params.ppfsDecreaseAllowed) {
        throw Error('ppfsDecreaseAllowed not supported');
        // await core.vaultController.changePpfsDecreasePermissions([vault.address], true);
      }

      // set class variables for keep objects links
      deployInfo.signer = signer;
      deployInfo.user = user;
      deployInfo.asset = asset;
      deployInfo.vault = vault;
      deployInfo.strategy = strategy;

      // put deposit-amount to user's balance and the same amount on the signer's balance
      userBalance = await StrategyTestUtils.getUnderlying(
        user,
        asset,
        params.deposit,
        deployInfo?.tools?.liquidator as ITetuLiquidator,
        [signer.address],
      );

      if (params.strategyInit) {
        await params.strategyInit(strategy, vault, user);
      }

      // display initial balances
      console.log('Balance of signer', await IERC20__factory.connect(asset, signer).balanceOf(signer.address));
      console.log('Balance of user', await IERC20__factory.connect(asset, signer).balanceOf(user.address));

      Misc.printDuration('Test Preparations completed', start);
    });

    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });

    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    after(async function() {
      await TimeUtils.rollback(snapshotBefore);
    });
    //endregion Before, after

    //region Unit tests
    it('doHardWork loop', async function() {
      const core = deployInfo.core as ICoreContractsWrapper;
      const tools = deployInfo.tools as IToolsContractsWrapper;
      await hardworkInitiator(
        signer,
        user,
        swapUser,
        core,
        tools,
        asset,
        vault,
        strategy,
        params.balanceTolerance,
      ).start(
        userBalance,
        params.loops,
        params.loopValue,
        params.advanceBlocks,
        params.hwParams,
        params.stateRegistrar,
        params.swap1,
        params.swap2,
        params.rebalancingStrategy,
        params.makeVolume,
      );
    });

    it('common test should be ok', async() => {
      await StrategyTestUtils.commonTests(strategy, asset);
    });

    if (params.specificTests) {
      params.specificTests?.forEach(test => test.do(deployInfo));
    }
    //endregion Unit tests

  });
}

export { universalStrategyTest };
