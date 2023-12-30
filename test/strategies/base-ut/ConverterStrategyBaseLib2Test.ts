import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers} from 'hardhat';
import {TimeUtils} from '../../../scripts/utils/TimeUtils';
import {DeployerUtils} from '../../../scripts/utils/DeployerUtils';
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import {
  ConverterStrategyBaseLib2__factory,
  ConverterStrategyBaseLibFacade2,
  MockBookkeeper,
  MockToken,
  PriceOracleMock,
  StrategySplitterV2
} from '../../../typechain';
import {expect} from 'chai';
import {MockHelper} from '../../baseUT/helpers/MockHelper';
import {IQuoteRepayParams, ITokenAmountNum} from "../../baseUT/mocks/TestDataTypes";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {
  setupMockedQuoteRepay
} from "../../baseUT/mocks/MockRepayUtils";
import {IERC20Metadata__factory} from "../../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_CALC_INVESTED_ASSETS_NO_DEBTS,
  GAS_CALC_INVESTED_ASSETS_SINGLE_DEBT,
  GET_EXPECTED_WITHDRAW_AMOUNT_ASSETS
} from "../../baseUT/GasLimits";
import {BigNumber} from "ethers";
import {
  FixPriceChangesEventObject,
  OnCoverLossEventObject,
  UncoveredLossEventObject
} from "../../../typechain/contracts/strategies/ConverterStrategyBaseLib2";
import {Misc} from "../../../scripts/utils/Misc";
import { HARDHAT_NETWORK_ID, HardhatUtils } from '../../baseUT/utils/HardhatUtils';

/**
 * Test of ConverterStrategyBaseLib using ConverterStrategyBaseLibFacade
 * to direct access of the library functions.
 *
 * Following tests are created using fixtures, not snapshots
 */
describe('ConverterStrategyBaseLibTest2', () => {
  //region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let bal: MockToken;
  let unknown: MockToken;
  let facade: ConverterStrategyBaseLibFacade2;
  let mapTokenByAddress: Map<string, MockToken>;
  let mockBookkeeper: MockBookkeeper;
  //endregion Variables

  //region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    facade = await MockHelper.createConverterStrategyBaseLibFacade2(signer);
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 18);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);
    bal = await DeployerUtils.deployMockToken(signer, 'BAL');
    unknown = await DeployerUtils.deployMockToken(signer, 'unknown');
    console.log("usdc", usdc.address);
    console.log("dai", dai.address);
    console.log("tetu", tetu.address);
    console.log("weth", weth.address);
    console.log("usdt", usdt.address);
    console.log("bal", bal.address);
    mapTokenByAddress = new Map<string, MockToken>();
    mapTokenByAddress.set(usdc.address, usdc);
    mapTokenByAddress.set(tetu.address, tetu);
    mapTokenByAddress.set(dai.address, dai);
    mapTokenByAddress.set(weth.address, weth);
    mapTokenByAddress.set(usdt.address, usdt);
    mapTokenByAddress.set(bal.address, bal);

    mockBookkeeper = await MockHelper.createMockBookkeeper(signer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
  //endregion before, after

  //region Unit tests
  describe("registerIncome", () => {
    it("should return expected values if after > before", async () => {
      const r = await facade.registerIncome(1, 2);
      expect(r.earned.toNumber()).eq(1);
      expect(r.lost.toNumber()).eq(0);
    });
    it("should return expected values if after < before", async () => {
      const r = await facade.registerIncome(2, 1);
      expect(r.earned.toNumber()).eq(0);
      expect(r.lost.toNumber()).eq(1);
    });
  });

  describe("postWithdrawActions", () => {
    interface IPostWithdrawActionsParams {
      tokens: MockToken[];
      indexAsset: number;
      reservesBeforeWithdraw: string[];
      liquidityAmountWithdrew: string;
      totalSupplyBeforeWithdraw: string;
      amountsToConvert: string[];
      withdrawnAmounts: string[];
      balances: string[];
      quoteRepays: IQuoteRepayParams[];
    }

    interface IPostWithdrawActionsResults {
      expectedMainAssetAmounts: string[];
      amountsToConvert: string[];
    }

    async function postWithdrawActions(p: IPostWithdrawActionsParams): Promise<IPostWithdrawActionsResults> {
      // set up balances
      for (let i = 0; i < p.tokens.length; ++i) {
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], await p.tokens[i].decimals()));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);

      // set up quote repay
      for (const quoteRepay of p.quoteRepays) {
        await setupMockedQuoteRepay(converter, facade.address, quoteRepay);
      }

      const ret = await facade.callStatic.postWithdrawActions(
        converter.address,
        p.tokens.map(x => x.address),
        p.indexAsset,
        await Promise.all(p.reservesBeforeWithdraw.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals()))
        ),
        parseUnits(p.liquidityAmountWithdrew, 18),
        parseUnits(p.totalSupplyBeforeWithdraw, 18),
        await Promise.all(p.amountsToConvert.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals()))
        ),
        await Promise.all(p.withdrawnAmounts.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals()))
        ),
      );

      return {
        amountsToConvert: await Promise.all(ret._amountsToConvert.map(
          async (x, index) => (+formatUnits(x, await p.tokens[index].decimals())).toString()
        )),
        expectedMainAssetAmounts: await Promise.all(ret.expectedMainAssetAmounts.map(
          async (x, index) => (+formatUnits(x, await p.tokens[p.indexAsset].decimals())).toString()
        )),
      }
    }

    describe("Typical case", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function postWithdrawActionsTest(): Promise<IPostWithdrawActionsResults> {
        return postWithdrawActions({
          tokens: [usdt, dai, usdc, weth, tetu],
          indexAsset: 2,
          balances: ["1000", "2000", "3000", "4000", "5000"], // actual values don't matter here, they are not used
          totalSupplyBeforeWithdraw: "50000",
          liquidityAmountWithdrew: "25000", // 1/2
          reservesBeforeWithdraw: ["100", "200", "300", "400", "500"],
          amountsToConvert: ["1", "2", "3", "4", "5"],
          withdrawnAmounts: ["10", "20", "30", "40", "50"],
          quoteRepays: [
            {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "51", collateralAmountOut: "1"},
            {collateralAsset: usdc, borrowAsset: dai, amountRepay: "102", collateralAmountOut: "2"},
            {collateralAsset: usdc, borrowAsset: weth, amountRepay: "204", collateralAmountOut: "4"},
            {collateralAsset: usdc, borrowAsset: tetu, amountRepay: "255", collateralAmountOut: "5"}
          ]
        });
      }

      it("should return amountsToConvert = amountsToConvert + withdrawnAmounts", async () => {
        const results = await loadFixture(postWithdrawActionsTest);
        expect(results.amountsToConvert.join()).eq(["11", "22", "33", "44", "55"].join());
      });
      it("should return expected value of expectedMainAssetAmounts", async () => {
        const results = await loadFixture(postWithdrawActionsTest);
        expect(results.expectedMainAssetAmounts.join()).eq([1, 2, 150, 4, 5].join());
      });
    });
  });

  describe("postWithdrawActionsEmpty", () => {
    interface IPostWithdrawActionsEmptyParams {
      tokens: MockToken[];
      indexAsset: number;
      amountsToConvert: string[];
      balances: string[]; // collateral, borrow
      quoteRepays: IQuoteRepayParams[];
    }

    interface IPostWithdrawActionsEmptyResults {
      expectedMainAssetAmounts: string[];
    }

    async function postWithdrawActionsEmpty(p: IPostWithdrawActionsEmptyParams): Promise<IPostWithdrawActionsEmptyResults> {
      // set up balances
      for (let i = 0; i < p.tokens.length; ++i) {
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], await p.tokens[i].decimals()));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);

      // set up quote repay
      for (const quoteRepay of p.quoteRepays) {
        await setupMockedQuoteRepay(converter, facade.address, quoteRepay);
      }

      const ret = await facade.callStatic.postWithdrawActionsEmpty(
        converter.address,
        p.tokens.map(x => x.address),
        p.indexAsset,
        await Promise.all(p.amountsToConvert.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals()))
        ),
      );

      return {
        expectedMainAssetAmounts: await Promise.all(ret.map(
          async (x, index) => (+formatUnits(x, await p.tokens[p.indexAsset].decimals())).toString()
        )),
      }
    }

    describe("Typical case", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function postWithdrawActionsTest(): Promise<IPostWithdrawActionsEmptyResults> {
        return postWithdrawActionsEmpty({
          tokens: [usdt, dai, usdc, weth, tetu],
          indexAsset: 2,
          balances: ["1000", "2000", "3000", "4000", "5000"], // actual values don't matter here, they are not used
          amountsToConvert: ["1", "2", "3", "4", "5"],
          quoteRepays: [
            {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "1", collateralAmountOut: "1"},
            {collateralAsset: usdc, borrowAsset: dai, amountRepay: "2", collateralAmountOut: "2"},
            {collateralAsset: usdc, borrowAsset: weth, amountRepay: "4", collateralAmountOut: "4"},
            {collateralAsset: usdc, borrowAsset: tetu, amountRepay: "5", collateralAmountOut: "5"}
          ]
        });
      }

      it("should return expected value of expectedMainAssetAmounts", async () => {
        const results = await loadFixture(postWithdrawActionsTest);
        expect(results.expectedMainAssetAmounts.join()).eq([1, 2, 0, 4, 5].join());
      });
    });
    describe("Zero amounts", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function postWithdrawActionsTest(): Promise<IPostWithdrawActionsEmptyResults> {
        return postWithdrawActionsEmpty({
          tokens: [usdt, dai, usdc, weth, tetu],
          indexAsset: 2,
          balances: ["1000", "2000", "3000", "4000", "5000"], // actual values don't matter here, they are not used
          amountsToConvert: ["0", "0", "0", "0", "0"],
          quoteRepays: []
        });
      }

      it("should return expected value of expectedMainAssetAmounts", async () => {
        const results = await loadFixture(postWithdrawActionsTest);
        expect(results.expectedMainAssetAmounts.join()).eq([0, 0, 0, 0, 0].join());
      });
    });
  });

  describe("claimConverterRewards", () => {
    interface IClaimConverterRewardsParams {
      /**
       * Balances of tokens at the moment of the call of {claimConverterRewards}
       */
      balances: ITokenAmountNum[];

      /**
       * Balances of tokens before the call of {depositorClaimRewards} followed by the call of {claimConverterRewards}
       * see _claim()
       */
      balancesBefore: ITokenAmountNum[];

      /**
       * Depositor pool assets
       */
      tokens: MockToken[];

      depositorRewardTokens: MockToken[];
      depositorRewardAmounts: string[];

      converterRewardTokens: MockToken[];
      converterRewardAmounts: string[];
    }

    interface IClaimConverterRewardsResults {
      /**
       * Amounts corresponding to each token name
       */
      amounts: string[];
      /**
       * Result ordered list of token names, i.e. usdc, usdt, dai, tetu...
       */
      tokenNames: string[];
    }

    async function makeClaimConverterRewards(p: IClaimConverterRewardsParams): Promise<IClaimConverterRewardsResults> {
      // set up initial balances
      for (const t of p.balances) {
        await t.token.mint(
          facade.address,
          parseUnits(t.amount, await t.token.decimals())
        )
      }

      // set up rewards in the converter
      const converter = await MockHelper.createMockTetuConverter(signer);
      await converter.setClaimRewards(
        p.converterRewardTokens.map(x => x.address),
        await Promise.all(p.converterRewardAmounts.map(
          async (amount, index) => parseUnits(
            amount,
            await p.converterRewardTokens[index].decimals()
          )
        )),
      )
      for (let i = 0; i < p.converterRewardTokens.length; ++i) {
        await p.converterRewardTokens[i].mint(
          converter.address,
          parseUnits(p.converterRewardAmounts[i], await p.converterRewardTokens[i].decimals())
        )
      }

      // call claimConverterRewards
      const {tokensOut, amountsOut} = await facade.callStatic.claimConverterRewards(
        converter.address,
        p.tokens.map(x => x.address),
        p.depositorRewardTokens.map(x => x.address),
        await Promise.all(p.depositorRewardAmounts.map(
          async (amount, index) => parseUnits(amount, await p.depositorRewardTokens[index].decimals())
        )),
        await Promise.all(p.balancesBefore.map(
          async x => parseUnits(x.amount, await x.token.decimals())
        )),
      );

      const orderedResults: { tokenName: string, amount: string }[] = (await Promise.all(
        tokensOut.map(
          async (x, index) => ({
            tokenName: await mapTokenByAddress.get(x)?.symbol() || "?",
            amount: (+formatUnits(
              amountsOut[index],
              await IERC20Metadata__factory.connect(tokensOut[index], signer).decimals()
            )).toString()
          })
        )
      )).sort((x, y) => x.tokenName.localeCompare(y.tokenName));

      return {
        tokenNames: orderedResults.map(x => x.tokenName),
        amounts: orderedResults.map(x => x.amount),
      }
    }

    describe("Good paths", () => {
      describe("Normal case", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClaimConverterRewardsTest(): Promise<IClaimConverterRewardsResults> {
          return makeClaimConverterRewards({
            balances: [
              {token: usdc, amount: "201"},
              {token: usdt, amount: "202"},
              {token: dai, amount: "203"}, // unregistered airdrop
              {token: tetu, amount: "4"}, // dust tokens, we never use them
              {token: bal, amount: "5"}, // dust tokens, we never use them
            ],
            balancesBefore: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
              {token: tetu, amount: "4"},  // dust tokens, we never use them
              {token: bal, amount: "5"},  // dust tokens, we never use them
            ],
            tokens: [usdc, usdt, dai],
            depositorRewardTokens: [usdc, usdt],
            depositorRewardAmounts: ["201", "202"],
            converterRewardTokens: [tetu, bal],
            converterRewardAmounts: ["111", "222"]
          });
        }

        it("should return list of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.tokenNames.join()).eq(["BAL", "DAI", "TETU", "USDC", "USDT"].join());
        });
        it("should return amounts of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.amounts.join()).eq(["222", "203", "111", "201", "202"].join());
        });
      });
      describe("Converter rewards, pool rewards, pool assets are all different", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClaimConverterRewardsTest(): Promise<IClaimConverterRewardsResults> {
          return makeClaimConverterRewards({
            balances: [
              {token: usdc, amount: "1"},
              {token: usdt, amount: "2"},
              {token: dai, amount: "3"},
              {token: tetu, amount: "0"},
              {token: bal, amount: "0"},
            ],
            balancesBefore: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
              {token: tetu, amount: "0"},
              {token: bal, amount: "0"},
            ],
            tokens: [usdc, usdt, dai],
            depositorRewardTokens: [bal],
            depositorRewardAmounts: ["11"],
            converterRewardTokens: [tetu],
            converterRewardAmounts: ["7"]
          });
        }

        it("should return list of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.tokenNames.join()).eq(["BAL", "DAI", "TETU", "USDC", "USDT"].join());
        });
        it("should return amounts of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.amounts.join()).eq(["11", "3", "7", "1", "2"].join());
        });
      });
      describe("Converter rewards, pool rewards, pool assets are same", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClaimConverterRewardsTest(): Promise<IClaimConverterRewardsResults> {
          return makeClaimConverterRewards({
            balances: [
              {token: usdc, amount: "201"},
              {token: usdt, amount: "202"},
              {token: dai, amount: "203"},
              {token: tetu, amount: "4"},
              {token: bal, amount: "5"},
            ],
            balancesBefore: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
              {token: tetu, amount: "0"},
              {token: bal, amount: "0"},
            ],
            tokens: [usdc, usdt, dai],
            depositorRewardTokens: [usdc, usdt, dai, tetu, bal],
            depositorRewardAmounts: ["11", "12", "13", "14", "15"],
            converterRewardTokens: [usdc, usdt, dai, tetu, bal],
            converterRewardAmounts: ["100", "101", "102", "103", "104"]
          });
        }

        it("should return list of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.tokenNames.join()).eq(["BAL", "DAI", "TETU", "USDC", "USDT"].join());
        });
        it("should return amounts of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          // mocked converter sends tokens to the strategy balance
          //
          expect(results.amounts.join()).eq(["119", "305", "117", "301", "303"].join());
        });
      });
    });

    describe("Bad paths", () => {
      describe("Empty arrays", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClaimConverterRewardsTest(): Promise<IClaimConverterRewardsResults> {
          return makeClaimConverterRewards({
            balances: [],
            balancesBefore: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
            ],
            tokens: [usdc, usdt, dai],
            depositorRewardTokens: [],
            depositorRewardAmounts: [],
            converterRewardTokens: [],
            converterRewardAmounts: []
          });
        }

        it("should return empty list of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.tokenNames.join()).eq([].join());
        });
        it("should return empty list of amounts", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          // mocked converter sends tokens to the strategy balance
          expect(results.amounts.join()).eq([].join());
        });
      });
      describe("All amounts zero, dust tokens exist on the balance", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeClaimConverterRewardsTest(): Promise<IClaimConverterRewardsResults> {
          return makeClaimConverterRewards({
            balances: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
              {token: tetu, amount: "1111111"}, // duct tokens
              {token: bal, amount: "22222222"}, // dust tokens
            ],
            balancesBefore: [
              {token: usdc, amount: "0"},
              {token: usdt, amount: "0"},
              {token: dai, amount: "0"},
              {token: tetu, amount: "1111111"}, // duct tokens
              {token: bal, amount: "22222222"}, // dust tokens
            ],
            tokens: [usdc, usdt, dai],
            depositorRewardTokens: [usdc, usdt, dai, tetu, bal],
            depositorRewardAmounts: ["0", "0", "0", "0", "0"],
            converterRewardTokens: [usdc, usdt, dai, tetu, bal],
            converterRewardAmounts: ["0", "0", "0", "0", "0"]
          });
        }

        it("should return empty list of tokens", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          expect(results.tokenNames.join()).eq([].join());
        });
        it("should return empty list of amounts", async () => {
          const results = await loadFixture(makeClaimConverterRewardsTest);
          // mocked converter sends tokens to the strategy balance
          // we allow the dust tokens to accumulate on strategy balance forever
          // (it's valid for tokens that don't belong to the list of depositor tokens)
          expect(results.amounts.join()).eq([].join());
        });
      });
    });
  });

  describe('getLiquidityAmount', () => {
    const DECIMALS_LIQUIDITY = 18;

    interface IGetLiquidityAmountParams {
      tokens: MockToken[];
      indexAsset: number;
      indexUnderlying?: number;

      targetAmount: string;
      assetsInPool: string[];
      depositorLiquidity: string;

      balances: string[];
      prices?: string[];
    }

    interface IGetLiquidityAmountResults {
      resultAmount: number;
    }

    async function getLiquidityAmount(p: IGetLiquidityAmountParams): Promise<IGetLiquidityAmountResults> {
      // set up balances
      for (let i = 0; i < p.tokens.length; ++i) {
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], await p.tokens[i].decimals()));
      }

      // set up TetuConverter
      const converter = await MockHelper.createMockTetuConverter(signer);
      const prices = p.prices ?? p.tokens.map(x => "1");
      const priceOracle = await MockHelper.createPriceOracle(
        signer,
        p.tokens.map(x => x.address),
        await Promise.all(p.tokens.map(
          async (x, index) => parseUnits(prices[index], 18)
        ))
      );
      const tetuConverterController = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await converter.setController(tetuConverterController.address);

      // set up quote repay
      const resultAmount = await facade.getLiquidityAmount(
        p.targetAmount === "all"
          ? Misc.MAX_UINT
          : parseUnits(p.targetAmount, await p.tokens[p.indexAsset].decimals()),
        p.tokens.map(x => x.address),
        p.indexAsset,
        converter.address,
        await Promise.all(p.assetsInPool.map(
          async (x, index) => parseUnits(x, await p.tokens[index].decimals())
        )),
        parseUnits(p.depositorLiquidity, DECIMALS_LIQUIDITY),
        p.indexUnderlying ?? p.indexAsset
      );

      return {
        resultAmount: +formatUnits(resultAmount, DECIMALS_LIQUIDITY)
      }
    }

    describe('Good paths', () => {
      describe('asset is underlying', () => {
        describe('partial', () => {
          describe('zero balances', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                targetAmount: "5",
                assetsInPool: ["0", "500", "0"],
                depositorLiquidity: "7",
                balances: ["0", "0", "0"],
              });
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(7 * 101 / 100 * 5 / 500);
            });
          });
          describe('amount of first asset is enough to get the required amount', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                targetAmount: "5",
                assetsInPool: ["0", "500", "0"],
                depositorLiquidity: "7",
                balances: ["17", "27", "37"],
              })
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(0);
            });
          });
          describe('sum amount of two assets is enough to get the required amount', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                targetAmount: "9",
                assetsInPool: ["0", "500", "0"],
                depositorLiquidity: "7",
                balances: ["7", "0", "14"],
              })
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(0);
            });
          });
          describe('amount of two assets is NOT enough to get the required amount', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                targetAmount: "19",
                assetsInPool: ["0", "500", "0"],
                depositorLiquidity: "7",
                balances: ["7", "2700", "2"],
              })
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(7 * 101 / 100 * (19 - 9) / (500 - 9));
            });
          });
        });
        describe('all', () => {
          describe('zero balances', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                targetAmount: "all", // all
                assetsInPool: ["0", "500", "0"],
                depositorLiquidity: "7777",
                balances: ["0", "0", "0"],
              })
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(7777);
            });
          });
          describe('balances are not zero', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                targetAmount: "all",
                assetsInPool: ["0", "500", "0"],
                depositorLiquidity: "7777",
                balances: ["17", "27", "37"],
              })
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(7777);
            });
          });
        });
      });
      describe('asset is not underlying', () => {
        describe('partial', () => {
          describe('zero balances', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 0,
                indexUnderlying: 1,
                targetAmount: "5",
                assetsInPool: ["0", "500", "0"],
                depositorLiquidity: "7",
                balances: ["0", "0", "0"],
              });
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(7 * 101 / 100 * 5 / 500);
            });
          });
          describe('sum amount of two assets is enough to get the required amount', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 0,
                indexUnderlying: 1,
                targetAmount: "9",
                assetsInPool: ["0", "500", "0"],
                depositorLiquidity: "7",
                balances: ["0", "7", "14"],
              })
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(0);
            });
          });
          describe('amount of two assets is NOT enough to get the required amount', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 2,
                indexUnderlying: 1,
                targetAmount: "19",
                assetsInPool: ["0", "500", "0"],
                depositorLiquidity: "7",
                balances: ["2", "7", "2700"],
              })
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(7 * 101 / 100 * (19 - 9) / (500 - 9));
            });
          });
        });
        describe('all', () => {
          describe('zero balances', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                indexUnderlying: 2,
                targetAmount: "all", // all
                assetsInPool: ["0", "0", "500"],
                depositorLiquidity: "7777",
                balances: ["0", "0", "0"],
              })
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(7777);
            });
          });
          describe('balances are not zero', () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
              return getLiquidityAmount({
                tokens: [dai, usdc, usdt],
                indexAsset: 0,
                indexUnderlying: 2,
                targetAmount: "all",
                assetsInPool: ["0", "0", "500"],
                depositorLiquidity: "7777",
                balances: ["17000", "27", "37"],
              })
            }

            it('should return expected resultAmount', async () => {
              const results = await loadFixture(getLiquidityAmountTest);
              expect(results.resultAmount).eq(7777);
            });
          });
        });
      });
      describe('prices are different', () => {
        describe('amount of two assets is NOT enough to get the required amount', () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
            return getLiquidityAmount({
              tokens: [dai, usdc, usdt],
              indexAsset: 0,
              indexUnderlying: 2, // usdt
              targetAmount: "9", // == 9 dai == 18 usdt
              assetsInPool: ["2.5", "10", "10"], // == 20 usdt
              depositorLiquidity: "7",
              balances: ["8", "4", "12"], // 8 dai, 1 dai, 6 dai
              prices: ["2", "0.5", "1"]
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).approximately(7 * 101 / 100 * (9*2 - 7*2) / (20 - 7*2), 1e18);
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe('targetAmount > investedAmount, investedAmount == sum(balances)', () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function getLiquidityAmountTest(): Promise<IGetLiquidityAmountResults> {
          return getLiquidityAmount({
            tokens: [dai, usdc, usdt],
            indexAsset: 1,
            targetAmount: "500",
            assetsInPool: ["0", "21", "0"],
            depositorLiquidity: "777",
            balances: ["7", "27000", "14"],
          })
        }

        it('should return expected resultAmount', async () => {
          const results = await loadFixture(getLiquidityAmountTest);
          expect(results.resultAmount).eq(777);
        });
      });
    })
  });

  describe("HARDWORK_LOSS_TOLERANCE", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });
    it("should be equal to the value from StrategySplitterV2", async () => {
      const splitter = await DeployerUtils.deployContract(signer, "StrategySplitterV2") as StrategySplitterV2;
      const toleranceInStrategySplitterV2 = (await splitter.HARDWORK_LOSS_TOLERANCE()).toNumber();
      const toleranceInLib = (await facade.getHardworkLossToleranceValue()).toNumber();
      expect(toleranceInStrategySplitterV2).eq(toleranceInLib);
    });
  });

  describe("getSafeLossToCover", () => {
    describe("loss == max allowed amount to cover", () => {
      it("should return expected values", async () => {
        // 500 * 200_000 / 100_000 = 1000
        const ret = (await facade.getSafeLossToCover(1000, 200_000));
        expect(ret.lossToCover.toNumber()).eq(1000);
        expect(ret.lossUncovered.toNumber()).eq(0);
      });
    });
    describe("loss > max allowed amount to cover", () => {
      it("should return cut value", async () => {
        // 500 * 200_000 / 100_000 = 1000
        const ret = (await facade.getSafeLossToCover(1001, 200_000));
        expect(ret.lossToCover.toNumber()).eq(1000);
        expect(ret.lossUncovered.toNumber()).eq(1);
      });
    });
  });

  describe("coverLossAfterPriceChanging", () => {
    interface IParams {
      asset: MockToken;
      strategyBalance: string;
      investedAssetsBefore: string;
      investedAssetsAfter: string;
      expectedLossAmount: string;
      increaseToDebt: string;
      debtToInsurance?: string;
    }

    interface IUncoveredLossEvent {
      emittedLossToCover: number;
      emittedLossUncovered: number;
      emittedInvestedAssetsBefore: number;
      emittedInvestedAssetsAfter: number;
    }

    interface IFixPriceChanges {
      emittedInvestedAssetsBefore: number;
      emittedInvestedAssetsAfter: number;
      emittedIncreaseToDebt: number;
    }

    interface IResults {
      earned: number;
      vaultBalance: number;

      uncoveredLoss?: IUncoveredLossEvent;
      fixPriceChanges?: IFixPriceChanges;

      debtToInsurance: number;
    }

    async function callCoverLossAfterPriceChanging(p: IParams): Promise<IResults> {
      // prepare splitter and vault
      const splitter = await MockHelper.createMockSplitter(signer);
      const vault = ethers.Wallet.createRandom().address;
      await splitter.setAsset(p.asset.address);
      await splitter.setVault(vault);

      const assetDecimals = await p.asset.decimals();
      const lossAmount = parseUnits(p.expectedLossAmount, assetDecimals);
      if (lossAmount.gt(0)) {
        await p.asset.mint(splitter.address, lossAmount);
      }

      await p.asset.mint(facade.address, parseUnits(p.strategyBalance, assetDecimals));

      await facade.setDebtToInsurance(parseUnits(p.debtToInsurance ?? "0", assetDecimals));

      const earned = await facade.callStatic.coverLossAfterPriceChanging(
        parseUnits(p.investedAssetsBefore, assetDecimals),
        parseUnits(p.investedAssetsAfter, assetDecimals),
        parseUnits(p.increaseToDebt, assetDecimals),
        p.asset.address,
        splitter.address
      );

      const tx = await facade.coverLossAfterPriceChanging(
        parseUnits(p.investedAssetsBefore, assetDecimals),
        parseUnits(p.investedAssetsAfter, assetDecimals),
        parseUnits(p.increaseToDebt, assetDecimals),
        p.asset.address,
        splitter.address
      );

      let uncoveredLoss: IUncoveredLossEvent | undefined;
      let fixPriceChanges: IFixPriceChanges | undefined;

      const cr = await tx.wait();
      const converterStrategyBaseLib2 = ConverterStrategyBaseLib2__factory.createInterface();
      for (const event of (cr.events ?? [])) {
        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2.getEventTopic('UncoveredLoss').toLowerCase()) {
          const log = (converterStrategyBaseLib2.decodeEventLog(
            converterStrategyBaseLib2.getEvent('UncoveredLoss'),
            event.data,
            event.topics,
          ) as unknown) as UncoveredLossEventObject;
          uncoveredLoss = {
            emittedLossToCover: +formatUnits(log.lossCovered, assetDecimals),
            emittedInvestedAssetsAfter: +formatUnits(log.investedAssetsAfter, assetDecimals),
            emittedInvestedAssetsBefore: +formatUnits(log.investedAssetsBefore, assetDecimals),
            emittedLossUncovered: +formatUnits(log.lossUncovered, assetDecimals),
          }
        }
        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2.getEventTopic('FixPriceChanges').toLowerCase()) {
          const log = (converterStrategyBaseLib2.decodeEventLog(
            converterStrategyBaseLib2.getEvent('FixPriceChanges'),
            event.data,
            event.topics,
          ) as unknown) as FixPriceChangesEventObject;
          fixPriceChanges = {
            emittedInvestedAssetsAfter: +formatUnits(log.investedAssetsOut, assetDecimals),
            emittedInvestedAssetsBefore: +formatUnits(log.investedAssetsBefore, assetDecimals),
            emittedIncreaseToDebt: +formatUnits(log.increaseToDebt, assetDecimals),
          }
        }
      }

      return {
        fixPriceChanges,
        uncoveredLoss,
        earned: +formatUnits(earned, assetDecimals),
        vaultBalance: +formatUnits(await p.asset.balanceOf(vault), assetDecimals),
        debtToInsurance: +formatUnits((await facade.getCsb()).debtToInsurance, assetDecimals),
      }
    }

    describe("increaseToDebt is zero", () => {
      describe("Lost is covered fully", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeTest(): Promise<IResults> {
          return callCoverLossAfterPriceChanging({
            asset: usdc,
            investedAssetsAfter: "10000",
            strategyBalance: "1000",
            // max loss to cover = (1000 + 10_000)*500/100_000 = 55
            investedAssetsBefore: "10055",
            expectedLossAmount: "55",
            increaseToDebt: "0"
          });
        }

        it("should send full amount of loss to vault", async () => {
          const ret = await loadFixture(makeTest);
          expect(ret.vaultBalance).eq(55);
        });
        it("should emit FixPriceChanges with correct params", async () => {
          const ret = await loadFixture(makeTest);
          expect(ret.fixPriceChanges?.emittedInvestedAssetsAfter).eq(10_000);
          expect(ret.fixPriceChanges?.emittedInvestedAssetsBefore).eq(10_055);
        });
        it("should not emit UncoveredLoss", async () => {
          const ret = await loadFixture(makeTest);
          expect(ret.uncoveredLoss === undefined).eq(true);
        });
      });
      describe("Lost is covered partially", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeTest(): Promise<IResults> {
          return callCoverLossAfterPriceChanging({
            asset: usdc,
            investedAssetsAfter: "10000",
            strategyBalance: "1000",
            // max loss to cover = (1000 + 10_000)*500/100_000 = 55
            investedAssetsBefore: "10100", // 55 covered, 45 uncovered
            expectedLossAmount: "55",
            increaseToDebt: "0"
          });
        }

        it("should send expected amount of loss to vault", async () => {
          const ret = await loadFixture(makeTest);
          expect(ret.vaultBalance).eq(55);
        });
        it("should emit FixPriceChanges with correct params", async () => {
          const ret = await loadFixture(makeTest);
          expect(ret.fixPriceChanges?.emittedInvestedAssetsAfter).eq(10_000);
          expect(ret.fixPriceChanges?.emittedInvestedAssetsBefore).eq(10_100);
        });
        it("should emit UncoveredLoss with correct params", async () => {
          const ret = await loadFixture(makeTest);
          expect(ret.uncoveredLoss?.emittedLossToCover).eq(55);
          expect(ret.uncoveredLoss?.emittedLossUncovered).eq(45);
          expect(ret.uncoveredLoss?.emittedInvestedAssetsAfter).eq(10_000);
          expect(ret.uncoveredLoss?.emittedInvestedAssetsBefore).eq(10_100);
        });
      });
    });

    describe("increaseToDebt is not zero", () => {
      describe("InvestedAssets amount is decreased", () => {
        describe("Change by price + positive debts", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTest(): Promise<IResults> {
            return callCoverLossAfterPriceChanging({
              asset: usdc,
              investedAssetsBefore: "101000",
              investedAssetsAfter: "100600",
              increaseToDebt: "100",
              debtToInsurance: "1",

              strategyBalance: "1000",
              expectedLossAmount: "400",
            });
          }

          it("should send full amount of loss to vault", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.vaultBalance).eq(400);
          });
          it("should emit FixPriceChanges with correct params", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsAfter).eq(100600);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsBefore).eq(101000);
            expect(ret.fixPriceChanges?.emittedIncreaseToDebt).eq(100);
          });
          it("should not emit UncoveredLoss", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.uncoveredLoss === undefined).eq(true);
          });
          it("should set expected debtToInsurance", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.debtToInsurance).eq(1 + 100);
          });
          it("should return zero", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.earned).eq(0);
          });
        });
        describe("Change by price + negative debts", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTest(): Promise<IResults> {
            return callCoverLossAfterPriceChanging({
              asset: usdc,
              investedAssetsBefore: "101000",
              investedAssetsAfter: "100400",
              increaseToDebt: "-100",
              debtToInsurance: "1",

              strategyBalance: "100000",
              expectedLossAmount: "600",
            });
          }

          it("should send full amount of loss to vault", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.vaultBalance).eq(600);
          });
          it("should emit FixPriceChanges with correct params", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsAfter).eq(100400);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsBefore).eq(101000);
            expect(ret.fixPriceChanges?.emittedIncreaseToDebt).eq(-100);
          });
          it("should not emit UncoveredLoss", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.uncoveredLoss === undefined).eq(true);
          });
          it("should set expected debtToInsurance", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.debtToInsurance).eq(1 - 100);
          });
          it("should return zero", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.earned).eq(0);
          });
        });
        describe("No change by price, positive debts", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTest(): Promise<IResults> {
            return callCoverLossAfterPriceChanging({
              asset: usdc,
              investedAssetsBefore: "101000",
              investedAssetsAfter: "100600",
              increaseToDebt: "400",
              debtToInsurance: "1",

              strategyBalance: "1000",
              expectedLossAmount: "400",
            });
          }

          it("should send full amount of loss to vault", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.vaultBalance).eq(400);
          });
          it("should emit FixPriceChanges with correct params", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsAfter).eq(100600);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsBefore).eq(101000);
            expect(ret.fixPriceChanges?.emittedIncreaseToDebt).eq(400);
          });
          it("should not emit UncoveredLoss", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.uncoveredLoss === undefined).eq(true);
          });
          it("should set expected debtToInsurance", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.debtToInsurance).eq(1 + 400);
          });
          it("should return zero", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.earned).eq(0);
          });
        });
      });

      describe("InvestedAssets amount is increased", () => {
        describe("Change by price + positive debts", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTest(): Promise<IResults> {
            return callCoverLossAfterPriceChanging({
              asset: usdc,
              investedAssetsBefore: "101000",
              investedAssetsAfter: "102100",
              increaseToDebt: "100",
              debtToInsurance: "1",

              strategyBalance: "1000",
              expectedLossAmount: "1100",
            });
          }

          it("should not change balance of the vault", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.vaultBalance).eq(0);
          });
          it("should emit FixPriceChanges with correct params", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsAfter).eq(102100);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsBefore).eq(101000);
            expect(ret.fixPriceChanges?.emittedIncreaseToDebt).eq(100);
          });
          it("should not emit UncoveredLoss", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.uncoveredLoss === undefined).eq(true);
          });
          it("should set expected debtToInsurance", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.debtToInsurance).eq(1 + 100);
          });
          it("should return zero", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.earned).eq(1100);
          });
        });
        describe("Change by price + negative debts", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTest(): Promise<IResults> {
            return callCoverLossAfterPriceChanging({
              asset: usdc,
              investedAssetsBefore: "101000",
              investedAssetsAfter: "101900",
              increaseToDebt: "-100",
              debtToInsurance: "1",

              strategyBalance: "100000",
              expectedLossAmount: "900",
            });
          }

          it("should not change balance of the vault", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.vaultBalance).eq(0);
          });
          it("should emit FixPriceChanges with correct params", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsAfter).eq(101900);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsBefore).eq(101000);
            expect(ret.fixPriceChanges?.emittedIncreaseToDebt).eq(-100);
          });
          it("should not emit UncoveredLoss", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.uncoveredLoss === undefined).eq(true);
          });
          it("should set expected debtToInsurance", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.debtToInsurance).eq(1 - 100);
          });
          it("should return zero", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.earned).eq(900);
          });
        });
        describe("No change by price, negative debts", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeTest(): Promise<IResults> {
            return callCoverLossAfterPriceChanging({
              asset: usdc,
              investedAssetsBefore: "101000",
              investedAssetsAfter: "101400",
              increaseToDebt: "-400",
              debtToInsurance: "1",

              strategyBalance: "1000",
              expectedLossAmount: "0",
            });
          }

          it("should not change balance of the vault", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.vaultBalance).eq(0);
          });
          it("should emit FixPriceChanges with correct params", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsAfter).eq(101400);
            expect(ret.fixPriceChanges?.emittedInvestedAssetsBefore).eq(101000);
            expect(ret.fixPriceChanges?.emittedIncreaseToDebt).eq(-400);
          });
          it("should not emit UncoveredLoss", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.uncoveredLoss === undefined).eq(true);
          });
          it("should set expected debtToInsurance", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.debtToInsurance).eq(1 - 400);
          });
          it("should return zero", async () => {
            const ret = await loadFixture(makeTest);
            expect(ret.earned).eq(400);
          });
        });
      });
    });
  });

  describe("sendToInsurance", () => {
    interface ISendToInsuranceParams {
      asset: MockToken;
      amount: string;
      totalAssets: string;
      insuranceBalance: string;
      strategyBalance: string;
    }

    interface ISendToInsuranceResults {
      sentAmount: number;
      unsentAmount: number;
      strategyBalance: number;
      insuranceBalance: number;
    }

    async function callSendToInsurance(p: ISendToInsuranceParams): Promise<ISendToInsuranceResults> {
      const insurance = ethers.Wallet.createRandom().address;
      const decimals = await p.asset.decimals();

      const vault = await MockHelper.createMockVault(signer);
      await vault.setInsurance(insurance);

      const splitter = await MockHelper.createMockSplitter(signer);
      await splitter.setVault(vault.address);

      await p.asset.mint(facade.address, parseUnits(p.strategyBalance, decimals));

      const {sentAmount, unsentAmount} = await facade.callStatic.sendToInsurance(
        p.asset.address,
        parseUnits(p.amount, decimals),
        splitter.address,
        parseUnits(p.totalAssets, decimals)
      );
      await facade.sendToInsurance(
        p.asset.address,
        parseUnits(p.amount, decimals),
        splitter.address,
        parseUnits(p.totalAssets, decimals)
      );

      return {
        sentAmount: +formatUnits(sentAmount, decimals),
        unsentAmount: +formatUnits(unsentAmount, decimals),
        insuranceBalance: +formatUnits(await p.asset.balanceOf(insurance), decimals),
        strategyBalance: +formatUnits(await p.asset.balanceOf(facade.address), decimals),
      }
    }

    describe("Good paths", () => {
      describe("Amount <= current balance", () => {
        describe("Amount <= max allowed value", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callSendToInsuranceTest(): Promise<ISendToInsuranceResults> {
            // max allowed value = 500 * 200_000 / 100_000 = 1000
            return callSendToInsurance({
              asset: usdc,
              insuranceBalance: "0",
              amount: "999",
              strategyBalance: "1000",
              totalAssets: "200000"
            });
          }

          it("should send amount to insurance", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.insuranceBalance).eq(999);
          });
          it("should reduce strategy balance on amount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.strategyBalance).eq(1000 - 999);
          });
          it("should return expected sentAmount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.sentAmount).eq(999);
          });
          it("should return expected unsentAmount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.unsentAmount).eq(0);
          });
        });
        describe("Amount > max allowed value", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callSendToInsuranceTest(): Promise<ISendToInsuranceResults> {
            // max allowed value = 500 * 200_000 / 100_000 = 1000
            return callSendToInsurance({
              asset: usdc,
              insuranceBalance: "0",
              amount: "1020",
              strategyBalance: "2000",
              totalAssets: "200000"
            });
          }

          it("should send expected amount to insurance", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.insuranceBalance).eq(1000);
          });
          it("should reduce strategy balance on expected amount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.strategyBalance).eq(2000 - 1000);
          });
          it("should return expected sentAmount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.sentAmount).eq(1000);
          });
          it("should return expected unsentAmount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.unsentAmount).eq(20);
          });
        });
        describe("Current balance is zero", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callSendToInsuranceTest(): Promise<ISendToInsuranceResults> {
            // max allowed value = 500 * 200_000 / 100_000 = 1000
            return callSendToInsurance({
              asset: usdc,
              insuranceBalance: "0",
              amount: "1020",
              strategyBalance: "0",
              totalAssets: "200000"
            });
          }

          it("should send nothing to insurance", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.insuranceBalance).eq(0);
          });
          it("should not change strategy balance", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.strategyBalance).eq(0);
          });
          it("should return zero sentAmount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.sentAmount).eq(0);
          });
          it("should return expected", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.unsentAmount).eq(1020);
          });
        });
      });
      describe("Amount > current balance", () => {
        describe("Amount <= max allowed value", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function callSendToInsuranceTest(): Promise<ISendToInsuranceResults> {
            // max allowed value = 500 * 200_000 / 100_000 = 1000
            return callSendToInsurance({
              asset: usdc,
              insuranceBalance: "0",
              amount: "500",
              strategyBalance: "100",
              totalAssets: "200000"
            });
          }

          it("should send amount to insurance", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.insuranceBalance).eq(100);
          });
          it("should reduce strategy balance on amount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.strategyBalance).eq(0);
          });
          it("should return expected sentAmount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.sentAmount).eq(100);
          });
          it("should return expected unsentAmount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.unsentAmount).eq(500 - 100);
          });
        });
      });
    });
    describe("Bad paths", () => {
      let snapshot: string;
      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      it("should revert if totalAssets is zero", async () => {
        await expect(callSendToInsurance({
          asset: usdc,
          insuranceBalance: "0",
          amount: "500",
          strategyBalance: "10",
          totalAssets: "0"
        })).revertedWith("TS-5 zero balance"); // ZERO_BALANCE
      });
    });
  });

  describe("getTokenAmountsPair", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface IGetTokenAmountsPair {
      totalAssets: string;
      balances: string[];
      tokens: MockToken[];
      liquidationThresholds: string[];
    }

    interface IGetTokenAmountsResults {
      loss: number;
      tokenAmounts: number[];
    }

    async function callGetTokenAmountsPair(p: IGetTokenAmountsPair): Promise<IGetTokenAmountsResults> {
      // set up TetuConverter with prices
      const converter = await MockHelper.createMockTetuConverter(signer);
      const priceOracle = await MockHelper.createPriceOracle(
        signer,
        p.tokens.map(x => x.address),
        p.tokens.map(x => parseUnits("1", 18)),
      );
      const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await converter.setController(controller.address);
      await controller.setBookkeeper(mockBookkeeper.address);

      for (let i = 0; i < 2; ++i) {
        await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], await p.tokens[i].decimals()));
      }

      const ret = await facade.callStatic.getTokenAmountsPair(
        converter.address,
        parseUnits(p.totalAssets, 6),
        p.tokens[0].address,
        p.tokens[1].address,
        [
          parseUnits(p.liquidationThresholds[0], await p.tokens[0].decimals()),
          parseUnits(p.liquidationThresholds[1], await p.tokens[1].decimals()),
        ]
      );

      return {
        loss: +formatUnits(ret.loss, 6),
        tokenAmounts: ret.tokenAmounts.length === 0
          ? []
          : [
            +formatUnits(ret.tokenAmounts[0], await p.tokens[0].decimals()),
            +formatUnits(ret.tokenAmounts[1], await p.tokens[1].decimals()),
          ]
      }
    }

    it("should return expected tokenAmounts (len 2)", async () => {
      const ret = await callGetTokenAmountsPair({
        tokens: [usdc, usdt],
        balances: ["100", "200"],
        liquidationThresholds: ["99", "199"],
        totalAssets: "4"
      });
      expect(
        [ret.tokenAmounts.length, ret.tokenAmounts[0], ret.tokenAmounts[1]].join()
      ).eq(
        [2, 100, 200].join()
      );
    });

    it("should return zero tokenAmounts if first amount is less the threshold", async () => {
      const ret = await callGetTokenAmountsPair({
        tokens: [usdc, usdt],
        balances: ["100", "200"],
        liquidationThresholds: ["101", "199"],
        totalAssets: "4"
      });
      expect(ret.tokenAmounts.length).eq(0);
    });
    it("should return zero tokenAmounts if second amount is less the threshold", async () => {
      const ret = await callGetTokenAmountsPair({
        tokens: [usdc, usdt],
        balances: ["100", "200"],
        liquidationThresholds: ["99", "201"],
        totalAssets: "4"
      });
      expect(ret.tokenAmounts.length).eq(0);
    });
    it("should return tokenAmounts equal to the balances if the thresholds are not set (not real case)", async () => {
      const ret = await callGetTokenAmountsPair({
        tokens: [usdc, usdt],
        balances: ["100", "0"],
        liquidationThresholds: ["0", "0"], // not real case
        totalAssets: "4"
      });
      // getTokenAmountsPair assumes, that AppLib._getLiquidationThreshold is already applied to liquidationThresholds
      // so the thresholds are not zero. So, actually this test tests not real case
      expect(
        [ret.tokenAmounts.length, ret.tokenAmounts[0], ret.tokenAmounts[1]].join()
      ).eq(
        [2, 100, 0].join()
      );
    });
  });

  describe("_coverLossAndCheckResults", () => {
    interface IParams {
      asset: MockToken;
      insuranceBalance: string;
      lossToCover: string;
      debtToInsuranceInc: string;
      debtToInsurance: string;
    }

    interface INotEnoughInsurance {
      emittedLossUncovered: number;
    }

    interface IResults {
      vaultBalance: number;
      insuranceBalance: number;
      uncoveredLoss?: INotEnoughInsurance;
      debtToInsurance: number;
    }

    async function callCoverLoss(p: IParams): Promise<IResults> {
      // prepare splitter and vault
      const splitter = await MockHelper.createMockSplitter(signer);
      const vault = ethers.Wallet.createRandom().address;
      await splitter.setAsset(p.asset.address);
      await splitter.setVault(vault);

      await facade.setDebtToInsurance(parseUnits(p.debtToInsurance, await p.asset.decimals()));

      const assetDecimals = await p.asset.decimals();

      // splitter-mock plays a role of insurance in this test
      const insuranceAmount = parseUnits(p.insuranceBalance, assetDecimals);
      if (insuranceAmount.gt(0)) {
        await p.asset.mint(splitter.address, insuranceAmount);
      }

      const tx = await facade._coverLossAndCheckResults(
        splitter.address,
        parseUnits(p.lossToCover, assetDecimals),
        parseUnits(p.debtToInsuranceInc, assetDecimals),
      );

      let notEnoughInsurance: INotEnoughInsurance | undefined;

      const cr = await tx.wait();
      const converterStrategyBaseLib2 = ConverterStrategyBaseLib2__factory.createInterface();
      for (const event of (cr.events ?? [])) {
        if (event.topics[0].toLowerCase() === converterStrategyBaseLib2.getEventTopic('OnCoverLoss').toLowerCase()) {
          const log = (converterStrategyBaseLib2.decodeEventLog(
            converterStrategyBaseLib2.getEvent('OnCoverLoss'),
            event.data,
            event.topics,
          ) as unknown) as OnCoverLossEventObject;
          notEnoughInsurance = {
            emittedLossUncovered: +formatUnits(log.lossUncovered, assetDecimals),
          }
        }
      }

      return {
        uncoveredLoss: notEnoughInsurance,
        vaultBalance: +formatUnits(await p.asset.balanceOf(vault), assetDecimals),
        insuranceBalance: +formatUnits(await p.asset.balanceOf(splitter.address), assetDecimals),
        debtToInsurance: +formatUnits((await facade.getCsb()).debtToInsurance, assetDecimals),
      }
    }

    describe("Loss is covered fully", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function makeTest(): Promise<IResults> {
        return callCoverLoss({
          asset: usdc,
          debtToInsuranceInc: "17",
          insuranceBalance: "199",
          lossToCover: "192",
          debtToInsurance: "1000"
        });
      }

      it("should send full amount of loss to vault", async () => {
        const ret = await loadFixture(makeTest);
        expect(ret.vaultBalance).eq(192);
      });
      it("should send full amount of loss from insurance", async () => {
        const ret = await loadFixture(makeTest);
        expect(ret.insuranceBalance).eq(199 - 192);
      });
      it("should report zero uncovered amount", async () => {
        const ret = await loadFixture(makeTest);
        console.log(ret);
        expect(ret.uncoveredLoss?.emittedLossUncovered === 0).eq(true);
      });
      it("should set expected debtToInsurance", async () => {
        const ret = await loadFixture(makeTest);
        expect(ret.debtToInsurance).eq(1000 + 17);
      });
    });

    describe("Loss is covered partially", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function makeTest(): Promise<IResults> {
        return callCoverLoss({
          asset: usdc,
          debtToInsuranceInc: "-5",
          insuranceBalance: "199",
          lossToCover: "207",
          debtToInsurance: "-1000"
        });
      }

      it("should send partial amount of loss to vault", async () => {
        const ret = await loadFixture(makeTest);
        expect(ret.vaultBalance).eq(199);
      });
      it("should cover the loss from insurance", async () => {
        const ret = await loadFixture(makeTest);
        expect(ret.insuranceBalance).eq(0);
      });
      it("should emit NotEnoughInsurance with expected uncovered loss amount", async () => {
        const ret = await loadFixture(makeTest);
        expect(ret.uncoveredLoss?.emittedLossUncovered).eq(207 - 199);
      });
      it("should set expected debtToInsurance", async () => {
        const ret = await loadFixture(makeTest);
        expect(ret.debtToInsurance).approximately(-1000 - 5 * 199/207, 1e-5);
      });
    });
  });

  describe("sendProfitGetAssetBalance", () => {
    interface ISendProfitGetAssetBalanceParams {
      theAsset: MockToken;
      balanceTheAsset: string;
      investedAssets: string;
      earnedByPrices: string;

      underlying?: {
        balance: string;
        token: MockToken;
      }
    }
    interface ISendProfitGetAssetBalanceResults {
      insuranceBalance: number;
      balanceTheAsset: number;
      balanceUnderlying: number;
      balanceTheAssetOut: number;
    }
    async function callSendProfitGetAssetBalance(p: ISendProfitGetAssetBalanceParams): Promise<ISendProfitGetAssetBalanceResults> {
      const decimalsTheAsset = await p.theAsset.decimals();
      const underlyingToken = p.underlying ? p.underlying.token : p.theAsset;
      const decimalsUnderlying = await underlyingToken.decimals();
      await p.theAsset.mint(facade.address, parseUnits(p.balanceTheAsset, decimalsTheAsset));

      if (p.underlying) {
        await p.underlying.token.mint(facade.address, parseUnits(p.underlying.balance, decimalsUnderlying));
      }

      const splitter = await MockHelper.createMockSplitter(signer);
      const vault = await MockHelper.createMockVault(signer);
      await splitter.setAsset(underlyingToken.address);
      await splitter.setVault(vault.address);
      const insurance = ethers.Wallet.createRandom().address;

      await vault.setInsurance(insurance);

      await facade.setBaseState(
        underlyingToken.address,
        splitter.address,
        ethers.Wallet.createRandom().address,
        0,
        0,
        0,
        "strategy name",
      );

      const ret = await facade.callStatic.sendProfitGetAssetBalance(
        p.theAsset.address,
        parseUnits(p.balanceTheAsset, decimalsTheAsset),
        parseUnits(p.investedAssets, decimalsUnderlying),
        parseUnits(p.earnedByPrices, decimalsUnderlying)
      );
      await facade.sendProfitGetAssetBalance(
        p.theAsset.address,
        parseUnits(p.balanceTheAsset, decimalsTheAsset),
        parseUnits(p.investedAssets, decimalsUnderlying),
        parseUnits(p.earnedByPrices, decimalsUnderlying)
      );

      return {
        insuranceBalance: +formatUnits(await underlyingToken.balanceOf(insurance), decimalsUnderlying),
        balanceTheAsset: +formatUnits(await p.theAsset.balanceOf(facade.address), decimalsTheAsset),
        balanceUnderlying: +formatUnits(await underlyingToken.balanceOf(facade.address), decimalsUnderlying),
        balanceTheAssetOut: +formatUnits(ret, decimalsTheAsset)
      }
    }
    describe("The asset is underlying", () => {
      describe("earnedByPrices is 0", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function sendProfitGetAssetBalanceTest(): Promise<ISendProfitGetAssetBalanceResults> {
          return callSendProfitGetAssetBalance({
            theAsset: usdc,
            balanceTheAsset: "1",
            earnedByPrices: "0",
            investedAssets: "100"
          });
        }

        it("should return unchanged balanceTheAsset", async () => {
          const ret = await loadFixture(sendProfitGetAssetBalanceTest);
          expect(ret.balanceTheAssetOut).eq(1);
        });
        it("should not change underlying balance", async () => {
          const ret = await loadFixture(sendProfitGetAssetBalanceTest);
          expect(ret.balanceTheAsset).eq(1);
          expect(ret.balanceUnderlying).eq(1);
        });
      })

      describe("earnedByPrices > 0", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function sendProfitGetAssetBalanceTest(): Promise<ISendProfitGetAssetBalanceResults> {
          return callSendProfitGetAssetBalance({
            theAsset: usdc,
            balanceTheAsset: "5",
            earnedByPrices: "2",
            investedAssets: "1000000"
          });
        }

        it("should return expected balanceTheAssetOut", async () => {
          const ret = await loadFixture(sendProfitGetAssetBalanceTest);
          expect(ret.balanceTheAssetOut).eq(3);
        });
        it("should send expected amount to insurance", async () => {
          const ret = await loadFixture(sendProfitGetAssetBalanceTest);
          expect(ret.insuranceBalance).eq(2);
        });
        it("should return expected underlying balance", async () => {
          const ret = await loadFixture(sendProfitGetAssetBalanceTest);
          expect(ret.balanceTheAsset).eq(3);
          expect(ret.balanceUnderlying).eq(3);
        });
      })
    });
    describe("The asset is NOT underlying", () => {
      describe("earnedByPrices > 0", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function sendProfitGetAssetBalanceTest(): Promise<ISendProfitGetAssetBalanceResults> {
          return callSendProfitGetAssetBalance({
            theAsset: weth,
            underlying: {
              token: usdc,
              balance: "59",
            },
            balanceTheAsset: "5",
            earnedByPrices: "2",
            investedAssets: "1000000"
          });
        }

        it("should return expected balanceTheAssetOut", async () => {
          const ret = await loadFixture(sendProfitGetAssetBalanceTest);
          expect(ret.balanceTheAssetOut).eq(5);
        });
        it("should send expected amount to insurance", async () => {
          const ret = await loadFixture(sendProfitGetAssetBalanceTest);
          expect(ret.insuranceBalance).eq(2);
        });
        it("should return expected balances", async () => {
          const ret = await loadFixture(sendProfitGetAssetBalanceTest);
          expect(ret.balanceTheAsset).eq(5);
          expect(ret.balanceUnderlying).eq(57);
        });
      })
    });
  });

  describe('getExpectedWithdrawnAmounts', () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    describe('Good paths', () => {
      describe('Two assets', () => {
        describe('The asset is first in _depositorPoolAssets, USDC, DAI', async () => {
          it('should return expected values, USDC is main', async () => {
            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits('200000', 6), // usdc
                parseUnits('100000', 18), // dai
              ],
              parseUnits('1000', 33), // decimals of the values don't matter here
              parseUnits('50000', 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
            const sexpected = [
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
            ].join('\n');

            expect(sret).eq(sexpected);
          });
          it('should return expected values, DAI is main', async () => {
            // DAI, USDC
            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits('100000', 18), // dai
                parseUnits('200000', 6), // usdc
              ],
              parseUnits('1000', 33), // decimals of the values don't matter here
              parseUnits('50000', 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
            const sexpected = [
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
            ].join('\n');

            expect(sret).eq(sexpected);
          });
        });
        describe('The asset is second in _depositorPoolAssets', async () => {
          it('should return expected values for USDC', async () => {
            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits('100000', 18), // dai
                parseUnits('200000', 6), // usdc
              ],
              parseUnits('1000', 33), // decimals of the values don't matter here
              parseUnits('50000', 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
            const sexpected = [
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
            ].join('\n');

            expect(sret).eq(sexpected);
          });
          it('should return expected values for DAI', async () => {
            const priceOracle = (await DeployerUtils.deployContract(
              signer,
              'PriceOracleMock',
              [usdc.address, dai.address],
              [parseUnits('4', 18), parseUnits('2', 18)],
            )) as PriceOracleMock;

            const ret = await facade.getExpectedWithdrawnAmounts(
              [
                parseUnits('200000', 6), // usdc
                parseUnits('100000', 18), // dai
              ],
              parseUnits('1000', 33), // decimals of the values don't matter here
              parseUnits('50000', 33), // only values ratio is important
            );

            const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
            const sexpected = [
              parseUnits((200_000 * 1000 / 50_000).toString(), 6),
              parseUnits((100_000 * 1000 / 50_000).toString(), 18),
            ].join('\n');

            expect(sret).eq(sexpected);
          });
        });
      });
      describe('Three assets', () => {
        it('should return expected values', async () => {
          const ret = await facade.getExpectedWithdrawnAmounts(
            [
              parseUnits('200000', 6), // usdc
              parseUnits('100000', 18), // dai
              parseUnits('800000', 18), // weth
            ],
            parseUnits('1000', 33), // decimals of the values don't matter here
            parseUnits('50000', 33), // only values ratio is important
          );

          const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
          const sexpected = [
            parseUnits((200_000 * 1000 / 50_000).toString(), 6),
            parseUnits((100_000 * 1000 / 50_000).toString(), 18),
            parseUnits((800_000 * 1000 / 50_000).toString(), 18),
          ].join('\n');

          expect(sret).eq(sexpected);
        });
      });
    });
    describe('Bad paths', () => {
      it('should return zero values if total supply is zero', async () => {
        const ret = await facade.getExpectedWithdrawnAmounts(
          [
            parseUnits('200000', 6), // usdc
            parseUnits('100000', 18), // dai
          ],
          parseUnits('1000', 33), // decimals of the values don't matter here
          parseUnits('0', 33), // (!) total supply is zero
        );
        const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
        const sexpected = [
          parseUnits('0', 6),
          parseUnits('0', 18),
        ].join('\n');

        expect(sret).eq(sexpected);
      });

      it('should use ratio 1 if liquidityAmount > totalSupply', async () => {
        const ret = await facade.getExpectedWithdrawnAmounts(
          [
            parseUnits('200000', 6),
            parseUnits('100000', 18),
          ],
          parseUnits('5000', 33), // (!) liquidity is greater than total supply
          parseUnits('1000', 33), // (!) total supply
        );

        const sret = ret.map(x => BalanceUtils.toString(x)).join('\n');
        const sexpected = [
          parseUnits((200_000).toString(), 6), // ratio == 1
          parseUnits((100_000).toString(), 18), // ratio == 1
        ].join('\n');

        expect(sret).eq(sexpected);
      });
    });
    describe('Gas estimation @skip-on-coverage', () => {
      it('should not exceed gas limits @skip-on-coverage', async () => {
        const gasUsed = await facade.estimateGas.getExpectedWithdrawnAmounts(
          [
            parseUnits('200000', 6),
            parseUnits('100000', 18),
            parseUnits('800000', 18),
          ],
          parseUnits('1000', 33), // decimals of the values don't matter here
          parseUnits('50000', 33), // only values ratio is important
        );
        controlGasLimitsEx(gasUsed, GET_EXPECTED_WITHDRAW_AMOUNT_ASSETS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe('getAvailableBalances', () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    describe('Good paths', () => {
      it('should return expected values', async () => {
        const assets = [dai, tetu, usdc, usdt];
        const balances: BigNumber[] = [];
        for (let i = 0; i < assets.length; ++i) {
          balances.push(parseUnits((i + 1).toString(), await assets[i].decimals()));
          await assets[i].mint(facade.address, balances[i]);
        }

        const r: BigNumber[] = await facade.getAvailableBalances(assets.map(x => x.address), 2);
        const ret = r.map(x => BalanceUtils.toString(x)).join();
        const expected = [
          parseUnits('1', await dai.decimals()),
          parseUnits('2', await tetu.decimals()),
          0, // balance is not calculated for the main asset
          parseUnits('4', await usdt.decimals()),
        ].map(x => BalanceUtils.toString(x)).join();

        expect(ret).eq(expected);
      });
    });
  });

  describe('calcInvestedAssets', () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface IParams {
      tokens: MockToken[];
      amountsOut?: string[];
      indexAsset: number;
      balances?: string[];
      prices: string[];
      debts?: {
        borrowAsset: MockToken;
        debtAmount: string;
        collateralAmount: string;
        /** We need it for reverse debts. By default, it's equal to the underlying */
        collateralAsset?: MockToken;
      }[];
      makeCheckout?: boolean; // false by default
      deltaGains?: string[];
      deltaLosses?: string[];
    }

    interface IResults {
      amountOut: number;
      gasUsed: BigNumber;
      prices: number[];
      expectedDecs: boolean[];
      tokensPassedToCheckout: string[];
    }

    async function makeCalcInvestedAssetsTest(p: IParams): Promise<IResults> {
      const decimals = await Promise.all(
        p.tokens.map(
          async x => x.decimals(),
        ),
      );
      if (p.balances) {
        for (let i = 0; i < p.tokens.length; ++i) {
          await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], decimals[i]));
        }
      }
      const tc = await MockHelper.createMockTetuConverter(signer);
      if (p.debts) {
        for (const item of p.debts) {
          const collateralAsset = (item.collateralAsset ?? p.tokens[p.indexAsset]);
          await tc.setGetDebtAmountCurrent(
            facade.address,
            collateralAsset.address,
            item.borrowAsset.address,
            parseUnits(item.debtAmount, await item.borrowAsset.decimals()),
            parseUnits(item.collateralAmount, await collateralAsset.decimals()),
            false,
            false
          );
        }
      }
      const priceOracle = await MockHelper.createPriceOracle(
        signer,
        p.tokens.map(x => x.address),
        p.prices.map(x => parseUnits(x, 18)),
      );
      const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await tc.setController(controller.address);
      await controller.setBookkeeper(mockBookkeeper.address);
      if (p.deltaGains && p.deltaLosses) {
        await mockBookkeeper.setCheckpoint(
          p.deltaGains.map((x, index) => parseUnits(x, decimals[index])),
          p.deltaLosses.map((x, index) => parseUnits(x, decimals[index])),
        )
      }

      const ret = await facade.callStatic.calcInvestedAssets(
        p.tokens.map(x => x.address),
        p.amountsOut
          ? p.amountsOut.map((x, index) => parseUnits(x, decimals[index]))
          : p.tokens.map(x => BigNumber.from(0)),
        p.indexAsset,
        tc.address,
        p?.makeCheckout ?? false
      );

      const tx = await facade.calcInvestedAssets(
        p.tokens.map(x => x.address),
        p.amountsOut || p.tokens.map(x => BigNumber.from(0)),
        p.indexAsset,
        tc.address,
        p?.makeCheckout ?? false
      );
      const gasUsed = (await tx.wait()).gasUsed;

      return {
        amountOut: +formatUnits(ret.amountOut, decimals[p.indexAsset]),
        prices: ret.prices.map(x=> +formatUnits(x, 18)),
        expectedDecs: ret.decs.map((x, index) => x.eq(parseUnits("1", decimals[index]))),
        gasUsed,
        tokensPassedToCheckout: await mockBookkeeper.getCheckpointResults()
      };
    }

    describe('Good paths', () => {
      describe("makeCheckpoint_ is false", () => {
        describe('All amounts are located on the strategy balance only (liquidity is zero)', () => {
          describe('No debts', () => {
            it('should return expected values', async () => {
              const ret = await makeCalcInvestedAssetsTest({
                tokens: [dai, usdc, usdt],
                indexAsset: 1,
                balances: ['100', '1987', '300'],
                prices: ['20', '10', '60'],
              });
              const expected = 100 * 20 / 10 + 300 * 60 / 10;

              expect(ret.amountOut).eq(expected);
              expect(ret.prices.join()).eq([20, 10, 60].join());
              expect(ret.expectedDecs.join()).eq([true, true, true].join());
              expect(ret.tokensPassedToCheckout.length).eq(0);
            });
          });
          describe("Direct debts only", () => {
            describe('There is a debt', () => {
              describe('Amount to repay == amount of the debt', () => {
                it('should return expected values', async () => {
                  const ret = (await makeCalcInvestedAssetsTest({
                    tokens: [dai, usdc, usdt],
                    indexAsset: 1,
                    balances: ['117', '1987', '300'],
                    prices: ['20', '10', '60'],
                    debts: [
                      {
                        debtAmount: '117',
                        collateralAmount: '1500',
                        borrowAsset: dai,
                      },
                    ],
                  })).amountOut;
                  const expected = 1500 + 300 * 60 / 10;

                  expect(ret).eq(expected);
                });
              });
              describe('Amount to repay > amount of the debt', () => {
                it('should return expected values', async () => {
                  const ret = (await makeCalcInvestedAssetsTest({
                    tokens: [dai, usdc, usdt],
                    indexAsset: 1,
                    balances: ['117', '1987', '300'],
                    prices: ['20', '10', '60'],
                    debts: [
                      {
                        debtAmount: '17',
                        collateralAmount: '500',
                        borrowAsset: dai,
                      },
                    ],
                  })).amountOut;
                  const expected = 500 + (117 - 17) * 20 / 10 + 300 * 60 / 10;

                  expect(ret).eq(expected);
                });
              });
              describe('Amount to repay < amount of the debt, the repayment is profitable', () => {
                it('should return expected values', async () => {
                  const ret = (await makeCalcInvestedAssetsTest({
                    tokens: [dai, usdc, usdt],
                    indexAsset: 1,
                    balances: ['117', '1987', '300'],
                    prices: ['20', '10', '60'],
                    debts: [
                      {
                        debtAmount: '217',
                        collateralAmount: '500',
                        borrowAsset: dai,
                      },
                    ],
                  })).amountOut;
                  const availableMainAsset = 300 * 60 / 10;
                  const amountToPayTheDebt = (217 - 117) * 20 / 10;
                  const expected = availableMainAsset + 500 - amountToPayTheDebt;

                  expect(ret).eq(expected);
                });
              });
              describe('Amount to repay < amount of the debt, the repayment is NOT profitable', () => {
                it('should return expected values', async () => {
                  const ret = (await makeCalcInvestedAssetsTest({
                    tokens: [dai, usdc, usdt],
                    indexAsset: 1,
                    balances: ['117', '1987', '300'],
                    prices: ['20', '10', '60'],
                    debts: [
                      {
                        debtAmount: '5117',
                        collateralAmount: '500',
                        borrowAsset: dai,
                      },
                    ],
                  })).amountOut;
                  const availableMainAsset = 300 * 60 / 10;
                  const amountToPayTheDebt = (5117 - 117) * 20 / 10;
                  const expected = 0; // amountToPayTheDebt > availableMainAsset + 500 (collateral)

                  expect(ret).eq(expected);
                });
              });
            });
            describe('There are two debts', () => {
              /**
               * Fix coverage for calcInvestedAssets:
               * else part for "if (v.debts.length == 0)"
               */
              describe('Amount to repay < total amount of the debts', () => {
                it('should return expected values', async () => {
                  const ret = (await makeCalcInvestedAssetsTest({
                    tokens: [dai, usdc, usdt],
                    indexAsset: 1,
                    balances: ['116', '1987', '299'],
                    prices: ['20', '10', '60'],
                    debts: [{
                      debtAmount: '117',
                      collateralAmount: '500',
                      borrowAsset: dai,
                    }, {
                      debtAmount: '300',
                      collateralAmount: '700',
                      borrowAsset: usdt,
                    }],
                  })).amountOut;
                  const expected = 495 + 697; // 116*500/117 = 495, 299*700/300 = 697

                  expect(ret).eq(expected);
                });
              });
            });
          });
          describe("Reverse debts only", () => {
            describe('Single reverse debt', () => {
              it('should return expected values', async () => {
                const ret = (await makeCalcInvestedAssetsTest({
                  tokens: [dai, usdc, usdt],
                  indexAsset: 1,
                  balances: ['200', '1987', '300'],
                  prices: ['20', '10', '60'],
                  debts: [
                    {
                      debtAmount: '800',
                      collateralAmount: '1100',
                      borrowAsset: usdc,
                      collateralAsset: dai
                    },
                  ],
                })).amountOut;

                expect(ret).eq((1100 + 200) * 20 / 10 + 300 * 60 / 10 - 800);
              });
            });
            describe('Two reverse debts', () => {
              it('should return expected values', async () => {
                const ret = (await makeCalcInvestedAssetsTest({
                  tokens: [dai, usdc, usdt],
                  indexAsset: 1,
                  balances: ['116', '1987', '299'],
                  prices: ['20', '10', '60'],
                  debts: [{
                    debtAmount: '117',
                    collateralAmount: '500',
                    borrowAsset: usdc,
                    collateralAsset: dai,
                  }, {
                    debtAmount: '300',
                    collateralAmount: '700',
                    borrowAsset: usdc,
                    collateralAsset: usdt
                  }],
                })).amountOut;

                expect(ret).eq((500 + 116) * 20 / 10 + (299 + 700) * 60 / 10 - 300 - 117);
              });
            });
            describe('There are reverse and direct debts at the same time (incorrect situation that should be avoided)', () => {
              it('should return expected values', async () => {
                const ret = (await makeCalcInvestedAssetsTest({
                  tokens: [dai, usdc, usdt],
                  indexAsset: 1,
                  balances: ['116', '1987', '299'],
                  prices: ['20', '10', '60'],
                  debts: [{ // reverse debt
                    debtAmount: '117',
                    collateralAmount: '500',
                    borrowAsset: usdc,
                    collateralAsset: dai,
                  }, { // direct debt
                    debtAmount: '600',
                    collateralAmount: '990',
                    borrowAsset: dai,
                  }],
                })).amountOut;

                expect(ret).eq((500 + 116 - 600) * 20 / 10 + 299 * 60 / 10 - 117 + 990);
              });
            });
          });
        });
        describe('All amounts are deposited to the pool', () => {
          it('should return expected values', async () => {
            const ret = (await makeCalcInvestedAssetsTest({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              amountsOut: ['100', '200', '300'],
              balances: ['0', '0', '0'],
              prices: ['20', '10', '60'],
            })).amountOut;
            const expected = 200 + 100 * 20 / 10 + 300 * 60 / 10;

            expect(ret).eq(expected);
          });
        });
        describe('Amount to repay < amount available in the pool+balance', () => {
          it('should return expected values', async () => {
            const ret = (await makeCalcInvestedAssetsTest({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              balances: ['100', '1987', '300'],
              amountsOut: ['700', '1000', '400'],
              prices: ['20', '10', '60'],
              debts: [
                {
                  debtAmount: '200',
                  collateralAmount: '1501',
                  borrowAsset: dai,
                },
              ],
            })).amountOut;
            const amountToPayTheDebt = 200 * 20 / 10;
            const availableMainAsset = 1000 + (300 + 400) * 60 / 10 + (700 + 100) * 20 / 10;
            const expected = availableMainAsset + 1501 - amountToPayTheDebt;

            expect(ret).eq(expected);
          });
        });
        describe('Amount to repay >= amount available in the pool+balance', () => {
          it('should return expected values', async () => {
            const ret = (await makeCalcInvestedAssetsTest({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              balances: ['100', '1987', '300'],
              amountsOut: ['700', '1000', '400'],
              prices: ['20', '10', '60'],
              debts: [
                {
                  debtAmount: '900',
                  collateralAmount: '1501',
                  borrowAsset: dai,
                },
              ],
            })).amountOut;
            const amountToPayTheDebt = 900 * 20 / 10;
            const availableMainAsset = 1000 + (300 + 400) * 60 / 10 + (700 + 100) * 20 / 10;
            const expected = availableMainAsset + 1501 - amountToPayTheDebt;

            expect(ret).eq(expected);
          });
        });
      });
      describe("makeCheckpoint_ is true", () => {
        it('should call checkpoint with expected tokens', async () => {
          const ret = await makeCalcInvestedAssetsTest({
            tokens: [dai, usdc, usdt],
            indexAsset: 1,
            balances: ['100', '1987', '300'],
            prices: ['20', '10', '60'],
            makeCheckout: true
          });
          const expected = 100 * 20 / 10 + 300 * 60 / 10;

          expect(ret.tokensPassedToCheckout.join()).eq([dai, usdc, usdt].map(x => x.address).join());
        });
      });
    });
    describe('Gas estimation @skip-on-coverage', () => {
      it('should not exceed gas limits, no debts', async () => {
        const r = await makeCalcInvestedAssetsTest({
          tokens: [dai, usdc, usdt],
          indexAsset: 1,
          balances: ['100', '1987', '300'],
          prices: ['20', '10', '60'],
        });

        controlGasLimitsEx(r.gasUsed, GAS_CALC_INVESTED_ASSETS_NO_DEBTS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
      it('should not exceed gas limits, debt exists', async () => {
        const r = await makeCalcInvestedAssetsTest({
          tokens: [dai, usdc, usdt],
          indexAsset: 1,
          balances: ['100', '1987', '300'],
          amountsOut: ['700', '1000', '400'],
          prices: ['20', '10', '60'],
          debts: [
            {
              debtAmount: '200',
              collateralAmount: '1501',
              borrowAsset: dai,
            },
          ],
        });
        controlGasLimitsEx(r.gasUsed, GAS_CALC_INVESTED_ASSETS_SINGLE_DEBT, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe("findZeroAmount", () => {
    interface IFindZeroAmountParams {
      tokens: MockToken[];
      amounts: string[];
      thresholds?: string[];
    }

    interface IFindZeroAmountResults {
      found: boolean;
    }

    async function callFindZeroAmount(p: IFindZeroAmountParams): Promise<IFindZeroAmountResults> {
      if (p.thresholds) {
        for (let i = 0; i < p.tokens.length; ++i) {
          await facade.setLiquidationThreshold(
            p.tokens[i].address,
            parseUnits(p.thresholds[i], await p.tokens[i].decimals())
          )
        }
      }

      const found = await facade.findZeroAmount(
        await Promise.all(p.amounts.map(
          async (amount, index) => parseUnits(amount, await p.tokens[index].decimals())
        )),
      );

      return {found};
    }

    it("should found zero amount on first position", async () => {
      const {found} = await callFindZeroAmount({
        tokens: [usdc, usdt, weth],
        amounts: ["0", "1", "0"],
      });
      expect(found).eq(true);
    });
    it("should found zero amount on last position", async () => {
      const {found} = await callFindZeroAmount({
        tokens: [usdc, usdt, weth],
        amounts: ["7", "1", "0"],
      });
      expect(found).eq(true);
    });
    it("should not found zero amount", async () => {
      const {found} = await callFindZeroAmount({
        tokens: [usdc, usdt, weth],
        amounts: ["1", "2", "3"],
      });
      expect(found).eq(false);
    });
  });

  describe("_getIncreaseToDebt", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface IParams {
      tokens: MockToken[];
      indexAsset: number;
      prices: string[];

      deltaGains: string[];
      deltaLosses: string[];
    }

    interface IResults {
      increaseToDebt: number;
    }

    async function getIncreaseToDebt(p: IParams): Promise<IResults> {
      // set up TetuConverter with prices
      const converter = await MockHelper.createMockTetuConverter(signer);
      const priceOracle = await MockHelper.createPriceOracle(
        signer,
        p.tokens.map(x => x.address),
        p.tokens.map(x => parseUnits("1", 18)),
      );
      const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await converter.setController(controller.address);
      await controller.setBookkeeper(mockBookkeeper.address);

      const decimals = await Promise.all(
        p.tokens.map(
          async x => x.decimals(),
        ),
      );

      await mockBookkeeper.setCheckpoint(
        p.deltaGains.map((x, index) => parseUnits(x, decimals[index])),
        p.deltaLosses.map((x, index) => parseUnits(x, decimals[index])),
      );

      const ret = await facade.callStatic._getIncreaseToDebt(
        p.tokens.map(x => x.address),
        p.indexAsset,
        p.prices.map(x => parseUnits(x, 18)),
        decimals.map(x => parseUnits("1", x)),
        converter.address
      );
      await facade._getIncreaseToDebt(
        p.tokens.map(x => x.address),
        p.indexAsset,
        p.prices.map(x => parseUnits(x, 18)),
        decimals.map(x => parseUnits("1", x)),
        converter.address
      );

      return {
        increaseToDebt: +formatUnits(ret, decimals[p.indexAsset])
      }
    }

    describe("Equal prices", () => {
      describe("Not zero losses and gains", () => {
        it("should return expected amount", async () => {
          const {increaseToDebt} = await getIncreaseToDebt({
            tokens: [usdc, usdt, dai],
            indexAsset: 0,
            prices: ["1", "1", "1"],
            deltaGains: ["1", "2", "3"],
            deltaLosses: ["1300", "1100", "700"]
          });

          expect(increaseToDebt).eq(1300 + 1100 + 700 - 1 - 2 - 3);
        });
      });

      describe("Some losses and gains are zero", () => {
        it("should return expected amount", async () => {
          const {increaseToDebt} = await getIncreaseToDebt({
            tokens: [usdc, usdt, dai],
            indexAsset: 0,
            prices: ["1", "1", "1"],
            deltaGains: ["0", "1500", "0"],
            deltaLosses: ["1300", "0", "0"]
          });

          expect(increaseToDebt).eq(1300 - 1500);
        });
      });
    });
    describe("Not equal prices", () => {
      describe("Not zero losses and gains", () => {
        it("should return expected amount", async () => {
          const {increaseToDebt} = await getIncreaseToDebt({
            tokens: [usdc, usdt, dai],
            indexAsset: 1,
            prices: ["0.5", "2", "1"],
            deltaGains: ["1", "2", "3"],
            deltaLosses: ["1300", "1100", "700"]
          });

          expect(increaseToDebt).eq(1300 * 0.5 / 2 + 1100 + 700 * 1 / 2 - 1 * 0.5 / 2 - 2 - 3 * 1 / 2);
        });
      });

      describe("Some losses and gains are zero", () => {
        it("should return expected amount", async () => {
          const {increaseToDebt} = await getIncreaseToDebt({
            tokens: [usdc, usdt, dai],
            indexAsset: 2,
            prices: ["0.5", "2", "1"],
            deltaGains: ["0", "1500", "0"],
            deltaLosses: ["1300", "0", "0"]
          });

          expect(increaseToDebt).eq(1300 * 0.5 / 1 - 1500 * 2 / 1);
        });
      });
    });
  });

  describe("fixPriceChanges", () => {
    interface IParams {
      debtToInsurance?: string;
      investedAssetsBefore: string;

      tokens: MockToken[];
      indexAsset: number;
      amountsPool: string[];

      balances?: string[];
      prices: string[];
      debts?: {
        borrowAsset: MockToken;
        debtAmount: string;
        collateralAmount: string;
        /** We need it for reverse debts. By default, it's equal to the underlying */
        collateralAsset?: MockToken;
      }[];
      deltaGains?: string[];
      deltaLosses?: string[];

      insuranceBalance?: string;
    }

    interface IResults {
      earned: number;
      investedAssetsOut: number;
      debtToInsurance: number;
      insuranceBalance: number;
      vaultBalance: number;
    }

    async function fixPriceChanges(p: IParams): Promise<IResults> {
      const decimals = await Promise.all(
        p.tokens.map(
          async x => x.decimals(),
        ),
      );

      if (p.balances) {
        for (let i = 0; i < p.tokens.length; ++i) {
          await p.tokens[i].mint(facade.address, parseUnits(p.balances[i], decimals[i]));
        }
      }
      const asset = p.tokens[p.indexAsset];

      // Set up Tetu Converter
      const converter = await MockHelper.createMockTetuConverter(signer);
      if (p.debts) {
        for (const item of p.debts) {
          const collateralAsset = (item.collateralAsset ?? p.tokens[p.indexAsset]);
          await converter.setGetDebtAmountCurrent(
            facade.address,
            collateralAsset.address,
            item.borrowAsset.address,
            parseUnits(item.debtAmount, await item.borrowAsset.decimals()),
            parseUnits(item.collateralAmount, await collateralAsset.decimals()),
            false,
            false
          );
        }
      }
      const priceOracle = await MockHelper.createPriceOracle(
        signer,
        p.tokens.map(x => x.address),
        p.prices.map(x => parseUnits(x, 18)),
      );
      const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await converter.setController(controller.address);
      await controller.setBookkeeper(mockBookkeeper.address);

      if (p.deltaGains && p.deltaLosses) {
        await mockBookkeeper.setCheckpoint(
          p.deltaGains.map((x, index) => parseUnits(x, decimals[index])),
          p.deltaLosses.map((x, index) => parseUnits(x, decimals[index])),
        )
      }

      // prepare splitter and vault
      const insurance = ethers.Wallet.createRandom().address;
      await asset.mint(insurance, parseUnits(p.insuranceBalance ?? "0", await asset.decimals()));

      const vault = await MockHelper.createMockVault(signer);
      await vault.setInsurance(insurance);

      const splitter = await MockHelper.createMockSplitter(signer);
      await splitter.setAsset(asset.address);
      await splitter.setVault(vault.address);
      await asset.connect(await Misc.impersonate(insurance)).approve(
        splitter.address,
        parseUnits(p.insuranceBalance ?? "0", await asset.decimals())
      );
      await splitter.setCoverFromInsurance(true);
      await splitter.setInsurance(insurance);

      const assetDecimals = await asset.decimals();
      await facade.setCsbs(
        parseUnits(p.investedAssetsBefore, assetDecimals),
        converter.address,
        1,
        parseUnits(p.debtToInsurance ?? "0", assetDecimals)
    );
      await facade.setBaseState(
        asset.address,
        splitter.address,
        ethers.Wallet.createRandom().address,
        0,
        0,
        0,
        "strategy name",
      );

      const ret = await facade.callStatic.fixPriceChanges(
        p.amountsPool.map((x, index) => parseUnits(x, decimals[index])),
        p.tokens.map(x => x.address),
        p.indexAsset
      );

      await facade.fixPriceChanges(
        p.amountsPool.map((x, index) => parseUnits(x, decimals[index])),
        p.tokens.map(x => x.address),
        p.indexAsset
      );

      const csb = await facade.getCsb();
      return {
        earned: +formatUnits(ret.earnedOut, assetDecimals),
        insuranceBalance: +formatUnits(await asset.balanceOf(insurance), assetDecimals),
        vaultBalance: +formatUnits(await asset.balanceOf(vault.address), assetDecimals),
        debtToInsurance: +formatUnits(csb.debtToInsurance, assetDecimals),
        investedAssetsOut: +formatUnits(csb.investedAssets, assetDecimals),
      }
    }

    describe("investedAssets is reduced", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function fixPriceChangesTest(): Promise<IResults> {
        return fixPriceChanges({
          tokens: [tetu, usdc],
          indexAsset: 1,
          amountsPool: ["10000", "20000"],
          debtToInsurance: "123",
          investedAssetsBefore: "36000", // -500
          prices: ["1", "1"],
          deltaGains: ["1", "2"],
          deltaLosses: ["101", "102"],
          insuranceBalance: "10000",
          balances: ["5000", "7000000"],
          debts: [{
            collateralAsset: usdc,
            borrowAsset: tetu,
            collateralAmount: "1000",
            debtAmount: "500"
          }]
        });
      }

      it("should return expected earned value", async () => {
        const ret = await loadFixture(fixPriceChangesTest);
        expect(ret.earned).eq(0);
      });
      it("should return expected investedAssets", async () => {
        const ret = await loadFixture(fixPriceChangesTest);
        expect(ret.investedAssetsOut).eq(10_000 + 20_000 + 5000 + (1000 - 500)); // 35500
      });
      it("should cover expected amount of losses", async () => {
        const ret = await loadFixture(fixPriceChangesTest);
        expect(ret.vaultBalance).eq(36_000 - 35_500); // 500
      });
      it("should increase debt to insurance on expected amount", async () => {
        const ret = await loadFixture(fixPriceChangesTest);
        expect(ret.debtToInsurance).eq(123 + 101 + 102 - 1 - 2);
      });
      it("should reduce insurance balance on expected value", async () => {
        const ret = await loadFixture(fixPriceChangesTest);
        expect(ret.insuranceBalance).eq(10_000 - (36_000 - 35_500)); // 500
      });
    });
    describe("investedAssets is increased", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function fixPriceChangesTest(): Promise<IResults> {
        return fixPriceChanges({
          tokens: [tetu, usdc],
          indexAsset: 1,
          amountsPool: ["10000", "20000"],
          debtToInsurance: "123",
          investedAssetsBefore: "35000", // +500
          prices: ["1", "1"],
          deltaGains: ["1", "2"],
          deltaLosses: ["101", "102"],
          insuranceBalance: "10000",
          balances: ["5000", "7000000"],
          debts: [{
            collateralAsset: usdc,
            borrowAsset: tetu,
            collateralAmount: "1000",
            debtAmount: "500"
          }]
        });
      }

      it("should return expected earned value", async () => {
        const ret = await loadFixture(fixPriceChangesTest);
        expect(ret.earned).eq(35_500 - 35_000);
      });
      it("should return expected investedAssets", async () => {
        const ret = await loadFixture(fixPriceChangesTest);
        expect(ret.investedAssetsOut).eq(10_000 + 20_000 + 5000 + (1000 - 500)); // 35500
      });
      it("should cover no losses", async () => {
        const ret = await loadFixture(fixPriceChangesTest);
        expect(ret.vaultBalance).eq(0);
      });
      it("should increase debt to insurance on expected amount", async () => {
        const ret = await loadFixture(fixPriceChangesTest);
        expect(ret.debtToInsurance).eq(123 + 101 + 102 - 1 - 2);
      });
      it("should not change insurance balance", async () => {
        const ret = await loadFixture(fixPriceChangesTest);
        expect(ret.insuranceBalance).eq(10_000);
      });
    });
  });
  //endregion Unit tests
});
