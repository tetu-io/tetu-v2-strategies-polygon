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
import { ConverterUtils } from '../../../baseUT/utils/ConverterUtils';
import {
  BalancerBoostedStrategy, BalancerBoostedStrategy__factory,
  ControllerV2__factory, ConverterController__factory, IBVault__factory,
  IERC20__factory, IERC20Metadata__factory, ILinearPool__factory,
  ISplitter,
  ISplitter__factory,
  IStrategyV2, ITetuConverter__factory,
  ITetuLiquidator,
  TetuVaultV2, VaultFactory__factory,
} from '../../../../typechain';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { PolygonAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';
import { ICoreContractsWrapper } from '../../../baseUT/universalTestUtils/CoreContractsWrapper';
import { IToolsContractsWrapper } from '../../../baseUT/universalTestUtils/ToolsContractsWrapper';
import {BigNumber, Signer} from 'ethers';
import { VaultUtils } from '../../../baseUT/universalTestUtils/VaultUtils';
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
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { TokenUtils } from '../../../../scripts/utils/TokenUtils';
import { MaticHolders } from '../../../../scripts/addresses/MaticHolders';
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {IPutInitialAmountsBalancesResults, IState, IStateParams, StateUtils} from "../../../baseUT/universalTestUtils/StateUtils";
import {Provider} from "@ethersproject/providers";
import {BalancerStrategyUtils} from "../../../baseUT/strategies/BalancerStrategyUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {eq} from "lodash";

chai.use(chaiAsPromised);

/**
 * Integration time-consuming tests, so @skip-on-coverage
 */
describe.skip('BalancerBoostedIntTest @skip-on-coverage', function() {
  //region Constants and variables
  const MAIN_ASSET: string = PolygonAddresses.USDC_TOKEN;
  const pool: string = MaticAddresses.BALANCER_POOL_T_USD;

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let addresses: CoreAddresses;
  let tetuConverterAddress: string;
  let user: SignerWithAddress;
  let stateParams: IStateParams;

  //endregion Constants and variables

  //region before, after
  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    signer = await DeployerUtilsLocal.impersonate(); // governance by default
    user = (await ethers.getSigners())[1];
    console.log('signer', signer.address);
    console.log('user', user.address);

    snapshotBefore = await TimeUtils.snapshot();

    addresses = Addresses.getCore();
    tetuConverterAddress = getConverterAddress();

    await ConverterUtils.setTetConverterHealthFactors(signer, tetuConverterAddress);

    // use the latest implementations
    const vaultLogic = await DeployerUtils.deployContract(signer, 'TetuVaultV2');
    const vaultFactory = VaultFactory__factory.connect(addresses.vaultFactory, signer);
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer)
    await vaultFactory.connect(gov).setVaultImpl(vaultLogic.address);
    await StrategyTestUtils.deployAndSetCustomSplitter(signer, addresses);

    // Disable DForce (as it reverts on repay after block advance)
    // await ConverterUtils.disablePlatformAdapter(signer, await getDForcePlatformAdapter(signer));

    stateParams = {
      mainAssetSymbol: await IERC20Metadata__factory.connect(MAIN_ASSET, signer).symbol()
    }
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
    let strategy: BalancerBoostedStrategy;
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
      return StateUtils.getState(signer, user, strategy, vault, 'enterToVault');
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
        'BalancerBoostedStrategy',
        async(strategyProxy: string, signerOrProvider: Signer | Provider, splitterAddress: string) => {
          const strategyContract = BalancerBoostedStrategy__factory.connect(strategyProxy, signer);
          await strategyContract.init(core.controller.address, splitterAddress, tetuConverterAddress, pool, MaticAddresses.BALANCER_GAUGE_V2_T_USD);
          return strategyContract as unknown as IStrategyV2;
        },
        {
          depositFee: DEPOSIT_FEE,
          buffer: BUFFER,
          withdrawFee: WITHDRAW_FEE,
        },
      );

      vault = data.vault;
      asset = await data.vault.asset();
      strategy = data.strategy as unknown as BalancerBoostedStrategy;
      await ConverterUtils.addToWhitelist(signer, tetuConverterAddress, strategy.address);
      splitter = ISplitter__factory.connect(await vault.splitter(), signer);
      forwarder = await ControllerV2__factory.connect(await vault.controller(), signer).forwarder();
      console.log('vault', vault.address);
      console.log('strategy', strategy.address);
      console.log('splitter', splitter.address);
      console.log('forwarder', forwarder);

      await UniversalTestUtils.setCompoundRatio(strategy as unknown as IStrategyV2, user, COMPOUND_RATIO);
      await StrategyTestUtils.setThresholds(
        strategy as unknown as IStrategyV2,
        user,
        { reinvestThresholdPercent: REINVEST_THRESHOLD_PERCENT },
      );

      initialBalances = await StrategyTestUtils.putInitialAmountsToBalances(
        asset,
        user,
        signer,
        tools.liquidator as ITetuLiquidator,
        DEPOSIT_AMOUNT,
      );

      stateBeforeDeposit = await StateUtils.getState(signer, user, strategy, vault);

      const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)
      const pools = [
        {
          pool: MaticAddresses.UNISWAPV3_USDC_DAI_100,
          swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
          tokenIn: MaticAddresses.DAI_TOKEN,
          tokenOut: MaticAddresses.USDC_TOKEN,
        },
        {
          pool: MaticAddresses.UNISWAPV3_USDC_USDT_100,
          swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
          tokenIn: MaticAddresses.USDT_TOKEN,
          tokenOut: MaticAddresses.USDC_TOKEN,
        },
      ]
      await tools.liquidator.connect(operator).addBlueChipsPools(pools, true)
      await tools.liquidator.connect(operator).addLargestPools(pools, true);
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

    describe('State before deposit', () => {
      it('should have expected values', async() => {
        const ret = [
          stateBeforeDeposit.signer.assetBalance.eq(parseUnits(DEPOSIT_AMOUNT.toString(), 6).div(2)),
          stateBeforeDeposit.user.assetBalance.eq(parseUnits(DEPOSIT_AMOUNT.toString(), 6)),
          stateBeforeDeposit.gauge.strategyBalance?.eq(0),

          await vault.depositFee(),
          await vault.buffer(),
          await vault.withdrawFee(),
        ].map(x => BalanceUtils.toString(x)).join('\n');
        const expected = [
          true,
          true,
          true,

          DEPOSIT_FEE,
          BUFFER,
          WITHDRAW_FEE,
        ].map(x => BalanceUtils.toString(x)).join('\n');
        expect(ret).eq(expected);
      });
    });

    describe('Single actions', () => {
      describe('State after depositing 50_000 by signer', () => {
        it('should have expected values', async() => {
          // some insurance is immediately used to recover entry-loss during the depositing
          const d = await (await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner)).wait();
          const recoveredLoss = await UniversalTestUtils.extractLossCovered(
            d,
            vault.address,
          ) || BigNumber.from(0);
          const stateAfterDeposit = await StateUtils.getState(signer, user, strategy, vault);

          expect(stateAfterDeposit.signer.assetBalance).eq(0)
          expect(stateAfterDeposit.user.assetBalance).eq(parseUnits(DEPOSIT_AMOUNT.toString(), 6))
          // expect(stateAfterDeposit.strategy.assetBalance).eq(0) // todo proportional entry
          expect(stateAfterDeposit.strategy.assetBalance).eq(stateAfterDeposit.strategy.totalAssets.sub(stateAfterDeposit.strategy.investedAssets))
          expect(stateAfterDeposit.gauge.strategyBalance).gt(0)
          expect(stateAfterDeposit.splitter.totalAssets).eq(stateAfterDeposit.strategy.totalAssets)
          expect(stateAfterDeposit.vault.userShares.add(stateAfterDeposit.vault.signerShares)).eq(stateAfterDeposit.vault.totalSupply.sub(1000)) // sub INITIAL_SHARES
          expect(stateAfterDeposit.vault.userAssetBalance.add(stateAfterDeposit.vault.signerAssetBalance)).approximately(stateAfterDeposit.vault.totalSupply.sub(1000), 1);
          expect(stateAfterDeposit.vault.totalAssets).approximately(stateAfterDeposit.vault.totalSupply, 1);
          expect(stateAfterDeposit.vault.totalAssets).approximately(
            parseUnits((DEPOSIT_AMOUNT / 2).toString(), 6).mul(DENOMINATOR - DEPOSIT_FEE).div(DENOMINATOR),
            1
          );
          expect(stateAfterDeposit.insurance.assetBalance).eq(stateBeforeDeposit.signer.assetBalance
            .mul(DEPOSIT_FEE)
            .div(100_000)
            .sub(recoveredLoss))
          expect(stateAfterDeposit.vault.assetBalance).eq(stateBeforeDeposit.signer.assetBalance
            .mul(100_000 - DEPOSIT_FEE)
            .div(100_000)
            .mul(BUFFER)
            .div(100_000)
            .add(recoveredLoss))
        });
        it('should not exceed gas limits @skip-on-coverage', async() => {
          const cr = await (await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner)).wait();
          controlGasLimitsEx(cr.gasUsed, GAS_DEPOSIT_SIGNER, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      describe('State after depositing 50_000 by signer and 100_000 by user', () => {
        it('should have expected values', async() => {
          // some insurance is immediately used to recover entry-loss during the depositing
          const recoveredLossSigner = await UniversalTestUtils.extractLossCovered(
            await (await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner)).wait(),
            vault.address,
          ) || BigNumber.from(0);

          const recoveredLossUser = await UniversalTestUtils.extractLossCovered(
            await (await VaultUtils.deposit(user, vault, initialBalances.balanceUser)).wait(),
            vault.address,
          ) || BigNumber.from(0);

          const stateAfterDepositUser = await StateUtils.getState(signer, user, strategy, vault);

          expect(stateAfterDepositUser.signer.assetBalance).eq(0)
          expect(stateAfterDepositUser.user.assetBalance).eq(0)
          expect(stateAfterDepositUser.strategy.assetBalance).gt(0)
          expect(stateAfterDepositUser.strategy.assetBalance).eq(stateAfterDepositUser.strategy.totalAssets.sub(stateAfterDepositUser.strategy.investedAssets))
          expect(stateAfterDepositUser.gauge.strategyBalance).gt(0)
          expect(stateAfterDepositUser.splitter.totalAssets).eq(stateAfterDepositUser.strategy.totalAssets)
          expect(stateAfterDepositUser.vault.userShares.add(stateAfterDepositUser.vault.signerShares)).eq(stateAfterDepositUser.vault.totalSupply.sub(1000)) // INITIAL_SHARES
          expect(stateAfterDepositUser.vault.userAssetBalance.add(stateAfterDepositUser.vault.signerAssetBalance)).gt(stateAfterDepositUser.vault.totalSupply.sub(1000)) // INITIAL_SHARES
          expect(stateAfterDepositUser.vault.totalAssets).gt(stateAfterDepositUser.vault.totalSupply.sub(1000))
          expect(stateAfterDepositUser.vault.totalAssets).approximately(
            parseUnits((DEPOSIT_AMOUNT * 1.5).toString(), 6)
              .mul(DENOMINATOR - DEPOSIT_FEE)
              .div(DENOMINATOR),
              1
          );
          expect(stateAfterDepositUser.insurance.assetBalance).eq(stateBeforeDeposit.signer.assetBalance
            .mul(DEPOSIT_FEE)
            .div(DENOMINATOR)
            .sub(recoveredLossSigner)
            .add(
              stateBeforeDeposit.user.assetBalance
                .mul(DEPOSIT_FEE)
                .div(DENOMINATOR)
                .sub(recoveredLossUser),
            ))
          expect(stateAfterDepositUser.vault.assetBalance).approximately(
            stateBeforeDeposit.signer.assetBalance
              .mul(DENOMINATOR - DEPOSIT_FEE)
              .div(DENOMINATOR)
              .mul(BUFFER)
              .div(DENOMINATOR)
              // first recovered amount recoveredLossSigner is invested together with user's deposit
              // so it's not kept on vault's balance anymore
              // .add(recoveredLossSigner)
              .add(
                stateBeforeDeposit.user.assetBalance
                  .mul(DENOMINATOR - DEPOSIT_FEE)
                  .div(DENOMINATOR)
                  .mul(BUFFER)
                  .div(DENOMINATOR)
                  .add(recoveredLossUser),
              ),
            1
          );
          console.log('stateBeforeDeposit', stateBeforeDeposit);
          console.log('stateAfterDepositUser', stateAfterDepositUser);
        });
      });

      describe('Hardwork after initial deposit, no rewards', () => {
        it('should return expected values', async() => {
          const stateAfterDeposit = await enterToVault();

          // initial deposit doesn't invest all amount to pool
          // a first hardwork make additional investment
          await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
          const stateAfterHardwork = await StateUtils.getState(signer, user, strategy, vault);

          expect(stateAfterDeposit.strategy.assetBalance).gt(stateAfterHardwork.strategy.assetBalance)
          expect(stateAfterDeposit.strategy.borrowAssetsBalances[0]).gte(stateAfterHardwork.strategy.borrowAssetsBalances[0])
          expect(stateAfterDeposit.strategy.borrowAssetsBalances[1]).gte(stateAfterHardwork.strategy.borrowAssetsBalances[1])
          expect(stateAfterHardwork.strategy.investedAssets).gte(stateBeforeDeposit.strategy.investedAssets)
          expect(stateAfterHardwork.gauge.strategyBalance).gte(stateBeforeDeposit.gauge.strategyBalance)
          expect(stateAfterHardwork.splitter.totalAssets).gte(stateAfterDeposit.splitter.totalAssets)
          expect(stateAfterDeposit.splitter.totalAssets).approximately(stateAfterHardwork.splitter.totalAssets, 10);

          console.log('stateBeforeDeposit', stateBeforeDeposit);
          console.log('stateAfterDeposit', stateAfterDeposit);
          console.log('stateAfterHardwork', stateAfterHardwork);
        });
        it('should not exceed gas limits @skip-on-coverage', async() => {
          const gasUsed = await strategy.connect(await Misc.impersonate(splitter.address)).estimateGas.doHardWork();
          controlGasLimitsEx(gasUsed, GAS_FIRST_HARDWORK, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      describe('Hardwork with a lack of asset in the linear pool', () => {
        it('should work', async() => {

          const poolId = await strategy.poolId()
          const otherTokenAndLinearPool = await BalancerStrategyUtils.getOtherTokenAndLinearPool(poolId, await strategy.asset(), MaticAddresses.BALANCER_VAULT, signer)
          console.log('Other token', otherTokenAndLinearPool[0])
          console.log('Linear pool', otherTokenAndLinearPool[1])
          const linearPoolId = ILinearPool__factory.connect(otherTokenAndLinearPool[1], signer).getPoolId()
          let linearPoolTokens = await IBVault__factory.connect(MaticAddresses.BALANCER_VAULT, signer).getPoolTokens(linearPoolId)
          let mainTokenIndexInLinearPool
          for (let i = 0; i < linearPoolTokens[0].length; i++) {
            if (linearPoolTokens[0][i] === otherTokenAndLinearPool[0]) {
              mainTokenIndexInLinearPool = i
              break
            }
          }
          if (!mainTokenIndexInLinearPool) {
            throw new Error()
          }

          console.log('mainTokenIndexInLinearPool', mainTokenIndexInLinearPool)
          const linearPoolMainTokenBalanceBefore = linearPoolTokens[1][mainTokenIndexInLinearPool]
          console.log('linearPoolMainTokenBalance initial', linearPoolMainTokenBalanceBefore)

          await enterToVault();
          linearPoolTokens = await IBVault__factory.connect(MaticAddresses.BALANCER_VAULT, signer).getPoolTokens(linearPoolId)
          const linearPoolMainTokenBalanceAfterDeposit = linearPoolTokens[1][mainTokenIndexInLinearPool]
          console.log('linearPoolMainTokenBalance after deposit', linearPoolMainTokenBalanceAfterDeposit)

          await BalancerStrategyUtils.bbSwap(pool.substring(0, 42), await strategy.asset(), otherTokenAndLinearPool[0], linearPoolMainTokenBalanceBefore.add(parseUnits('10000', 6)), MaticAddresses.BALANCER_VAULT, signer)

          linearPoolTokens = await IBVault__factory.connect(MaticAddresses.BALANCER_VAULT, signer).getPoolTokens(linearPoolId)
          console.log('linearPoolMainTokenBalance after bbSwap', linearPoolTokens[1][mainTokenIndexInLinearPool])

          // now amount in linear pool less then deposited by strategy
          expect(linearPoolMainTokenBalanceAfterDeposit.sub(linearPoolMainTokenBalanceBefore)).gt(linearPoolTokens[1][mainTokenIndexInLinearPool])

          await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
        });
      })

      describe('withdrawAllToSplitter', () => {

        it('should return expected values', async() => {
          const stateAfterDeposit = await enterToVault();
          await strategy.connect(
            await Misc.impersonate(splitter.address),
          ).withdrawAllToSplitter();
          const stateAfterWithdraw = await StateUtils.getState(signer, user, strategy, vault);

          console.log('stateBeforeDeposit', stateBeforeDeposit);
          console.log('stateAfterDeposit', stateAfterDeposit);
          console.log('stateAfterWithdraw', stateAfterWithdraw);

          expect(stateAfterWithdraw.gauge.strategyBalance).eq(0)
          expect(stateAfterWithdraw.strategy.assetBalance).eq(0)
          expect(stateAfterWithdraw.strategy.borrowAssetsBalances[0]).eq(0)
          expect(stateAfterWithdraw.strategy.borrowAssetsBalances[1]).eq(0)
          expect(stateAfterWithdraw.strategy.totalAssets).eq(0)
          expect(stateAfterWithdraw.strategy.investedAssets).eq(0)
          expect(stateAfterWithdraw.splitter.assetBalance).approximately(stateAfterWithdraw.splitter.totalAssets, 10);
          expect(stateAfterWithdraw.vault.totalSupply).eq(stateAfterDeposit.vault.totalSupply)

          // when leaving the pool, we pay a fee to linear pools (0.0002%)
          expect(stateAfterWithdraw.vault.totalAssets).approximately(stateAfterDeposit.vault.totalAssets, 10);
          expect(stateAfterWithdraw.vault.sharePrice).lt(stateAfterDeposit.vault.sharePrice)
        });
        it('should not exceed gas limits @skip-on-coverage', async() => {
          const gasUsed = await strategy.connect(
            await Misc.impersonate(splitter.address),
          ).estimateGas.withdrawAllToSplitter();
          controlGasLimitsEx(gasUsed, GAS_WITHDRAW_ALL_TO_SPLITTER, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      describe('withdrawToSplitter', () => {
        it('should return expected values', async() => {
          const stateAfterDeposit = await enterToVault();

          const amountToWithdraw = parseUnits(DEPOSIT_AMOUNT.toString(), 6).div(2);
          await strategy.connect(
            await Misc.impersonate(splitter.address),
          ).withdrawToSplitter(amountToWithdraw);
          const stateAfterWithdraw = await StateUtils.getState(signer, user, strategy, vault);

          expect(stateAfterWithdraw.splitter.assetBalance).eq(amountToWithdraw)
          expect(stateAfterWithdraw.strategy.liquidity).eq(0)
          console.log('stateBeforeDeposit', stateBeforeDeposit);
          console.log('stateAfterDeposit', stateAfterDeposit);
          console.log('stateAfterWithdraw', stateAfterWithdraw);
        });
      });

      describe('Emergency exit', () => {
        it('should return expected values', async() => {
          const stateAfterDeposit = await enterToVault();

          const strategyAsOperator = await BalancerBoostedStrategy__factory.connect(
            strategy.address,
            await UniversalTestUtils.getAnOperator(strategy.address, signer),
          );
          await strategyAsOperator.emergencyExit();

          const stateAfterExit = await StateUtils.getState(signer, user, strategy, vault);

          console.log('stateBeforeDeposit', stateBeforeDeposit);
          console.log('stateAfterDeposit', stateAfterDeposit);
          console.log('stateAfterExit', stateAfterExit);

          expect(stateAfterExit.gauge.strategyBalance).eq(0)
          expect(stateAfterExit.strategy.assetBalance).eq(0)
          expect(stateAfterExit.strategy.borrowAssetsBalances[0]).eq(0)
          expect(stateAfterExit.strategy.borrowAssetsBalances[1]).eq(0)
          expect(stateAfterExit.strategy.totalAssets).eq(0)
          expect(stateAfterExit.strategy.investedAssets).eq(0)
          expect(stateAfterExit.splitter.assetBalance).approximately(stateAfterExit.splitter.totalAssets, 10);
          expect(stateAfterExit.vault.totalSupply).eq(stateAfterDeposit.vault.totalSupply)
          expect(stateAfterExit.vault.totalAssets).approximately(stateAfterDeposit.vault.totalAssets, 10);
          expect(stateAfterExit.vault.sharePrice).lt(stateAfterDeposit.vault.sharePrice)

        });
        it('should not exceed gas limits @skip-on-coverage', async() => {
          const strategyAsOperator = await BalancerBoostedStrategy__factory.connect(
            strategy.address,
            await UniversalTestUtils.getAnOperator(strategy.address, signer),
          );
          const gasUsed = await strategyAsOperator.estimateGas.emergencyExit();
          controlGasLimitsEx(gasUsed, GAS_EMERGENCY_EXIT, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      // todo fix test and study 'TS-10 zero borrowed amount'
      // threshold more then collateral
      describe('Hardwork with rewards', () => {
        it.skip('should return expected values', async() => {
          const stateAfterDeposit = await enterToVault();

          // forbid liquidation of received BAL-rewards
          await StrategyTestUtils.setThresholds(
            strategy as unknown as IStrategyV2,
            user,
            {
              rewardLiquidationThresholds: [
                {
                  asset: MaticAddresses.BAL_TOKEN,
                  threshold: parseUnits('1000', 18),
                }, {
                  asset: MaticAddresses.USDC_TOKEN,
                  threshold: parseUnits('1000', 6),
                },
              ],
            },
          );

          // wait long time, some rewards should appear
          console.log('start to advance blocks');
          await TimeUtils.advanceNBlocks(20_000);
          console.log('end to advance blocks');

          // try to check forward income .. (unsuccessfully, todo)
          const tetuBefore = await IERC20__factory.connect(MaticAddresses.TETU_TOKEN, signer).balanceOf(forwarder);

          const tx = await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
          const distributed = await UniversalTestUtils.extractDistributed(await tx.wait(), forwarder);
          const stateAfterHardwork = await StateUtils.getState(signer, user, strategy, vault);

          const tetuAfter = await IERC20__factory.connect(MaticAddresses.TETU_TOKEN, signer).balanceOf(forwarder);

          console.log('stateBeforeDeposit', stateBeforeDeposit);
          console.log('stateAfterDeposit', stateAfterDeposit);
          console.log('stateAfterHardwork', stateAfterHardwork);
          console.log('distributed', distributed);
          console.log('tetuBefore', tetuBefore);
          console.log('tetuAfter', tetuAfter);

          expect(stateAfterDeposit.strategy.assetBalance).gt(stateAfterHardwork.strategy.assetBalance)
          expect(stateAfterDeposit.strategy.borrowAssetsBalances[0]).gte(stateAfterHardwork.strategy.borrowAssetsBalances[0])
          expect(stateAfterDeposit.strategy.borrowAssetsBalances[1].gt(stateAfterHardwork.strategy.borrowAssetsBalances[1]) || stateAfterHardwork.strategy.borrowAssetsBalances[1].eq(0)).eq(true)
          expect(stateAfterHardwork.strategy.investedAssets).gt(stateBeforeDeposit.strategy.investedAssets)

          // strategy - bal: some rewards were received, claimed but not compounded because of the high thresholds
          expect(await IERC20__factory.connect(MaticAddresses.BAL_TOKEN, signer).balanceOf(strategy.address)).gt(0)

          expect(stateAfterDeposit.gauge.strategyBalance).gt(0)
          expect(stateAfterHardwork.gauge.strategyBalance).gt(stateAfterDeposit.gauge.strategyBalance)

          expect(stateAfterDeposit.splitter.totalAssets).lt(stateAfterHardwork.splitter.totalAssets)
        });
        it('should not exceed gas limits @skip-on-coverage', async() => {
          await TimeUtils.advanceNBlocks(20_000);
          const gasUsed = await strategy.connect(await Misc.impersonate(splitter.address)).estimateGas.doHardWork();
          controlGasLimitsEx(gasUsed, GAS_HARDWORK_WITH_REWARDS, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });

      describe('Withdraw maxWithdraw()', () => {
        it('should return expected values', async() => {
          const stateBefore = await enterToVault();
          console.log('stateBefore', stateBefore);

          const amountToWithdraw = await vault.maxWithdraw(user.address);
          // const amountToWithdraw = (await vault.maxWithdraw(user.address)).sub(parseUnits("1", 6));
          console.log('amountToWithdraw', amountToWithdraw);

          // console.log('maxWithdraw()', await vault.maxWithdraw(user.address));
          console.log('balanceOf', await vault.balanceOf(user.address));
          console.log('convertToAssets(balanceOf(owner))', await vault.convertToAssets(await vault.balanceOf(user.address)),);
          console.log('withdrawFee', await vault.withdrawFee());
          // console.log('maxWithdrawAssets', await vault.maxWithdrawAssets());

          const assets = await vault.convertToAssets(await vault.balanceOf(user.address));
          const shares = await vault.previewWithdraw(amountToWithdraw);
          console.log('assets', assets);
          console.log('previewWithdraw.shares', shares);

          await vault.connect(user).withdraw(amountToWithdraw, user.address, user.address);

          const stateAfter = await StateUtils.getState(signer, user, strategy, vault);

          console.log('Share price before', stateBefore.vault.sharePrice.toString());
          console.log('Share price after', stateAfter.vault.sharePrice.toString());

          expect(stateAfter.vault.sharePrice.sub(stateBefore.vault.sharePrice)).eq(0);
        });
      });
    });

    describe('Deposit, hardwork, withdraw', () => {
      describe('deposit, several hardworks, withdraw', () => {
        it('should be profitable', async() => {
          const countLoops = 2;
          const stepInBlocks = 20_000;
          const stateAfterDeposit = await enterToVault();
          console.log('stateAfterDeposit', stateAfterDeposit);
          const states: IState[] = [];

          for (let i = 0; i < countLoops; ++i) {
            await TimeUtils.advanceNBlocks(stepInBlocks);
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await StateUtils.getState(signer, user, strategy, vault);
            console.log(`state after hardwork ${i}`, state);
            states.push(state);
          }
          await TimeUtils.advanceNBlocks(stepInBlocks);

          await vault.connect(user).withdrawAll();
          await vault.connect(signer).withdrawAll();

          const stateFinal = await StateUtils.getState(signer, user, strategy, vault, 'final');
          console.log('stateFinal', stateFinal);

          const initialTotalAmount = parseUnits(DEPOSIT_AMOUNT.toString(), 6).mul(3).div(2);
          const resultTotalAmount = StateUtils.getTotalMainAssetAmount(stateFinal);

          console.log('resultTotalAmount', resultTotalAmount);
          console.log('initialTotalAmount', initialTotalAmount);
          StateUtils.outputProfitEnterFinal(stateBeforeDeposit, stateFinal);

          await StateUtils.saveListStatesToCSVColumns(
            './tmp/deposit-hardworks-withdraw.csv',
            [stateAfterDeposit, ...states, stateFinal],
            stateParams
          );

          expect(resultTotalAmount).gt(initialTotalAmount);
        });
      });
      describe('loopEndActions from DoHardWorkLoopBase', () => {
        it('should be profitable', async() => {
          const countLoops = 3;
          const stepInBlocks = 5_000;

          const stateAfterDeposit = await enterToVault();
          console.log('stateAfterDeposit', stateAfterDeposit);

          await BalancerStrategyUtils.refuelRewards(
            (await strategy.poolId()).substring(0, 42),
            MaticAddresses.BALANCER_LIQUIDITY_GAUGE_FACTORY,
            MaticAddresses.BAL_TOKEN,
            parseUnits('100'),
            signer
          )

          const states: IState[] = [];

          let isUserDeposited = true;
          for (let i = 0; i < countLoops; ++i) {
            if (isUserDeposited && i % 2 === 0) {
              isUserDeposited = false;
              if (i % 4 === 0) {
                console.log('!!! withdrawAll');
                await vault.connect(user).withdrawAll();
              } else {
                const userVaultBalance = await vault.balanceOf(user.address);
                const userAssetBalance = await vault.connect(user).convertToAssets(userVaultBalance);
                const toWithdraw = BigNumber.from(userAssetBalance).mul(95).div(100);
                console.log('!!! withdraw', toWithdraw);
                await vault.connect(user).withdraw(toWithdraw, user.address, user.address);
              }

            } else if (!isUserDeposited && i % 2 !== 0) {
              isUserDeposited = true;
              const userAssetBalance = await TokenUtils.balanceOf(asset, user.address);
              const amountToDeposit = BigNumber.from(userAssetBalance).div(3);

              console.log('!!! Deposit', amountToDeposit);
              await IERC20__factory.connect(asset, user).approve(vault.address, amountToDeposit);
              await vault.connect(user).deposit(amountToDeposit, user.address);

              console.log('!!! Deposit', amountToDeposit);
              await IERC20__factory.connect(asset, user).approve(vault.address, amountToDeposit);
              await vault.connect(user).deposit(amountToDeposit, user.address);
            }

            const state = await StateUtils.getState(signer, user, strategy, vault);
            console.log(`state after hardwork ${i}`, state);
            states.push(state);
          }
          await TimeUtils.advanceNBlocks(stepInBlocks);

          await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();

          console.log('user withdraw all');
          await vault.connect(user).withdrawAll();
          console.log('signer withdraw all');
          await vault.connect(signer).withdrawAll();

          const stateFinal = await StateUtils.getState(signer, user, strategy, vault, 'final');
          console.log('stateFinal', stateFinal);

          const initialTotalAmount = parseUnits(DEPOSIT_AMOUNT.toString(), 6).mul(3).div(2);
          const resultTotalAmount = StateUtils.getTotalMainAssetAmount(stateFinal);

          console.log('resultTotalAmount', resultTotalAmount);
          console.log('initialTotalAmount', initialTotalAmount);
          StateUtils.outputProfitEnterFinal(stateBeforeDeposit, stateFinal);

          await StateUtils.saveListStatesToCSVColumns(
            './tmp/DoHardWorkLoopBase.csv',
            [stateAfterDeposit, ...states, stateFinal],
            stateParams
          );

          expect(resultTotalAmount).gt(initialTotalAmount);
        });
      });
    });

    /**
     * Any deposit/withdraw/hardwork operation shouldn't change sharedPrice (at least significantly)
     */
    describe('Ensure share price is not changed', () => {
      describe('Deposit', () => {
        it('should return expected values, small deposit', async() => {
          const stateInitial = await enterToVault();

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await StateUtils.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state);
          }
          const stateBefore = await StateUtils.getState(signer, user, strategy, vault, 'before');

          // let's deposit $1 - calcInvestedAssets will be called
          await IERC20__factory.connect(
            MAIN_ASSET,
            await Misc.impersonate(MaticHolders.HOLDER_USDC),
          ).transfer(user.address, parseUnits('1', 6));
          await VaultUtils.deposit(user, vault, parseUnits('1', 6));

          const stateAfter = await StateUtils.getState(signer, user, strategy, vault, 'after');

          const ret = stateAfter.vault.sharePrice.sub(stateBefore.vault.sharePrice);

          console.log('State before', stateBefore);
          console.log('State after', stateAfter);

          console.log('Share price before', stateBefore.vault.sharePrice.toString());
          console.log('Share price after', stateAfter.vault.sharePrice.toString());

          await StateUtils.saveListStatesToCSVColumns(
            './tmp/npc_deposit_small.csv',
            [stateBefore, stateAfter],
            stateParams
          );

          expect(ret.abs().lte(1)).eq(true);
        });
        it('should return expected values, huge deposit', async() => {
          const stateInitial = await enterToVault();

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await StateUtils.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state);
          }
          const stateBefore = await StateUtils.getState(signer, user, strategy, vault, 'before');

          // let's deposit $1 - calcInvestedAssets will be called
          await IERC20__factory.connect(
            MAIN_ASSET,
            await Misc.impersonate(MaticHolders.HOLDER_USDC),
          ).transfer(user.address, parseUnits('50000', 6));
          await VaultUtils.deposit(user, vault, parseUnits('50000', 6));

          const stateAfter = await StateUtils.getState(signer, user, strategy, vault, 'after');

          console.log('State before', stateBefore);
          console.log('State after', stateAfter);

          console.log('Share price before', stateBefore.vault.sharePrice.toString());
          console.log('Share price after', stateAfter.vault.sharePrice.toString());

          await StateUtils.saveListStatesToCSVColumns(
            './tmp/npc_deposit_huge.csv',
            [stateBefore, stateAfter],
            stateParams
          );

          expect(stateAfter.vault.sharePrice.sub(stateBefore.vault.sharePrice)).eq(0);
        });
      });
      describe('Withdraw', () => {
        it('should return expected values', async() => {
          const stateInitial = await enterToVault();
          console.log('stateInitial', stateInitial);

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await StateUtils.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state);
          }
          const stateBefore = await StateUtils.getState(signer, user, strategy, vault, 'before');

          // we need to force vault to withdraw some amount from the strategy
          // so let's ask to withdraw ALMOST all amount from vault's balance
          // calcInvestedAssets will be called after the withdrawal
          const assets = await vault.convertToAssets(await vault.balanceOf(user.address));
          // todo const amountToWithdraw = (await vault.maxWithdraw(user.address)).sub(parseUnits("1", 6));
          const amountToWithdraw = assets.mul(DENOMINATOR - WITHDRAW_FEE).div(DENOMINATOR).sub(parseUnits('1', 6));
          console.log('amountToWithdraw', amountToWithdraw);
          await vault.connect(user).withdraw(amountToWithdraw, user.address, user.address);

          const stateAfter = await StateUtils.getState(signer, user, strategy, vault, 'after');

          console.log('stateAfter', stateAfter);
          console.log('Share price before', stateBefore.vault.sharePrice.toString());
          console.log('Share price after', stateAfter.vault.sharePrice.toString());

          await StateUtils.saveListStatesToCSVColumns(
            './tmp/npc_withdraw.csv',
            [stateBefore, stateAfter],
            stateParams
          );

          expect(stateAfter.vault.sharePrice.sub(stateBefore.vault.sharePrice)).eq(0);
        });
      });
      describe('WithdrawAll', () => {
        it('should return expected values', async() => {
          const stateInitial = await enterToVault();
          console.log('stateInitial', stateInitial);

          // let's allow strategy to invest all available amount
          for (let i = 0; i < 3; ++i) {
            await strategy.connect(await Misc.impersonate(splitter.address)).doHardWork();
            const state = await StateUtils.getState(signer, user, strategy, vault);
            console.log(`state ${i}`, state);
          }
          const stateBefore = await StateUtils.getState(signer, user, strategy, vault, 'before');

          // we need to force vault to withdraw some amount from the strategy
          // so let's ask to withdraw ALMOST all amount from vault's balance
          // calcInvestedAssets will be called after the withdrawal
          const assets = await vault.convertToAssets(await vault.balanceOf(user.address));
          // todo const amountToWithdraw = (await vault.maxWithdraw(user.address)).sub(parseUnits("1", 6));
          const amountToWithdraw = assets.mul(DENOMINATOR - WITHDRAW_FEE).div(DENOMINATOR).sub(parseUnits('1', 6));
          console.log('amountToWithdraw', amountToWithdraw);
          await vault.connect(user).withdraw(amountToWithdraw, user.address, user.address);

          const stateAfter = await StateUtils.getState(signer, user, strategy, vault, 'after');

          console.log('stateAfter', stateAfter);
          console.log('Share price before', stateBefore.vault.sharePrice.toString());
          console.log('Share price after', stateAfter.vault.sharePrice.toString());

          await StateUtils.saveListStatesToCSVColumns(
            './tmp/npc_withdraw_all.csv',
            [stateBefore, stateAfter],
            stateParams
          );

          expect(stateAfter.vault.sharePrice.sub(stateBefore.vault.sharePrice)).eq(0);
        });
      });
    });

    // todo enable after SCB-718
    describe.skip("requirePayAmountBack", () => {

      /**
       * Make deposit: make two borrows
       * Set TetuConverter on pause
       * Forcibly close both borrows using ITetuConverter.repayTheBorrow
       */
      describe("Forcibly close all borrows", () => {
        it("should return expected values", async () => {
          await VaultUtils.deposit(signer, vault, initialBalances.balanceSigner);
          const stateAfterDeposit = await StateUtils.getState(signer, user, strategy, vault, 'enterToVault');
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
            console.log("repayTheBorrow.start");
            await tetuConverterAsGovernance.repayTheBorrow(poolAdapter, true);
            console.log("repayTheBorrow.finished");
          }

          const stateFinal = await StateUtils.getState(signer, user, strategy, vault, 'final');
          console.log("stateFinal", stateFinal);

          await StateUtils.saveListStatesToCSVColumns(
            './tmp/npc_requirePayAmountBack.csv',
            [stateAfterDeposit, stateFinal],
            stateParams
          );

          expect(stateAfterDeposit.gauge.strategyBalance).gt(0)
          expect(stateAfterDeposit.converter.collaterals[0]).gt(0)
          expect(stateAfterDeposit.converter.collaterals[1]).gt(0)
          expect(stateAfterDeposit.converter.amountsToRepay[0]).gt(0)
          expect(stateAfterDeposit.converter.amountsToRepay[1]).gt(0)
          expect(stateFinal.gauge.strategyBalance).eq(0)
          expect(stateFinal.converter.collaterals[0]).eq(0)
          expect(stateFinal.converter.collaterals[1]).eq(0)
          expect(stateFinal.converter.amountsToRepay[0]).eq(0)
          expect(stateFinal.converter.amountsToRepay[1]).eq(0)
        });
      });
    });

    describe("specific name for ui", () => {
      it('have expected value', async() => {
        expect(await strategy.strategySpecificName()).eq("Balancer bb-t-USD")
      })
    })
  });

  //endregion Integration tests
});
