/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {BorrowManager, BorrowManager__factory, ConverterController__factory, ConverterStrategyBase__factory, IController__factory, IDebtMonitor, IDebtMonitor__factory, IERC20__factory, IKeeperCallback__factory, IPlatformAdapter__factory, IPoolAdapter__factory,} from '../../../../typechain';
import {Misc} from "../../../../scripts/utils/Misc";
import {defaultAbiCoder, formatUnits, parseUnits} from 'ethers/lib/utils';
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {IBuilderResults, KYBER_PID_DEFAULT_BLOCK} from "../../../baseUT/strategies/PairBasedStrategyBuilder";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../../baseUT/strategies/PairStrategyFixtures";
import {
  IPrepareOverCollateralParams,
  PairBasedStrategyPrepareStateUtils
} from "../../../baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {GAS_LIMIT_PAIR_BASED_WITHDRAW, GAS_REBALANCE_NO_SWAP} from "../../../baseUT/GasLimits";
import {ENTRY_TO_POOL_DISABLED, ENTRY_TO_POOL_IS_ALLOWED, PLAN_REPAY_SWAP_REPAY, PLAN_SWAP_REPAY} from "../../../baseUT/AppConstants";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {
  ISwapper__factory
} from "../../../../typechain/factories/contracts/test/aave/Aave3PriceSourceBalancerBoosted.sol";
import {controlGasLimitsEx} from "../../../../scripts/utils/GasLimitUtils";
import {BigNumber} from "ethers";
import {CaptureEvents} from "../../../baseUT/strategies/CaptureEvents";
import {MockAggregatorUtils} from "../../../baseUT/mocks/MockAggregatorUtils";
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {MockHelper} from "../../../baseUT/helpers/MockHelper";

describe('PairBasedStrategyEmergencyExitTest', function() {

//region Variables
  let snapshotBefore: string;

  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
//endregion Variables

//region before, after
  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();

    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    [signer, signer2] = await ethers.getSigners();
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Utils
  function tokenName(token: string): string {
    switch (token) {
      case MaticAddresses.USDC_TOKEN: return "USDC";
      case MaticAddresses.USDT_TOKEN: return "USDT";
      case MaticAddresses.WETH_TOKEN: return "WETH";
      case MaticAddresses.WMATIC_TOKEN: return "WMATIC";
      default: return token;
    }
  }

  interface ICheckHealthResult {
    poolAdapter: string;
    amountBorrowAsset: BigNumber;
    amountCollateralAsset: BigNumber;
  }

  interface IRequireRepayParams {
    /** Addon to min and target health factors, i.e. 50 (2 decimals) */
    addon?: number;
    /** We need to fix health of pool adapters belong to the given ACTIVE platform adapter only */
    platformKindOnly?: number;
  }

  interface IRequireRepayResults {
    checkBefore: ICheckHealthResult[];
    checkAfter: ICheckHealthResult[];
  }

  async function getCheckHealthResultsForStrategy(
      strategy: string,
      debtMonitor: IDebtMonitor,
      borrowManager: BorrowManager,
      platformKindOnly?: number
  ): Promise<ICheckHealthResult[]> {
    const check0 = await debtMonitor.checkHealth(
        0,
        100,
        100
    );
    const dest: ICheckHealthResult[] = [];
    for (let i = 0; i < check0.outPoolAdapters.length; ++i) {
      const config = await IPoolAdapter__factory.connect(check0.outPoolAdapters[i], signer).getConfig();
      if (config.user.toLowerCase() === strategy.toLowerCase()) {
        if (platformKindOnly) {
          const platformAdapter = IPlatformAdapter__factory.connect(
              await borrowManager.converterToPlatformAdapter(config.originConverter),
              signer
          );
          if (await platformAdapter.platformKind() !== platformKindOnly || await platformAdapter.frozen()) {
            console.log(`Skip ${check0.outPoolAdapters[i]}`);
            continue;
          }
        }

        dest.push({
          poolAdapter: check0.outPoolAdapters[i],
          amountBorrowAsset: check0.outAmountBorrowAsset[i],
          amountCollateralAsset: check0.outAmountCollateralAsset[i]
        })
      }
    }
    return dest;
  }

  /** Test the call of requireRepay and the subsequent call of requirePayAmountBack() */
  async function callRequireRepay(b: IBuilderResults, p?: IRequireRepayParams): Promise<IRequireRepayResults> {
    const defaultState = await PackedData.getDefaultState(b.strategy);

    // increase health factors to break "health"
    const addon = p?.addon ?? 50;
    const converterController = ConverterController__factory.connect(await b.converter.controller(), signer);
    const converterGovernance = await Misc.impersonate(await converterController.governance());
    const minHealthFactor = await converterController.minHealthFactor2();
    const targetHealthFactor = await converterController.targetHealthFactor2();
    await converterController.connect(converterGovernance).setTargetHealthFactor2(targetHealthFactor + addon);
    await converterController.connect(converterGovernance).setMinHealthFactor2(minHealthFactor + addon);
    const debtMonitor = IDebtMonitor__factory.connect(await converterController.debtMonitor(), signer);

    // we need to clean custom target factors for the assets in use
    const borrowManager = BorrowManager__factory.connect(await converterController.borrowManager(), converterGovernance);
    await borrowManager.setTargetHealthFactors(
      [defaultState.tokenA, defaultState.tokenB],
      [targetHealthFactor + addon, targetHealthFactor + addon]
    );

    // calculate amounts required to restore health
    const checkBefore = await getCheckHealthResultsForStrategy(b.strategy.address, debtMonitor, borrowManager, p?.platformKindOnly);

    // call requireRepay on converter, requirePayAmountBack is called inside
    const keeperCallback = IKeeperCallback__factory.connect(
      b.converter.address,
      await Misc.impersonate(await converterController.keeper())
    );
    for (const check of checkBefore) {
      await keeperCallback.requireRepay(check.amountBorrowAsset, check.amountCollateralAsset, check.poolAdapter);
    }

    // ensure that health is restored
    const checkAfter = await getCheckHealthResultsForStrategy(b.strategy.address, debtMonitor, borrowManager, p?.platformKindOnly);
    return {checkBefore, checkAfter}
  }
//endregion Utils

//region Unit tests
  describe("Emergency exit", () => {
    interface IStrategyInfo {
      name: string,
      notUnderlyingToken: string;
    }

    const strategies: IStrategyInfo[] = [
      {name: PLATFORM_KYBER, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_ALGEBRA, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
      {name: PLATFORM_UNIV3, notUnderlyingToken: MaticAddresses.USDT_TOKEN},
    ];

    strategies.forEach(function (strategyInfo: IStrategyInfo) {
      async function prepareStrategy(): Promise<IBuilderResults> {
        const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
          strategyInfo.name,
          signer,
          signer2,
          {
            kyberPid: KYBER_PID_DEFAULT_BLOCK,
            notUnderlying: strategyInfo.notUnderlyingToken
          }
        );
        await PairBasedStrategyPrepareStateUtils.prepareLiquidationThresholds(signer, b.strategy.address);

        console.log('deposit...');

        for (let i = 0; i < 5; ++i) {
          await IERC20__factory.connect(b.asset, signer).approve(b.vault.address, Misc.MAX_UINT);
          await TokenUtils.getToken(b.asset, signer.address, parseUnits('2000', 6));
          await b.vault.connect(signer).deposit(parseUnits('2000', 6), signer.address);

          const state = await PackedData.getDefaultState(b.strategy);
          if (state.totalLiquidity.gt(0)) {
            break;
          }
        }

        return b;
      }

      describe(`${strategyInfo.name}:${tokenName(strategyInfo.notUnderlyingToken)}`, () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        it("user should be able to withdraw all liquidity after emergency exit", async () => {
          const pathOut = `./tmp/${strategyInfo.name}-emergency-exit.csv`;
          const states: IStateNum[] = [];
          const b = await loadFixture(prepareStrategy);
          const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

          const maxWithdraw = +formatUnits(
            await b.vault.connect(signer).maxWithdraw(signer.address),
            b.assetDecimals
          );

          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "init"));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          console.log("========= Emergency exit start ==========")
          await converterStrategyBase.emergencyExit();

          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "ee"));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          console.log("========= Withdraw all ==========")
          await b.vault.connect(signer).withdrawAll({gasLimit: 19_000_000});

          states.push(await StateUtilsNum.getState(signer, signer, converterStrategyBase, b.vault, "final"));
          StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

          expect(states[states.length - 1].user.assetBalance).approximately(maxWithdraw, 0.1);
        });
      });
    });
  });
//endregion Unit tests
});
