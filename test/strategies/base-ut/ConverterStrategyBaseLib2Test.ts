import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers} from 'hardhat';
import {TimeUtils} from '../../../scripts/utils/TimeUtils';
import {DeployerUtils} from '../../../scripts/utils/DeployerUtils';
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import {
  ConverterStrategyBaseLibFacade2,
  MockToken,
  PriceOracleMock, StrategySplitterV2
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

/**
 * Test of ConverterStrategyBaseLib using ConverterStrategyBaseLibFacade
 * to direct access of the library functions.
 *
 * Following tests are created using fixtures, not snapshots
 */
describe('ConverterStrategyBaseLibTest', () => {
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
  //endregion Variables

  //region before, after
  before(async function () {
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
      targetAmount: string;
      investedAssets: string;
      depositorLiquidity: string;

      balances: string[];
      quoteRepays: IQuoteRepayParams[];
    }

    interface IGetLiquidityAmountResults {
      resultAmount: number;
      amountsToConvertOut: string[];
    }

    async function getLiquidityAmount(p: IGetLiquidityAmountParams): Promise<IGetLiquidityAmountResults> {
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
      const ret = await facade.callStatic.getLiquidityAmount(
        parseUnits(p.targetAmount, await p.tokens[p.indexAsset].decimals()),
        ethers.Wallet.createRandom().address,
        p.tokens.map(x => x.address),
        p.indexAsset,
        converter.address,
        parseUnits(p.investedAssets, await p.tokens[p.indexAsset].decimals()),
        parseUnits(p.depositorLiquidity, DECIMALS_LIQUIDITY),
      );

      return {
        amountsToConvertOut: await Promise.all(ret.amountsToConvertOut.map(
          async (x, index) => (+formatUnits(x, await p.tokens[index].decimals())).toString()
        )),
        resultAmount: +formatUnits(ret.resultAmount, DECIMALS_LIQUIDITY)
      }
    }

    describe('Good paths', () => {
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
              investedAssets: "500",
              depositorLiquidity: "7",
              balances: ["0", "0", "0"],
              quoteRepays: []
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(7 * 101 / 100 * 5 / 500);
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([0, 0, 0].join());
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
              investedAssets: "500",
              depositorLiquidity: "7",
              balances: ["17", "27", "37"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "17", collateralAmountOut: "7"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "27", collateralAmountOut: "14"},
              ]
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(0);
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([17, 0, 0].join());
          });
        });
        describe('amount of two assets is enough to get the required amount', () => {
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
              investedAssets: "500",
              depositorLiquidity: "7",
              balances: ["17", "27", "37"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "17", collateralAmountOut: "7"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "37", collateralAmountOut: "14"},
              ]
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(0);
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([17, 0, 37].join());
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
              investedAssets: "500",
              depositorLiquidity: "7",
              balances: ["17", "27", "37"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "17", collateralAmountOut: "7"}, // 2 + 7 < 19
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "37", collateralAmountOut: "2"},
              ]
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(7 * 101 / 100 * (19 - 9) / (500 - 9));
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([17, 0, 37].join());
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
              targetAmount: "0", // all
              investedAssets: "500",
              depositorLiquidity: "7777",
              balances: ["0", "0", "0"],
              quoteRepays: []
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(7777);
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([0, 0, 0].join());
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
              targetAmount: "0",
              investedAssets: "500",
              depositorLiquidity: "7777",
              balances: ["17", "27", "37"],
              quoteRepays: [
                {collateralAsset: usdc, borrowAsset: dai, amountRepay: "17", collateralAmountOut: "7"},
                {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "27", collateralAmountOut: "14"},
              ]
            })
          }

          it('should return expected resultAmount', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.resultAmount).eq(7777);
          });
          it('should return zero amounts to convert', async () => {
            const results = await loadFixture(getLiquidityAmountTest);
            expect(results.amountsToConvertOut.join()).eq([17, 0, 37].join());
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe('targetAmount > investedAmount, investedAmount == sum(collaterals)', () => {
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
            investedAssets: "21",
            depositorLiquidity: "777",
            balances: ["17", "27", "37"],
            quoteRepays: [
              {collateralAsset: usdc, borrowAsset: dai, amountRepay: "17", collateralAmountOut: "7"},
              {collateralAsset: usdc, borrowAsset: usdt, amountRepay: "37", collateralAmountOut: "14"},
            ]
          })
        }

        it('should return expected resultAmount', async () => {
          const results = await loadFixture(getLiquidityAmountTest);
          expect(results.resultAmount).eq(777);
        });
        it('should return zero amounts to convert', async () => {
          const results = await loadFixture(getLiquidityAmountTest);
          expect(results.amountsToConvertOut.join()).eq([17, 0, 37].join());
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
      const splitter = await DeployerUtils.deployContract(signer,"StrategySplitterV2") as StrategySplitterV2;
      const toleranceInStrategySplitterV2 = (await splitter.HARDWORK_LOSS_TOLERANCE()).toNumber();
      const toleranceInLib = (await facade.getHardworkLossToleranceValue()).toNumber();
      expect(toleranceInStrategySplitterV2).eq(toleranceInLib);
    });
  });

  describe("getSafeLossToCover", () => {
    it("should return original value", async () => {
      // 500 * 200_000 / 100_000 = 1000
      const ret = (await facade.getSafeLossToCover(1000, 200_000)).toNumber();
      expect(ret).eq(1000);
    });
    it("should return cut value", async () => {
      // 500 * 200_000 / 100_000 = 1000
      const ret = (await facade.getSafeLossToCover(1001, 200_000)).toNumber();
      expect(ret).eq(1000);
    });
  });

  describe("sendToInsurance", () =>{
    interface ISendToInsuranceParams {
      asset: MockToken;
      amount: string;
      totalAssets: string;
      insuranceBalance: string;
      strategyBalance: string;
    }
    interface ISendToInsuranceResults {
      amountToSend: number;
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

      const amountToSend = await facade.callStatic.sendToInsurance(
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
        amountToSend: +formatUnits(amountToSend, decimals),
        insuranceBalance: +formatUnits(await p.asset.balanceOf(insurance), decimals),
        strategyBalance: +formatUnits(await p.asset.balanceOf(facade.address), decimals),
      }
    }

    describe("Good paths", () => {
      describe("Amount <= current balance", () => {
        describe("Amount <= max allowed value", () => {
          let snapshot: string;
          before(async function() {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function() {
            await TimeUtils.rollback(snapshot);
          });

          async function callSendToInsuranceTest() : Promise<ISendToInsuranceResults> {
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
          })
          it("should reduce strategy balance on amount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.strategyBalance).eq(1000-999);
          })
          it("should return amount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.amountToSend).eq(999);
          })
        });
        describe("Amount > max allowed value", () => {
          let snapshot: string;
          before(async function() {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function() {
            await TimeUtils.rollback(snapshot);
          });

          async function callSendToInsuranceTest() : Promise<ISendToInsuranceResults> {
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
          })
          it("should reduce strategy balance on expected amount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.strategyBalance).eq(2000-1000);
          })
          it("should return amount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.amountToSend).eq(1000);
          })
        });
        describe("Current balance is zero", () => {
          let snapshot: string;
          before(async function() {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function() {
            await TimeUtils.rollback(snapshot);
          });

          async function callSendToInsuranceTest() : Promise<ISendToInsuranceResults> {
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
          })
          it("should not change strategy balance", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.strategyBalance).eq(0);
          })
          it("should return zero", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.amountToSend).eq(0);
          })
        });
      });
      describe("Amount > current balance", () => {
        describe("Amount <= max allowed value", () => {
          let snapshot: string;
          before(async function() {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function() {
            await TimeUtils.rollback(snapshot);
          });

          async function callSendToInsuranceTest() : Promise<ISendToInsuranceResults> {
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
          })
          it("should reduce strategy balance on amount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.strategyBalance).eq(0);
          })
          it("should return amount", async () => {
            const ret = await loadFixture(callSendToInsuranceTest);
            expect(ret.amountToSend).eq(100);
          })
        });
      });
    });
    describe("Bad paths", () => {
      let snapshot: string;
      beforeEach(async function() {
        snapshot = await TimeUtils.snapshot();
      });
      afterEach(async function() {
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
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
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
    it("should return zero tokenAmounts is zero and thresholds are not set", async () => {
      const ret = await callGetTokenAmountsPair({
        tokens: [usdc, usdt],
        balances: ["100", "0"],
        liquidationThresholds: ["0", "0"],
        totalAssets: "4"
      });
      expect(ret.tokenAmounts.length).eq(0);
    });
  });


  describe('getExpectedWithdrawnAmounts', () => {
    let snapshot: string;
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    describe('Good paths', () => {
      describe('Two assets', () => {
        describe('The asset is first in _depositorPoolAssets, USDC, DAI', async() => {
          it('should return expected values, USDC is main', async() => {
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
          it('should return expected values, DAI is main', async() => {
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
        describe('The asset is second in _depositorPoolAssets', async() => {
          it('should return expected values for USDC', async() => {
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
          it('should return expected values for DAI', async() => {
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
        it('should return expected values', async() => {
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
      it('should return zero values if total supply is zero', async() => {
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

      it('should use ratio 1 if liquidityAmount > totalSupply', async() => {
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
      it('should not exceed gas limits @skip-on-coverage', async() => {
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
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    describe('Good paths', () => {
      it('should return expected values', async() => {
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
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    interface ICalcInvestedAssetsParams {
      tokens: MockToken[];
      amountsOut?: string[];
      indexAsset: number;
      balances?: string[];
      prices: string[];
      debts?: {
        borrowAsset: MockToken;
        debtAmount: string;
        collateralAmount: string;
        /** We need if for reverse debts. Byt default it's equal to underlying */
        collateralAsset?: MockToken;
      }[];
    }

    interface ICalcInvestedAssetsResults {
      amountOut: number;
      gasUsed: BigNumber;
    }

    async function makeCalcInvestedAssetsTest(params: ICalcInvestedAssetsParams): Promise<ICalcInvestedAssetsResults> {
      const decimals = await Promise.all(
        params.tokens.map(
          async x => x.decimals(),
        ),
      );
      if (params.balances) {
        for (let i = 0; i < params.tokens.length; ++i) {
          await params.tokens[i].mint(facade.address, parseUnits(params.balances[i], decimals[i]));
        }
      }
      const tc = await MockHelper.createMockTetuConverter(signer);
      if (params.debts) {
        for (const item of params.debts) {
          const collateralAsset = (item.collateralAsset ?? params.tokens[params.indexAsset]);
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
        params.tokens.map(x => x.address),
        params.prices.map(x => parseUnits(x, 18)),
      );
      const controller = await MockHelper.createMockTetuConverterController(signer, priceOracle.address);
      await tc.setController(controller.address);

      const amountOut = await facade.callStatic.calcInvestedAssets(
        params.tokens.map(x => x.address),
        params.amountsOut
          ? params.amountsOut.map((x, index) => parseUnits(x, decimals[index]))
          : params.tokens.map(x => BigNumber.from(0)),
        params.indexAsset,
        tc.address,
      );
      console.log('amountOut', amountOut);

      const gasUsed = await facade.estimateGas.calcInvestedAssets(
        params.tokens.map(x => x.address),
        params.amountsOut || params.tokens.map(x => BigNumber.from(0)),
        params.indexAsset,
        tc.address,
      );

      return {
        amountOut: +formatUnits(amountOut, decimals[params.indexAsset]),
        gasUsed,
      };
    }

    describe('Good paths', () => {
      describe('All amounts are located on the strategy balance only (liquidity is zero)', () => {
        describe('No debts', () => {
          it('should return expected values', async() => {
            const ret = (await makeCalcInvestedAssetsTest({
              tokens: [dai, usdc, usdt],
              indexAsset: 1,
              balances: ['100', '1987', '300'],
              prices: ['20', '10', '60'],
            })).amountOut;
            const expected = 100 * 20 / 10 + 300 * 60 / 10;

            expect(ret).eq(expected);
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
        it('should return expected values', async() => {
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
        it('should return expected values', async() => {
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
        it('should return expected values', async() => {
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
    describe('Gas estimation @skip-on-coverage', () => {
      it('should not exceed gas limits, no debts', async() => {
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
      it('should not exceed gas limits, debt exists', async() => {
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
  //endregion Unit tests
});