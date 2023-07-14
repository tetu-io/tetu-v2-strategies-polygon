import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers} from 'hardhat';
import {TimeUtils} from '../../../scripts/utils/TimeUtils';
import {DeployerUtils} from '../../../scripts/utils/DeployerUtils';
import {formatUnits, parseUnits} from 'ethers/lib/utils';
import {ConverterStrategyBaseLibFacade2, MockToken} from '../../../typechain';
import {expect} from 'chai';
import {MockHelper} from '../../baseUT/helpers/MockHelper';
import {IQuoteRepayParams, ITokenAmountNum} from "../../baseUT/mocks/TestDataTypes";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {
  setupMockedQuoteRepay
} from "../../baseUT/mocks/MockRepayUtils";
import {IERC20Metadata__factory} from "../../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";

/**
 * Test of ConverterStrategyBaseLib using ConverterStrategyBaseLibFacade
 * to direct access of the library functions.
 *
 * Following tests are created using fixtures, not snapshots
 */
describe('ConverterStrategyBaseLibFixTest', () => {
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
  //endregion Unit tests
});