import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { UniversalTestUtils } from '../../../baseUT/utils/UniversalTestUtils';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import {
  getConverterAddress,
  getDForcePlatformAdapter,
  Misc,
} from '../../../../scripts/utils/Misc';
import { BalancerIntTestUtils, IPutInitialAmountsBalancesResults, IState } from './utils/BalancerIntTestUtils';
import { ConverterUtils } from '../../../baseUT/utils/ConverterUtils';
import {
  BalancerComposableStableStrategy,
  BalancerComposableStableStrategy__factory,
  ControllerV2__factory, ConverterController__factory, IController__factory,
  IERC20__factory,
  ISplitter,
  ISplitter__factory,
  IStrategyV2, ITetuConverter__factory,
  ITetuLiquidator,
  TetuVaultV2,
} from '../../../../typechain';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { PolygonAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';
import { ICoreContractsWrapper } from '../../../CoreContractsWrapper';
import { IToolsContractsWrapper } from '../../../ToolsContractsWrapper';
import { BigNumber } from 'ethers';
import { VaultUtils } from '../../../VaultUtils';
import { parseUnits } from 'ethers/lib/utils';
import { BalanceUtils } from '../../../baseUT/utils/BalanceUtils';
import { controlGasLimitsEx } from '../../../../scripts/utils/GasLimitUtils';
import {
  GAS_DEPOSIT_SIGNER,
  GAS_EMERGENCY_EXIT,
  GAS_FIRST_HARDWORK,
  GAS_HARDWORK_WITH_REWARDS,
  GAS_WITHDRAW_ALL_TO_SPLITTER,
} from '../../../baseUT/GasLimits';
import { areAlmostEqual } from '../../../baseUT/utils/MathUtils';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { TokenUtils } from '../../../../scripts/utils/TokenUtils';
import { MaticHolders } from '../../../../scripts/addresses/MaticHolders';
import {DeployTetuConverterApp} from "../../../baseUT/converter/DeployTetuConverterApp";

chai.use(chaiAsPromised);

/**
 * Tetu Converter is deployed
 */
describe('BalancerIntTest @skip-on-coverage', function() {
  //region Constants and variables
  const MAIN_ASSET: string = PolygonAddresses.USDC_TOKEN;

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let addresses: CoreAddresses;
  let tetuConverterAddress: string;
  let user: SignerWithAddress;

  //endregion Constants and variables

  //region before, after
  before(async function() {
    signer = await DeployerUtilsLocal.impersonate(); // governance by default
    user = (await ethers.getSigners())[1];
    console.log('signer', signer.address);
    console.log('user', user.address);

    snapshotBefore = await TimeUtils.snapshot();

    addresses = Addresses.getCore();
    const gelatoOpsReady = "0x527a819db1eb0e34426297b03bae11F2f8B3A19E";
    tetuConverterAddress = (await DeployTetuConverterApp.deployApp(
      signer,
      gelatoOpsReady,
      {
        blocksPerDay: 41142,
        minHealthFactor2: 105,
        targetHealthFactor2: 200,
        maxHealthFactor2: 400,
        disableAave3: false,
        disableAaveTwo: true,
        disableDForce: true
      }
    )).tetuConverter;

    await ConverterUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);
    await BalancerIntTestUtils.deployAndSetCustomSplitter(signer, addresses);

    // Disable DForce (as it reverts on repay after block advance)
    await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });
  //endregion before, after

  //region Integration tests
  describe('Single strategy with fees', () => {
    const COMPOUND_RATIO = 50_000;
    const REINVEST_THRESHOLD_PERCENT = 1_000;
    const DEPOSIT_AMOUNT = 100_000;
    const DEPOSIT_FEE = 2_00; // 100_000
    const BUFFER = 1_00; // 100_000
    const WITHDRAW_FEE = 5_00; // 100_000
    const DENOMINATOR = 100_000;

    let localSnapshotBefore: string;
    let localSnapshot: string;
    let core: ICoreContractsWrapper;
    let tools: IToolsContractsWrapper;
    let vault: TetuVaultV2;
    let strategy: BalancerComposableStableStrategy;
    let asset: string;
    let splitter: ISplitter;
    let stateBeforeDeposit: IState;
    let initialBalances: IPutInitialAmountsBalancesResults;
    let forwarder: string;

    /**
     * DEPOSIT_AMOUNT => user, DEPOSIT_AMOUNT/2 => signer, DEPOSIT_AMOUNT/2 => liquidator
     */
    async function enterToVault(): Promise<IState> {
      await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner);
      await VaultUtils.deposit(user, vault, initialBalances.balanceUser);
      await UniversalTestUtils.removeExcessTokens(asset, user, tools.liquidator.address);
      await UniversalTestUtils.removeExcessTokens(asset, signer, tools.liquidator.address);
      return BalancerIntTestUtils.getState(signer, user, strategy, vault, 'enterToVault');
    }

    before(async function() {
      [signer] = await ethers.getSigners();
      localSnapshotBefore = await TimeUtils.snapshot();

      core = await DeployerUtilsLocal.getCoreAddressesWrapper(signer);
      tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);

      const data = await UniversalTestUtils.makeBalancerComposableStableStrategyDeployer(
        signer,
        addresses,
        MAIN_ASSET,
        tetuConverterAddress,
        'BalancerComposableStableStrategy',
        {
          depositFee: DEPOSIT_FEE,
          buffer: BUFFER,
          withdrawFee: WITHDRAW_FEE,
        },
      );

      vault = data.vault;
      asset = await data.vault.asset();
      strategy = data.strategy as unknown as BalancerComposableStableStrategy;
      await ConverterUtils.addToWhitelist(signer, tetuConverterAddress, strategy.address);
      splitter = ISplitter__factory.connect(await vault.splitter(), signer);
      forwarder = await ControllerV2__factory.connect(await vault.controller(), signer).forwarder();
      console.log('vault', vault.address);
      console.log('strategy', strategy.address);
      console.log('splitter', splitter.address);
      console.log('forwarder', forwarder);

      await UniversalTestUtils.setCompoundRatio(strategy as unknown as IStrategyV2, user, COMPOUND_RATIO);
      await BalancerIntTestUtils.setThresholds(
        strategy as unknown as IStrategyV2,
        user,
        { reinvestThresholdPercent: REINVEST_THRESHOLD_PERCENT },
      );

      initialBalances = await BalancerIntTestUtils.putInitialAmountsToBalances(
        asset,
        user,
        signer,
        tools.liquidator as ITetuLiquidator,
        DEPOSIT_AMOUNT,
      );

      stateBeforeDeposit = await BalancerIntTestUtils.getState(signer, user, strategy, vault);
    });

    after(async function() {
      await TimeUtils.rollback(localSnapshotBefore);
    });

    beforeEach(async function() {
      localSnapshot = await TimeUtils.snapshot();
    });

    afterEach(async function() {
      await TimeUtils.rollback(localSnapshot);
    });

    describe("requirePayAmountBack", () => {
      describe("Forcibly close all borrows", () => {
        it("should return expected values", async () => {
          await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner);
          const stateAfterDeposit = await BalancerIntTestUtils.getState(signer, user, strategy, vault, 'enterToVault');
          console.log("stateAfterDeposit", stateAfterDeposit);

          await ConverterUtils.setTetuConverterPause(signer, tetuConverterAddress, true);

          // tetu converter as governance
          const controller = ConverterController__factory.connect(
            await ITetuConverter__factory.connect(tetuConverterAddress, signer).controller(),
            signer
          );
          const governance = await controller.governance();
          const tetuConverterAsGovernance = ITetuConverter__factory.connect(
            tetuConverterAddress,
            await Misc.impersonate(governance)
          );

          // get all borrows and forcibly close them
          const borrowManager = await ConverterUtils.getBorrowManager(signer, tetuConverterAddress);
          const countBorrows = (await borrowManager.listPoolAdaptersLength()).toNumber();
          for (let i = 0; i < countBorrows; ++i) {
            const poolAdapter = await borrowManager.listPoolAdapters(i);
            console.log("7");
            await tetuConverterAsGovernance.repayTheBorrow(poolAdapter, true);
            console.log("8");
          }
          console.log("9");

          // we need to make hardwork to recalculate investedAssets amount
          await ConverterUtils.setTetuConverterPause(signer, tetuConverterAddress, false);
          console.log("10");
          const stateMiddle = await BalancerIntTestUtils.getState(signer, user, strategy, vault, 'middle');
          console.log("stateMiddle", stateMiddle);

          await BalancerIntTestUtils.saveListStatesToCSVColumns(
            './tmp/npc_requirePayAmountBack1.csv',
            [stateAfterDeposit, stateMiddle],
          );


          await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();

          const afterHardwork = await BalancerIntTestUtils.getState(signer, user, strategy, vault, 'final');
          console.log("afterHardwork", afterHardwork);

          const ret = [
            stateAfterDeposit.gauge.strategyBalance.gt(0),
            stateAfterDeposit.converter.amountToRepayDai.gt(0),
            stateAfterDeposit.converter.amountToRepayUsdt.gt(0),
            stateAfterDeposit.converter.collateralForDai.gt(0),
            stateAfterDeposit.converter.collateralForUsdt.gt(0),

            afterHardwork.gauge.strategyBalance.eq(0),
            afterHardwork.converter.amountToRepayDai.eq(0),
            afterHardwork.converter.amountToRepayUsdt.eq(0),
            afterHardwork.converter.collateralForDai.eq(0),
            afterHardwork.converter.collateralForUsdt.eq(0),

            stateAfterDeposit.vault.sharePrice.eq(afterHardwork.vault.sharePrice)
          ].join("\n");

          const expected = [
            true, true, true, true, true,
            true, true, true, true, true,
            true
          ].join("\n");

          await BalancerIntTestUtils.saveListStatesToCSVColumns(
            './tmp/npc_requirePayAmountBack.csv',
            [stateAfterDeposit, afterHardwork],
          );

          expect(ret).eq(expected);

        });
      });
    });

  });

  //endregion Integration tests
});
