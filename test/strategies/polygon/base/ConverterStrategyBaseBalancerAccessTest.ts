import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { PolygonAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';
import { parseUnits } from 'ethers/lib/utils';
import {
  BalancerComposableStableStrategyAccess,
  BalancerComposableStableStrategyAccess__factory,
  ControllerV2__factory,
  IConverterController__factory,
  IERC20__factory,
  IPriceOracle,
  IPriceOracle__factory,
  ISplitter,
  ISplitter__factory,
  IStrategyV2,
  ITetuConverter__factory,
  ITetuLiquidator,
  TetuVaultV2,
} from '../../../../typechain';
import { MaticHolders } from '../../../../scripts/addresses/MaticHolders';
import {
  getConverterAddress,
  getDForcePlatformAdapter,
  getHundredFinancePlatformAdapter,
  Misc,
} from '../../../../scripts/utils/Misc';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import {
  BalancerIntTestUtils,
  IPutInitialAmountsBalancesResults,
  IState,
} from '../balancer/utils/BalancerIntTestUtils';
import { ConverterUtils } from '../../../baseUT/utils/ConverterUtils';
import { ICoreContractsWrapper } from '../../../CoreContractsWrapper';
import { IToolsContractsWrapper } from '../../../ToolsContractsWrapper';
import { VaultUtils } from '../../../VaultUtils';
import { UniversalTestUtils } from '../../../baseUT/utils/UniversalTestUtils';
import { Signer } from 'ethers';
import { Provider } from '@ethersproject/providers';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { expect } from 'chai';

/**
 * Test of ConverterStrategyBase using direct access to internal functions
 * through BalancerComposableStableStrategyAccess (so, real depositor is used)
 */
describe('ConverterStrategyBaseBalancerAccessTest', function() {
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
    tetuConverterAddress = getConverterAddress();

    await BalancerIntTestUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);
    await BalancerIntTestUtils.deployAndSetCustomSplitter(signer, addresses);

    // Disable DForce (as it reverts on repay after block advance)
    await ConverterUtils.disablePlatformAdapter(signer, getDForcePlatformAdapter());

    // Disable Hundred Finance (no liquidity)
    await ConverterUtils.disablePlatformAdapter(signer, getHundredFinancePlatformAdapter());
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

  //region Unit tests
  describe('Use single strategy ConverterStrategyBaseBalancerAccess', () => {
    //region constants, variables, before, after
    const COMPOUND_RATIO = 50_000;
    const REINVEST_THRESHOLD_PERCENT = 1_000;
    const DEPOSIT_AMOUNT = 100_000;
    const DEPOSIT_FEE = 2_00; // 100_000
    const BUFFER = 1_00; // 100_000
    const WITHDRAW_FEE = 5_00; // 100_000

    let localSnapshotBefore: string;
    let localSnapshot: string;
    let core: ICoreContractsWrapper;
    let tools: IToolsContractsWrapper;
    let vault: TetuVaultV2;
    let strategy: BalancerComposableStableStrategyAccess;
    let asset: string;
    let splitter: ISplitter;
    let stateBeforeDeposit: IState;
    let initialBalances: IPutInitialAmountsBalancesResults;
    let forwarder: string;
    /** Price oracle from tetuConverter */
    let priceOracle: IPriceOracle;

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

      const data = await UniversalTestUtils.makeStrategyDeployer(
        signer,
        addresses,
        MAIN_ASSET,
        tetuConverterAddress,
        'BalancerComposableStableStrategyAccess',
        async(strategyProxy: string, signerOrProvider: Signer | Provider, splitterAddress: string) => {
          const _strategy = BalancerComposableStableStrategyAccess__factory.connect(strategyProxy, signer);
          await _strategy.init(addresses.controller, splitterAddress, tetuConverterAddress);
          return _strategy as unknown as IStrategyV2;
        },
        {
          depositFee: DEPOSIT_FEE,
          buffer: BUFFER,
          withdrawFee: WITHDRAW_FEE,
        },
      );

      vault = data.vault;
      asset = await data.vault.asset();
      strategy = data.strategy as unknown as BalancerComposableStableStrategyAccess;
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

      const tetuConverter = ITetuConverter__factory.connect(await strategy.converter(), signer);
      const tetuController = IConverterController__factory.connect(await tetuConverter.controller(), signer);
      priceOracle = IPriceOracle__factory.connect(await tetuController.priceOracle(), signer);
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
    //endregion constants, variables, before, after

    describe('_depositToPoolAccess', () => {
      it('should return expected totalAssetsDelta, updateTotalAssetsBeforeInvest_ = true', async() => {
        // increase invested assets amount on 1 USDT
        await strategy.setBaseAmountAccess(PolygonAddresses.USDT_TOKEN, parseUnits('1', 6));
        await strategy.setBaseAmountAccess(PolygonAddresses.USDC_TOKEN, parseUnits('77', 6));

        // deposit 77 USDC
        await IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, await Misc.impersonate(MaticHolders.HOLDER_USDC))
          .transfer(strategy.address, parseUnits('77', 6));
        const ret = await strategy.callStatic._depositToPoolAccess(parseUnits('77', 6), true);

        const priceUSDC = await priceOracle.getAssetPrice(MaticAddresses.USDC_TOKEN);
        const priceUSDT = await priceOracle.getAssetPrice(MaticAddresses.USDT_TOKEN);

        const expectedTotalAssetsDelta = parseUnits('1', 6).mul(priceUSDT).div(priceUSDC);
        expect(ret).eq(expectedTotalAssetsDelta);
      });
      it('should return zero totalAssetsDelta, updateTotalAssetsBeforeInvest_ = false', async() => {
        // increase invested assets amount on 1 USDT
        await strategy.setBaseAmountAccess(PolygonAddresses.USDT_TOKEN, parseUnits('1', 6));
        await strategy.setBaseAmountAccess(PolygonAddresses.USDC_TOKEN, parseUnits('77', 6));

        // deposit 77 USDC
        await IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, await Misc.impersonate(MaticHolders.HOLDER_USDC))
          .transfer(strategy.address, parseUnits('77', 6));
        const ret = await strategy.callStatic._depositToPoolAccess(parseUnits('77', 6), false);

        expect(ret).eq(0);
      });
    });

    describe('_withdrawFromPool', () => {
      it('should return expected totalAssetsDelta', async() => {
        await strategy.setBaseAmountAccess(PolygonAddresses.USDC_TOKEN, parseUnits('77', 6));

        // deposit 77 USDC
        await IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, await Misc.impersonate(MaticHolders.HOLDER_USDC))
          .transfer(strategy.address, parseUnits('77', 6));
        await strategy._depositToPoolAccess(parseUnits('77', 6), true);

        // increase invested assets amount on 1 USDT before withdraw
        await strategy.setBaseAmountAccess(
          PolygonAddresses.USDT_TOKEN,
          (await strategy.baseAmounts(PolygonAddresses.USDT_TOKEN)).add(parseUnits('1', 6)),
        );
        await IERC20__factory.connect(PolygonAddresses.USDT_TOKEN, await Misc.impersonate(MaticHolders.HOLDER_USDC))
          .transfer(strategy.address, parseUnits('1', 6));

        // withdraw
        const r = await strategy.callStatic._withdrawFromPoolAccess(parseUnits('55', 6));

        const priceUSDC = await priceOracle.getAssetPrice(MaticAddresses.USDC_TOKEN);
        const priceUSDT = await priceOracle.getAssetPrice(MaticAddresses.USDT_TOKEN);
        console.log('priceUSDC', priceUSDC);
        console.log('priceUSDT', priceUSDT);

        const expectedTotalAssetsDelta = parseUnits('1', 6).mul(priceUSDT).div(priceUSDC);

        console.log('ret', r);
        console.log('expectedTotalAssetsDelta', expectedTotalAssetsDelta.toString());

        const ret = r.totalAssetsDelta.sub(expectedTotalAssetsDelta).abs();

        // we can have a difference of several tokens because of the rounding
        // in contract we have S1*PB/PC - S2*PB/PC, but here we have only (S1-S2)*PB/PC
        expect(ret.lt(10)).eq(true);
      });
    });

    // todo fix
    describe.skip('_withdrawAllFromPool', () => {
      it('should return expected totalAssetsDelta', async() => {
        await strategy.setBaseAmountAccess(PolygonAddresses.USDC_TOKEN, parseUnits('77', 6));

        // deposit 77 USDC
        await IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, await Misc.impersonate(MaticHolders.HOLDER_USDC))
          .transfer(strategy.address, parseUnits('77', 6));
        await strategy._depositToPoolAccess(parseUnits('77', 6), true);

        // increase invested assets amount on 1 USDT before withdraw
        await strategy.setBaseAmountAccess(
          PolygonAddresses.USDT_TOKEN,
          (await strategy.baseAmounts(PolygonAddresses.USDT_TOKEN)).add(parseUnits('1', 6)),
        );
        await IERC20__factory.connect(PolygonAddresses.USDT_TOKEN, await Misc.impersonate(MaticHolders.HOLDER_USDC))
          .transfer(strategy.address, parseUnits('1', 6));

        // withdraw
        const r = await strategy.callStatic._withdrawAllFromPoolAccess();

        const priceUSDC = await priceOracle.getAssetPrice(MaticAddresses.USDC_TOKEN);
        const priceUSDT = await priceOracle.getAssetPrice(MaticAddresses.USDT_TOKEN);

        const expectedTotalAssetsDelta = parseUnits('1', 6).mul(priceUSDT).div(priceUSDC);

        console.log('ret', r);
        console.log('expectedTotalAssetsDelta', expectedTotalAssetsDelta.toString());

        const ret = r.totalAssetsDelta.sub(expectedTotalAssetsDelta).abs();

        // we can have a difference of several tokens because of the rounding
        // in contract we have S1*PB/PC - S2*PB/PC, but here we have only (S1-S2)*PB/PC
        expect(ret.lt(10)).eq(true);

      });
    });
  });

  //endregion Unit tests
});
