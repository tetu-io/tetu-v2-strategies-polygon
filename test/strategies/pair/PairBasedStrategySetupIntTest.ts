import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../scripts/utils/Misc";
import {IPairBasedDefaultStateProvider, ISetupPairBasedStrategy} from "../../../typechain";
import {expect} from "chai";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {PackedData} from "../../baseUT/utils/PackedData";
import {UniversalTestUtils} from "../../baseUT/utils/UniversalTestUtils";
import {IBuilderResults} from "../../baseUT/strategies/pair/PairBasedStrategyBuilder";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID} from '../../baseUT/utils/HardhatUtils';
import {PLATFORM_ALGEBRA, PLATFORM_PANCAKE, PLATFORM_UNIV3} from "../../baseUT/strategies/AppPlatforms";
import {PairStrategyFixtures} from "../../baseUT/strategies/pair/PairStrategyFixtures";
import {PairBasedStrategyPrepareStateUtils} from "../../baseUT/strategies/pair/PairBasedStrategyPrepareStateUtils";

describe('PairBasedStrategySetupIntTest', () => {
  const CHAINS_IN_ORDER_EXECUTION: number[] = [BASE_NETWORK_ID, POLYGON_NETWORK_ID];
  interface IStrategyInfo {
    name: string,
    chainId: number;
  }

  const strategies: IStrategyInfo[] = [
    {name: PLATFORM_PANCAKE, chainId: BASE_NETWORK_ID},
    {name: PLATFORM_UNIV3, chainId: POLYGON_NETWORK_ID},
    {name: PLATFORM_ALGEBRA, chainId: POLYGON_NETWORK_ID},
  ];

  CHAINS_IN_ORDER_EXECUTION.forEach(function (chainId) {
    describe(`chain ${chainId}`, function () {
      let snapshotBefore: string;
      let signer: SignerWithAddress;
      let signer2: SignerWithAddress;

      before(async function () {
        await HardhatUtils.setupBeforeTest(chainId);
        [signer, signer2] = await ethers.getSigners();
        snapshotBefore = await TimeUtils.snapshot();
      });

      after(async function () {
        await TimeUtils.rollback(snapshotBefore);
      });

      strategies.forEach(function (strategyInfo: IStrategyInfo) {
        if (strategyInfo.chainId === chainId) {
          let operator: SignerWithAddress;
          async function prepareStrategy(): Promise<IBuilderResults> {
            const b = await PairStrategyFixtures.buildPairStrategyUsdcXXX(chainId, strategyInfo.name, signer, signer2);

            await PairBasedStrategyPrepareStateUtils.prepareFuse(b, false);
            return b;
          }

          describe(`${strategyInfo.name}`, () => {
            let snapshot: string;
            let builderResults: IBuilderResults;
            before(async function () {
              snapshot = await TimeUtils.snapshot();

              builderResults = await prepareStrategy();
              operator = await UniversalTestUtils.getAnOperator(builderResults.strategy.address, signer);

            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            describe("setFuseStatus", () => {
              let snapshot1: string;
              beforeEach(async function () {
                snapshot1 = await TimeUtils.snapshot();
              });
              afterEach(async function () {
                await TimeUtils.rollback(snapshot1);
              });

              interface ISetFuseStatusParams {
                fuseStatus: number;
                notAsOperator?: boolean;
              }

              interface ISetFuseStatusResults {
                status: number;
              }

              async function callSetFuseStatus(strategy: ISetupPairBasedStrategy, p: ISetFuseStatusParams): Promise<ISetFuseStatusResults> {
                const s = p.notAsOperator
                  ? strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
                  : strategy.connect(operator);
                await s.setFuseStatus(p.fuseStatus);
                const state = await PackedData.getDefaultState(strategy as unknown as IPairBasedDefaultStateProvider);
                return {status: state.fuseStatus}
              }

              it("should set expected values", async () => {
                const ret = await callSetFuseStatus(builderResults.strategy, {
                  fuseStatus: 1,
                });
                expect(ret.status).eq(1);
              });
              it("should revert if not operator", async () => {
                await expect(callSetFuseStatus(builderResults.strategy, {
                  fuseStatus: 1,
                  notAsOperator: true
                })).revertedWith("SB: Denied"); // DENIED
              });
            });

            describe("setFuseThresholds", () => {
              let snapshot2: string;
              beforeEach(async function () {
                snapshot2 = await TimeUtils.snapshot();
              });
              afterEach(async function () {
                await TimeUtils.rollback(snapshot2);
              });

              interface ISetFuseThresholdsParams {
                thresholds: string[];
                notAsOperator?: boolean;
              }

              interface ISetFuseThresholdsResults {
                thresholds: number[];
              }

              async function callSetFuseStatus(strategy: ISetupPairBasedStrategy, p: ISetFuseThresholdsParams): Promise<ISetFuseThresholdsResults> {
                const s = p.notAsOperator
                  ? strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
                  : strategy.connect(operator);
                const ttA = new Array<BigNumber>(4);
                for (let i = 0; i < 4; ++i) {
                  ttA[i] = parseUnits(p.thresholds[i], 18);
                }
                await s.setFuseThresholds([ttA[0], ttA[1], ttA[2], ttA[3]]);
                const state = await PackedData.getDefaultState(strategy as unknown as IPairBasedDefaultStateProvider);
                return {
                  thresholds: state.fuseThresholds,
                }
              }

              it("should set expected values", async () => {
                const ret = await callSetFuseStatus(builderResults.strategy, {
                  thresholds: ["1", "2", "4", "3"],
                });
                expect([...ret.thresholds].join()).eq([1, 2, 4, 3].join());
              });
              it("should revert if not operator", async () => {
                await expect(callSetFuseStatus(builderResults.strategy, {
                  thresholds: ["1", "2", "4", "3"],
                  notAsOperator: true
                })).revertedWith("SB: Denied"); // DENIED
              });
            });

            describe("setStrategyProfitHolder", () => {
              let snapshot2: string;
              beforeEach(async function () {
                snapshot2 = await TimeUtils.snapshot();
              });
              afterEach(async function () {
                await TimeUtils.rollback(snapshot2);
              });

              interface ISetProfitHolderParams {
                profitHolder: string;
                notAsOperator?: boolean;
              }

              interface ISetProfitHolderResults {
                profitHolder: string;
              }

              async function callSetProfitHolder(strategy: ISetupPairBasedStrategy, p: ISetProfitHolderParams): Promise<ISetProfitHolderResults> {
                const s = p.notAsOperator
                  ? strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
                  : strategy.connect(operator);
                await s.setStrategyProfitHolder(p.profitHolder);
                const state = await PackedData.getDefaultState(strategy as unknown as IPairBasedDefaultStateProvider);
                return {profitHolder: state.profitHolder};
              }

              it("should set expected values", async () => {
                const profitHolder = ethers.Wallet.createRandom().address;
                const ret = await callSetProfitHolder(builderResults.strategy, {profitHolder});
                expect(ret.profitHolder).eq(profitHolder);
              });
              it("should revert if not operator", async () => {
                const profitHolder = ethers.Wallet.createRandom().address;
                await expect(callSetProfitHolder(builderResults.strategy, {
                  profitHolder,
                  notAsOperator: true
                })).revertedWith("SB: Denied"); // DENIED
              });
            });

            describe("setWithdrawDone", () => {
              let snapshot2: string;
              beforeEach(async function () {
                snapshot2 = await TimeUtils.snapshot();
              });
              afterEach(async function () {
                await TimeUtils.rollback(snapshot2);
              });

              interface ISetWithdrawDoneParams {
                done: number;
                notAsOperator?: boolean;
              }

              interface IWithdrawDoneResults {
                done: number;
              }

              async function callSetProfitHolder(strategy: ISetupPairBasedStrategy, p: ISetWithdrawDoneParams): Promise<IWithdrawDoneResults> {
                const s = p.notAsOperator
                  ? strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
                  : strategy.connect(operator);
                await s.setWithdrawDone(p.done);
                const state = await PackedData.getDefaultState(strategy as unknown as IPairBasedDefaultStateProvider);
                return {done: state.withdrawDone};
              }

              it("should set expected values", async () => {
                const ret = await callSetProfitHolder(builderResults.strategy, {done: 1});
                expect(ret.done).eq(1);
              });
              it("should revert if not operator", async () => {
                const profitHolder = ethers.Wallet.createRandom().address;
                await expect(callSetProfitHolder(builderResults.strategy, {
                  done: 1,
                  notAsOperator: true
                })).revertedWith("SB: Denied"); // DENIED
              });
            });
          });
        }
      });
    });
  });
});
