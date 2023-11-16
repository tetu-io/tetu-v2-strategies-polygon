import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai from 'chai';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import hre, { ethers } from 'hardhat';
import {
  IERC20Metadata__factory,
  StrategyBaseV2__factory,
  PairBasedStrategyReader, ConverterStrategyBase__factory,
} from '../../../../typechain';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { TokenUtils } from '../../../../scripts/utils/TokenUtils';
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import { Misc } from '../../../../scripts/utils/Misc';
import {depositToVault, doHardWorkForStrategy, printVaultState, redeemFromVault,} from '../../../baseUT/universalTestUtils/StrategyTestUtils';
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {IStateNum, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {PLATFORM_ALGEBRA, PLATFORM_KYBER, PLATFORM_UNIV3} from "../../../baseUT/strategies/AppPlatforms";
import {IBuilderResults, KYBER_PID_DEFAULT_BLOCK} from "../../../baseUT/strategies/pair/PairBasedStrategyBuilder";
import {PairStrategyFixtures} from "../../../baseUT/strategies/pair/PairStrategyFixtures";
import {PairBasedStrategyPrepareStateUtils} from "../../../baseUT/strategies/pair/PairBasedStrategyPrepareStateUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";

const { expect } = chai;

describe('PairBaseStrategyMovePriceCycleInt @skip-on-coverage', function() {
//region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let reader: PairBasedStrategyReader;
//endregion Variables

  //region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.switchToMostCurrentBlock();
    await InjectUtils.injectTetuConverterBeforeAnyTest(signer);

    [signer, signer2] = await ethers.getSigners();
    reader = await MockHelper.createPairBasedStrategyReader(signer);
  })

  after(async function () {
    await HardhatUtils.restoreBlockFromEnv();
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Utils
  interface ICyclesResults {
    states: IStateNum[];
  }

  interface ICyclesParams {
    pathOut: string;
    /** up OR down OR up/down randomly */
    movePricesUp?: boolean;
    // Use Misc.ZERO_ADDRESS to use liquidator without gap
    aggregator: string;
  }

  async function makeCycles(b: IBuilderResults, p: ICyclesParams): Promise<ICyclesResults> {
    const cycles = 10;
    const MAX_ALLLOWED_LOCKED_PERCENT = 25;
    const pathOut = p.pathOut;
    const states: IStateNum[] = [];
    const assetCtr = IERC20Metadata__factory.connect(b.asset, signer);

    const strategyAsSigner = StrategyBaseV2__factory.connect(b.strategy.address, signer);
    const strategyAsOperator = await b.strategy.connect(await UniversalTestUtils.getAnOperator(b.strategy.address, signer));
    const converterStrategyBase = ConverterStrategyBase__factory.connect(b.strategy.address, signer);

    await b.vault.setDoHardWorkOnInvest(false);
    await TokenUtils.getToken(b.asset, signer2.address, parseUnits('1', 6));
    await b.vault.connect(signer2).deposit(parseUnits('1', 6), signer2.address);

    const depositAmount1 = parseUnits('10000', b.assetDecimals);
    await TokenUtils.getToken(b.asset, signer.address, depositAmount1.mul(cycles));

    const balanceBefore = +formatUnits(await assetCtr.balanceOf(signer.address), b.assetDecimals);
    const defaultState = await PackedData.getDefaultState(b.strategy);

    for (let i = 0; i < cycles; i++) {
      const sharePriceBefore = await b.vault.sharePrice();
      console.log('------------------ CYCLE', i, '------------------');

      console.log('------------------ DEPOSIT', i, '------------------');

      if (i % 3 === 0) {
        await depositToVault(b.vault, signer, depositAmount1, b.assetDecimals, assetCtr, b.insurance);
        await printVaultState(b.vault, b.splitter, strategyAsSigner, assetCtr, b.assetDecimals);
      } else {
        await depositToVault(b.vault, signer, depositAmount1.div(2), b.assetDecimals, assetCtr, b.insurance);
        await printVaultState(b.vault, b.splitter, strategyAsSigner, assetCtr, b.assetDecimals);

        await depositToVault(b.vault, signer, depositAmount1.div(2), b.assetDecimals, assetCtr, b.insurance);
        await printVaultState(b.vault, b.splitter, strategyAsSigner, assetCtr, b.assetDecimals);
      }

      states.push(await StateUtilsNum.getState(signer2, signer, converterStrategyBase, b.vault, `d${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);

      expect(await converterStrategyBase.investedAssets()).above(0);

      await TimeUtils.advanceNBlocks(300);

      const movePriceUp = p.movePricesUp === undefined
        ? i % 5 !== 0
        : p.movePricesUp;
      console.log(`------------------ MOVE PRICE ${movePriceUp ? "UP" : "DOWN"} `, i, '------------------');

      const swapAmount = await PairBasedStrategyPrepareStateUtils.getSwapAmount2(
          signer,
          b,
          defaultState.tokenA,
          defaultState.tokenB,
          true,
           i % 2 === 0
              ? 0.6
              : 0.3
      );
      if (p.movePricesUp) {
        await UniversalUtils.movePoolPriceUp(signer2, defaultState, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAmount);
      } else {
        await UniversalUtils.movePoolPriceDown(signer2, defaultState, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAmount);
      }
      states.push(await StateUtilsNum.getState(signer2, signer, converterStrategyBase, b.vault, `p${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);


      // we suppose the rebalance happens immediately when it needs
      if (await b.strategy.needRebalance()) {
        console.log('------------------ REBALANCE' , i, '------------------');
        await b.strategy.connect(signer).rebalanceNoSwaps(true, {gasLimit: 10_000_000});

        await printVaultState(b.vault, b.splitter, strategyAsSigner, assetCtr, b.assetDecimals);
        states.push(await StateUtilsNum.getState(signer2, signer, converterStrategyBase, b.vault, `r${i}`));
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
      }

      console.log('------------------ BORROWS UNFOLDING (reduce over-collateral)', i, '------------------');
      const r = await reader.getLockedUnderlyingAmount(b.strategy.address);
      if (!r.totalAssets.eq(0)) {
        const percent = r.estimatedUnderlyingAmount.mul(100).div(r.totalAssets).toNumber();
        console.log("Locked percent", percent);
        if (percent > MAX_ALLLOWED_LOCKED_PERCENT) {
          await PairBasedStrategyPrepareStateUtils.unfoldBorrowsRepaySwapRepay(
            strategyAsOperator,
            p.aggregator,
              () => true, // use single iteration
            async (stateTitle, eventsSet): Promise<IStateNum> => {
              states.push(await StateUtilsNum.getState(signer2, signer, converterStrategyBase, b.vault, stateTitle, {eventsSet}));
              await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
              return states[states.length - 1];
            },
          );

          if (await b.strategy.needRebalance()) {
            console.log('------------------ REBALANCE-AFTER-UNFOLDING' , i, '------------------');
            await b.strategy.connect(signer).rebalanceNoSwaps(true, {gasLimit: 10_000_000});

            await printVaultState(b.vault, b.splitter, strategyAsSigner, assetCtr, b.assetDecimals);
            states.push(await StateUtilsNum.getState(signer2, signer, converterStrategyBase, b.vault, `r${i}`));
            await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
          }
        }
      }


      if (i % 2 === 0) {
        console.log('------------------ HARDWORK', i, '------------------');
        const stateHardworkEvents = await doHardWorkForStrategy(b.splitter, strategyAsSigner, signer, b.assetDecimals);
        await printVaultState(b.vault, b.splitter, strategyAsSigner, assetCtr, b.assetDecimals);
        states.push(await StateUtilsNum.getState(signer2, signer, converterStrategyBase, b.vault, `h${i}`));
      }


      console.log('------------------ WITHDRAW', i, '------------------');
      if (i % 7 === 0 || i === cycles - 1) {
        await redeemFromVault(b.vault, signer, 100, b.assetDecimals, assetCtr, b.insurance);
        await printVaultState(b.vault, b.splitter, strategyAsSigner, assetCtr, b.assetDecimals);
      } else if (i % 5 === 0) {
        await redeemFromVault(b.vault, signer, 50, b.assetDecimals, assetCtr, b.insurance);
        await printVaultState(b.vault, b.splitter, strategyAsSigner, assetCtr, b.assetDecimals);

        // we cannot make second withdraw immediately because rebalance may be required
        // await redeemFromVault(vault, signer, 100, decimals, assetCtr, insurance);
        // await printVaultState(vault, splitter, strategyAsSigner, assetCtr, decimals);
      }

      const sharePriceAfter = await b.vault.sharePrice();
      // zero compound
      if (p.aggregator === Misc.ZERO_ADDRESS || p.aggregator === MaticAddresses.TETU_LIQUIDATOR) {
        expect(sharePriceAfter).approximately(sharePriceBefore, 10);
      } else {
        // the aggregator (not liquidator) uses real price, different from our test...
      }

      states.push(await StateUtilsNum.getState(signer2, signer, converterStrategyBase, b.vault, `w${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, b.stateParams, true);
    }

    const balanceAfter = +formatUnits(await assetCtr.balanceOf(signer.address), b.assetDecimals);
    console.log('balanceBefore', balanceBefore);
    console.log('balanceAfter', balanceAfter);
    expect(balanceAfter).approximately(balanceBefore - (+formatUnits(depositAmount1, 6) * 0.006 * cycles), 0.2 * cycles);

    return {states};
  }
//endregion Utils

//region Unit tests
  interface IStrategyInfo {
    name: string,
  }
  const strategies: IStrategyInfo[] = [
    { name: PLATFORM_UNIV3,},
    // { name: PLATFORM_ALGEBRA,}, // todo getPrice reverts
    // { name: PLATFORM_KYBER,}, // todo getPrice reverts
  ];

  strategies.forEach(function (strategyInfo: IStrategyInfo) {

    async function prepareStrategy(): Promise<IBuilderResults> {
      const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(
        strategyInfo.name,
        signer,
        signer2,
        {
          kyberPid: KYBER_PID_DEFAULT_BLOCK,
        }
      );

      await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);
      return b;
    }

    describe(`${strategyInfo.name}`, () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      describe("Move prices, liquidator", () => {
        async function makeTestUp(): Promise<ICyclesResults> {
          const b = await loadFixture(prepareStrategy);
          const pathOut = `./tmp/${strategyInfo.name}-cycle-move-prices-liquidator.csv`;
          return makeCycles(b, {
            pathOut,
            movePricesUp: undefined,
            aggregator: Misc.ZERO_ADDRESS
          });
        }

        it('should not revert', async function () {
          await makeTestUp();
        });
      });
      describe("Move prices, 1inch", () => {
        async function makeTestUp(): Promise<ICyclesResults> {
          const b = await loadFixture(prepareStrategy);
          const pathOut = `./tmp/${strategyInfo.name}-cycle-move-prices-one-inch.csv`;
          return makeCycles(b, {
            pathOut,
            movePricesUp: undefined,
            aggregator: MaticAddresses.AGG_ONEINCH_V5
          });
        }

        it('should not revert', async function () {
          await makeTestUp();
        });
      });
      describe("Move prices, liquidator as aggregator", () => {
        async function makeTestDown(): Promise<ICyclesResults> {
          const b = await loadFixture(prepareStrategy);
          const pathOut = `./tmp/${strategyInfo.name}-cycle-move-prices-liquidator-as-agg.csv`;
          return makeCycles(b, {
            pathOut,
            movePricesUp: undefined,
            aggregator: MaticAddresses.TETU_LIQUIDATOR
          });
        }

        it('should not revert', async function () {
          await makeTestDown();
        });
      });
    });
  });
//endregion Unit tests
});
