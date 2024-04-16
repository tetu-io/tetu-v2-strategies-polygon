import { TimeUtils } from "../../scripts/utils/TimeUtils";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {
  FacadeCalcLib,
  FacadeUniv3TokenSellerLib,
  MockToken,
  UniswapV3Callee,
  UniswapV3Factory,
  UniswapV3LibFacade, UniswapV3Pool,
  UniswapV3Pool__factory
} from "../../typechain";
import {parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {expect} from "chai";
import {Misc} from "../../scripts/utils/Misc";

/**
 * There is uniswap v3 pool with two tokens:
 * - token A - the token to be sold
 * - token B - the token to be withdrawn
 * The pool has some liquidity, so the tokens have some price P = reserves B / reserves A
 * For simplicity, whole liquidity is provided by single {singer1}
 * Possible pool params:
 * 1) pool swaps tokens (token A is token 1, token B is token 0)
 * 2) tickSpacing (1, 10, 60, 200 - it depends on fee value)
 *
 * Contract TokenSeller is liquidity provider of token A. The owner is {signer}
 * It creates range [P0, P1], where P0 <= P < P1
 * The task is to keep P ~ P0, ideally P = P0.
 * P1 >> P, so user is always able to buy any required amount of A.
 * Token seller provides liquidity of A to buy A and doesn't provide liquidity of B to sell A.
 * Anyway, the user {signer2} is able to swap A to B using liquidity from the main pool.
 *
 * If the user buys A, following happens:
 * - amount of B is increased on delta B
 * - price of A is increased: P => P2
 *
 * Token seller does following:
 *  - withdraw liquidity from the pool
 *  - deposit liquidity to the pool with new range [P0', P1'], where P0' <= P2 < P1'
 *  - transfer delta B to {receiver}
 *
 * If a user swaps A to B, following happens:
 * - price of A is decreased, P => P3:
 *    - most probably, P3 moves out of range [P0, P1]
 *    - edge case: P3 is still in [P0, P1]
 *
 * Token seller does following:
 *  - withdraw liquidity from the pool
 *  - deposit liquidity to the pool with new range [P0', P1'], where P0' <= P3 < P1'
 *
 * Invariant:
 *    Token seller shouldn't change price of the tokens in the pool.
 *
 * Test params that produce various uses cases:
 * 1) Initial amounts of B and A in the pool. P = reserves B / reserves A.
 * P ~ 0, P >> 0, P << 0
 * 2) Pool swap tokens
 * 3) Tick spacing (1, 10, 60, 200)
 * 4) min allowed tick - TokenSeller is not able to move price below the min allowed tick
 * 5) amount of liquidity in narrow range L (amount A)
 * 6) swap amount SA: SA << L, SA >> L, SA ~ L; we need to check a lot of variants SA with tiny delta.
 * 7) Threshold for ratio
 * 8) Threshold for amount B
 */
describe('TokenSellerTest', () => {
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;
  let uniswapV3Factory: UniswapV3Factory;
  let uniswapV3Callee: UniswapV3Callee;
  let facadeUni: UniswapV3LibFacade;
  let facadeLib: FacadeUniv3TokenSellerLib;

  /** we need log and sqrt for BigNumber */
  let calcLib: FacadeCalcLib;

  let tokenA: MockToken;
  let tokenB: MockToken;
  const decimalsA = 18;
  const decimalsB = 6;

  before(async function () {
    [signer, signer1, signer2] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    facadeUni = (await DeployerUtils.deployContract(signer, "UniswapV3LibFacade")) as UniswapV3LibFacade;
    facadeLib = (await DeployerUtils.deployContract(signer, "FacadeUniv3TokenSellerLib")) as FacadeUniv3TokenSellerLib;
    calcLib = (await DeployerUtils.deployContract(signer, "FacadeCalcLib")) as FacadeCalcLib;

    // create uniswapV3-factory and helper classes
    uniswapV3Factory = (await DeployerUtils.deployContract(signer, "UniswapV3Factory")) as UniswapV3Factory;
    tokenA = (await DeployerUtils.deployMockToken(signer, "ToSell", decimalsA, "0")) as MockToken;
    tokenB = (await DeployerUtils.deployMockToken(signer,  "USDC", decimalsB, "0")) as MockToken;

    uniswapV3Callee = (await DeployerUtils.deployContract(signer, "UniswapV3Callee")) as UniswapV3Callee;
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  interface IPoolParams {
    /** 1 fee unit is 0.0001%. Applicable values: 500, 3000, 10000 */
    fee: number;
    /** Initial amount of the token A in the pool */
    tokenAmountA: string;
    /** Initial amount of the token B in the pool */
    tokenAmountB: string;
    /**
     * Wide range of prices in percents. It's used to deposit initial amounts of tokens into the pool.
     * I.e. [0.01, 100] means range [0.01% of P, 100% of P], where P is initial price.
     */
    pricesRange: string[];
  }

  describe("Create and initialize main uniswap-v3 pool", () => {
    let snapshot1: string;
    let pool: UniswapV3Pool;
    let lowerTickWide: number;
    let upperTickWide: number;
    let liquidityAmountWide: BigNumber;
    let sqrtPriceX96Wide: BigNumber;
    const poolParams: IPoolParams = {
      fee: 10000, // 10000,
      tokenAmountA: "1000",
      tokenAmountB: "1000",
      pricesRange: ["0.01", "100"]
    }
    before(async function () {
      snapshot1 = await TimeUtils.snapshot();
      pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.callStatic.createPool(tokenA.address, tokenB.address, poolParams.fee), signer);
      await uniswapV3Factory.createPool(tokenA.address, tokenB.address, poolParams.fee);

      // initialize the pool

      // let's calculate initial price, see https://uniswapv3book.com/milestone_1/calculating-liquidity.html
      const amountA = parseUnits(poolParams.tokenAmountA, decimalsA);
      console.log("amountA", amountA);
      const amountB = parseUnits(poolParams.tokenAmountB, decimalsB);
      console.log("amountB", amountB);
      const price36 = amountB.mul(parseUnits("1", 36)).div(amountA);
      console.log("price36", price36);
      const sqrtPrice18 = await calcLib.sqrt(price36);
      console.log("sqrtPrice18", sqrtPrice18);
      const sqrtPriceX96 = sqrtPrice18.mul(BigNumber.from(2).pow(96)).div(parseUnits("1", 18)); // 18 = sqrt of 36
      console.log("sqrtPriceX96", sqrtPriceX96);
      await pool.initialize(sqrtPriceX96);

      // provide liquidity in wide range
      const tickCurrent = await facadeUni._getTickAtSqrtRatio(sqrtPriceX96);
      console.log("tickCurrent", tickCurrent);
      const priceLowerSquareX96 = sqrtPriceX96.mul(
        parseUnits(poolParams.pricesRange[0], 5)
      ).mul(
        parseUnits(poolParams.pricesRange[0], 5)
      ).div(
        parseUnits("1", 5 + 5)
      );
      const priceUpperSquareX96 = sqrtPriceX96.mul(
        parseUnits(poolParams.pricesRange[1], 5)
      ).mul(
        parseUnits(poolParams.pricesRange[1], 5)
      ).div(
        parseUnits("1", 5 + 5)
      );
      console.log("priceLowerSquareX96", priceLowerSquareX96);
      console.log("priceUpperSquareX96", priceUpperSquareX96);
      const tickLower0 = await facadeUni._getTickAtSqrtRatio(priceLowerSquareX96);
      const tickUpper0 = await facadeUni._getTickAtSqrtRatio(priceUpperSquareX96);
      const tickSpacing = await facadeUni.getTickSpacing(poolParams.fee)
      const tickRange = Math.ceil(
        (Math.round((tickUpper0 - tickLower0) / 2)) / tickSpacing
      ) * tickSpacing;
      console.log("tickLower0", tickLower0);
      console.log("tickUpper0", tickUpper0);
      console.log("tickRange", tickRange);
      console.log("tickSpacing", tickSpacing);

      const {lowerTick, upperTick} = await facadeLib.calcTickRange(tickCurrent, tickRange, tickSpacing);
      console.log("lowerTick", lowerTick);
      console.log("upperTick", upperTick);
      const liquidityAmount = await facadeUni.getLiquidityForAmounts(sqrtPriceX96, lowerTick, upperTick, amountA, amountB);
      console.log("liquidityAmount", liquidityAmount);
      const requiredAmounts = await facadeUni.getAmountsForLiquidity(sqrtPriceX96, lowerTick, upperTick, liquidityAmount);
      console.log("requiredAmounts", requiredAmounts);

      // prepare initial amounts of both token
      await tokenA.connect(signer1).mint(signer1.address, requiredAmounts.amount0);
      await tokenA.connect(signer1).approve(uniswapV3Callee.address, requiredAmounts.amount0);
      await tokenB.connect(signer1).mint(signer1.address, requiredAmounts.amount1);
      await tokenB.connect(signer1).approve(uniswapV3Callee.address, requiredAmounts.amount1);

      console.log("signer1.balance before A0", await tokenA.balanceOf(signer1.address));
      console.log("balance before B0", await tokenB.balanceOf(signer1.address));
      await uniswapV3Callee.connect(signer1).mint(pool.address, signer1.address, lowerTick, upperTick, liquidityAmount, {gasLimit: 9_000_000});
      console.log("signer1.balance after A0", await tokenA.balanceOf(signer1.address));
      console.log("signer1.balance after B0", await tokenB.balanceOf(signer1.address));

      console.log("slot0 after initial minting", await pool.slot0());

      lowerTickWide = lowerTick;
      upperTickWide = upperTick;
      liquidityAmountWide = liquidityAmount;
      sqrtPriceX96Wide = sqrtPriceX96;
    });

    after(async function () {
      await TimeUtils.rollback(snapshot1);
    });

    describe("narrow pool", () => {
      describe.skip("Add narrow pool, pA <= P < pB", () => {
        const AMOUNT_A = "1000";
        let snapshot2: string;
        let lowerTickNarrow: number;
        let upperTickNarrow: number;
        let liquidityAmountNarrow: BigNumber;

        before(async function () {
          console.log("Add liquidity to narrow range");
          snapshot2 = await TimeUtils.snapshot();

          // provide liquidity in narrow range
          const amountA = parseUnits(AMOUNT_A, decimalsA);
          const slot0 = await pool.slot0();
          const sqrtP = slot0.sqrtPriceX96;
          const tickSpacing = await facadeUni.getTickSpacing(poolParams.fee);
          console.log("amountA", amountA);
          console.log("sqrtP", sqrtP);
          console.log("tickSpacing", tickSpacing);

          // we know current price. Let's calculate Pa and Pb
          const targetPa = slot0.sqrtPriceX96; // Pa ~ P
          const targetPb = slot0.sqrtPriceX96.mul(3); // Pb ~ 9 * P
          console.log("targetPa", targetPa);
          console.log("targetPb", targetPb);

          // calculate ticks for the target prices
          const targetTickA = await facadeUni._getTickAtSqrtRatio(targetPa);
          const targetTickB = await facadeUni._getTickAtSqrtRatio(targetPb);
          console.log("targetTickA", targetTickA);
          console.log("targetTickB", targetTickB);

          // adjust the ticks to the allowable values
          const tickLowerA = Math.ceil(targetTickA / tickSpacing) * tickSpacing;
          const tickUpperB = Math.ceil(targetTickB / tickSpacing) * tickSpacing;
          console.log("tickLowerA", tickLowerA);
          console.log("tickUpperB", tickUpperB);

          // now, let's calculate allowable Pa and Pb
          const sqrtPa = await facadeUni._getSqrtRatioAtTick(tickLowerA);
          const sqrtPb = await facadeUni._getSqrtRatioAtTick(tickUpperB);
          console.log("sqrtPa", sqrtPa);
          console.log("sqrtPb", sqrtPb);

          // current tick
          const tickCurrent = await facadeUni._getTickAtSqrtRatio(slot0.sqrtPriceX96);
          console.log("tickCurrent", tickCurrent);

          // we know: x = amount of A, pA, pB, P. What is amount of B?
          // https://atiselsts.github.io/pdfs/uniswap-v3-liquidity-math.pdf
          // section 3.2.1: we know x, pA, pb, P, we need to find y
          // Lx = x / (sqrtP * sqrtPb) / (sqrtPb - sqrtP)
          // y = Lx * (sqrtP - sqrtPa)

          const q96 = BigNumber.from(2).pow(96);
          const liquidityAmountX = amountA.mul(sqrtP.mul(sqrtPb)).div(sqrtPb.sub(sqrtP)).div(q96);
          const amountB = liquidityAmountX.mul(sqrtP.sub(sqrtPa)).div(q96);
          console.log("liquidityAmountX", liquidityAmountX);
          console.log("amountB", amountB);

          const liquidityAmount = await facadeUni.getLiquidityForAmounts(sqrtP, tickLowerA, tickUpperB, amountA, amountB);
          console.log("liquidityAmount", liquidityAmount);

          const requiredAmounts = await facadeUni.getAmountsForLiquidity(slot0.sqrtPriceX96, tickLowerA, tickUpperB, liquidityAmount);
          console.log("requiredAmounts", requiredAmounts);

          // prepare initial amounts of both token
          await tokenA.mint(signer.address, requiredAmounts.amount0);
          await tokenA.approve(uniswapV3Callee.address, requiredAmounts.amount0);
          await tokenB.mint(signer.address, requiredAmounts.amount1);
          await tokenB.approve(uniswapV3Callee.address, requiredAmounts.amount1);

          await uniswapV3Callee.mint(pool.address, signer.address, tickLowerA, tickUpperB, liquidityAmount, {gasLimit: 9_000_000});
          lowerTickNarrow = tickLowerA;
          upperTickNarrow = tickUpperB;
          liquidityAmountNarrow = liquidityAmount;
        });
        after(async function () {
          await TimeUtils.rollback(snapshot2);
        });

        it("should not change price", async () => {
          const slot0 = await pool.slot0();
          expect(slot0.sqrtPriceX96).eq(sqrtPriceX96Wide);
        });
      });
      describe("Add narrow pool, P <= pA < pB", () => {
        const AMOUNT_A = "1000";
        let snapshot2: string;
        let lowerTickNarrow: number;
        let upperTickNarrow: number;
        let liquidityAmountNarrow: BigNumber;

        before(async function () {
          console.log("Add liquidity to narrow range");
          snapshot2 = await TimeUtils.snapshot();

          // provide liquidity in narrow range
          const amountA = parseUnits(AMOUNT_A, decimalsA);
          const slot0 = await pool.slot0();
          const sqrtP = slot0.sqrtPriceX96;
          const tickSpacing = await facadeUni.getTickSpacing(poolParams.fee);
          console.log("amountA", amountA);
          console.log("sqrtP", sqrtP);
          console.log("tickSpacing", tickSpacing);

          // we know current price. Let's calculate Pa and Pb
          const targetPa = slot0.sqrtPriceX96; // Pa ~ P
          const targetPb = slot0.sqrtPriceX96.mul(3); // Pb ~ 9 * P
          console.log("targetPa", targetPa);
          console.log("targetPb", targetPb);

          // calculate ticks for the target prices
          const targetTickA = await facadeUni._getTickAtSqrtRatio(targetPa);
          const targetTickB = await facadeUni._getTickAtSqrtRatio(targetPb);
          console.log("targetTickA", targetTickA);
          console.log("targetTickB", targetTickB);

          // adjust the ticks to the allowable values
          const tickLowerA = Math.ceil(targetTickA / tickSpacing) * tickSpacing;
          const tickUpperB = Math.ceil(targetTickB / tickSpacing) * tickSpacing;
          console.log("tickLowerA", tickLowerA);
          console.log("tickUpperB", tickUpperB);

          // now, let's calculate allowable Pa and Pb
          const sqrtPa = await facadeUni._getSqrtRatioAtTick(tickLowerA);
          const sqrtPb = await facadeUni._getSqrtRatioAtTick(tickUpperB);
          console.log("sqrtPa", sqrtPa);
          console.log("sqrtPb", sqrtPb);

          // current tick
          const tickCurrent = await facadeUni._getTickAtSqrtRatio(slot0.sqrtPriceX96);
          console.log("tickCurrent", tickCurrent);

          // we know: x = amount of A, pA, pB, P. What is amount of B?
          // https://atiselsts.github.io/pdfs/uniswap-v3-liquidity-math.pdf
          // section 3.2.1: we know x, pA, pb, P, we need to find y
          // Lx = x / (sqrtP * sqrtPb) / (sqrtPb - sqrtP)
          // y = Lx * (sqrtP - sqrtPa)

          const q96 = BigNumber.from(2).pow(96);
          const liquidityAmountX = amountA.mul(sqrtP.mul(sqrtPb)).div(sqrtPb.sub(sqrtP)).div(q96);
          const amountB = liquidityAmountX.mul(sqrtP.sub(sqrtPa)).div(q96);
          console.log("liquidityAmountX", liquidityAmountX);
          console.log("amountB", amountB);

          const liquidityAmount = await facadeUni.getLiquidityForAmounts(sqrtP, tickLowerA, tickUpperB, amountA, 0);
          console.log("liquidityAmount", liquidityAmount);

          const requiredAmounts = await facadeUni.getAmountsForLiquidity(sqrtP, tickLowerA, tickUpperB, liquidityAmount);
          console.log("requiredAmounts", requiredAmounts);

          // prepare initial amounts of both token
          await tokenA.mint(signer.address, amountA); // requiredAmounts.amount0);
          await tokenA.approve(uniswapV3Callee.address, amountA); // requiredAmounts.amount0);
          await tokenB.mint(signer.address, requiredAmounts.amount1);
          await tokenB.approve(uniswapV3Callee.address, requiredAmounts.amount1);

          console.log("balance before A1", await tokenA.balanceOf(signer.address));
          console.log("balance before B1", await tokenB.balanceOf(signer.address));
          await uniswapV3Callee.mint(pool.address, signer.address, tickLowerA, tickUpperB, liquidityAmount, {gasLimit: 9_000_000});
          console.log("balance after A1", await tokenA.balanceOf(signer.address));
          console.log("balance after B1", await tokenB.balanceOf(signer.address));
          lowerTickNarrow = tickLowerA;
          upperTickNarrow = tickUpperB;
          liquidityAmountNarrow = liquidityAmount;
          console.log("slot0 after narrow deposit", await pool.slot0());
        });
        after(async function () {
          await TimeUtils.rollback(snapshot2);
        });

        it("should not change price", async () => {
          const slot0 = await pool.slot0();
          console.log(slot0);
          expect(slot0.sqrtPriceX96).eq(sqrtPriceX96Wide);
        });

        describe("Swap B => A (buy A)", () => {
          const swapAmountB: string = "800";
          let snapshot3: string;
          before(async function () {
            snapshot3 = await TimeUtils.snapshot();

            const amountToSwapB = parseUnits(swapAmountB, decimalsB);

            await tokenB.connect(signer2).mint(signer2.address, amountToSwapB);
            await tokenB.connect(signer2).approve(uniswapV3Callee.address, amountToSwapB);

            console.log("signer2.balance before A2", await tokenA.balanceOf(signer2.address));
            console.log("signer2.balance before B2", await tokenB.balanceOf(signer2.address));
            await uniswapV3Callee.connect(signer2).swap(pool.address, signer2.address, tokenB.address, amountToSwapB);
            console.log("signer2.balance after A2", await tokenA.balanceOf(signer2.address));
            console.log("signer2.balance after B2", await tokenB.balanceOf(signer2.address));

            console.log("slot0 after narrow swap", await pool.slot0());
          });
          after(async function () {
            await TimeUtils.rollback(snapshot3);
          });

          it("pool should have expected liquidity and prices", async () => {
            const liquidity = await pool.liquidity();
            console.log("liquidity", liquidity);
            expect(liquidity).gt(0);

            const priceA = await facadeUni.getPrice(pool.address, tokenA.address);
            const priceB = await facadeUni.getPrice(pool.address, tokenB.address);
            console.log("priceA", priceA);
            console.log("priceB", priceB);
            console.log("slot0 after swap", await pool.slot0());

            console.log("balance before A3", await tokenA.balanceOf(signer.address));
            console.log("balance before B3", await tokenB.balanceOf(signer.address));
            await pool.burn(lowerTickNarrow, upperTickNarrow, liquidityAmountNarrow);
            await pool.collect(signer.address, lowerTickNarrow, upperTickNarrow, Misc.MAX_UINT_128, Misc.MAX_UINT_128);
            console.log("balance after A3", await tokenA.balanceOf(signer.address));
            console.log("balance after B3", await tokenB.balanceOf(signer.address));


            console.log("signer1. balance before A4", await tokenA.balanceOf(signer1.address));
            console.log("signer1. balance before B4", await tokenB.balanceOf(signer1.address));
            await pool.connect(signer1).burn(lowerTickWide, upperTickWide, liquidityAmountWide);
            await pool.connect(signer1).collect(signer1.address, lowerTickWide, upperTickWide, Misc.MAX_UINT_128, Misc.MAX_UINT_128);
            console.log("signer1. balance after A4", await tokenA.balanceOf(signer1.address));
            console.log("signer1. balance after B4", await tokenB.balanceOf(signer1.address));
          });

        });
      });
    });

    describe("Create token-seller contract", () => {
      let snapshot2: string;
      before(async function () {
        snapshot2 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot2);
      });

      it("pool should have expected liquidity and prices", async () => {
        const liquidity = await pool.liquidity();
        console.log("liquidity", liquidity);
        expect(liquidity).gt(0);

        const priceA = await facadeUni.getPrice(pool.address, tokenA.address);
        const priceB = await facadeUni.getPrice(pool.address, tokenB.address);
        expect(priceA).approximately(parseUnits("1", decimalsB), 1, "price A in terms of B");
        expect(priceB).approximately(parseUnits("1", decimalsA), 1, "price B in terms of A");
      });

      describe("Swap B => A (buy A)", () => {
        const swapAmountB: string = "800";
        let snapshot3: string;
        before(async function () {
          snapshot3 = await TimeUtils.snapshot();

          const amountToSwapB = parseUnits(swapAmountB, decimalsB);

          await tokenB.mint(signer.address, amountToSwapB);
          await tokenB.approve(uniswapV3Callee.address, amountToSwapB);

          await uniswapV3Callee.swap(pool.address, signer.address, tokenB.address, amountToSwapB);
        });
        after(async function () {
          await TimeUtils.rollback(snapshot3);
        });

        it("pool should have expected liquidity and prices", async () => {
          const liquidity = await pool.liquidity();
          console.log("liquidity", liquidity);
          expect(liquidity).gt(0);

          const priceA = await facadeUni.getPrice(pool.address, tokenA.address);
          const priceB = await facadeUni.getPrice(pool.address, tokenB.address);
          console.log("priceA", priceA);
          console.log("priceB", priceB);
          console.log("slot0 after swap", await pool.slot0());
        });

      });

      describe("Swap A => B (sell A)", () => {
        const swapAmountA: string = "600";
        let snapshot3: string;
        before(async function () {
          snapshot3 = await TimeUtils.snapshot();

          const amountToSwapA = parseUnits(swapAmountA, decimalsA);

          await tokenA.mint(signer.address, amountToSwapA);
          await tokenA.approve(uniswapV3Callee.address, amountToSwapA);

          await uniswapV3Callee.swap(pool.address, signer.address, tokenA.address, amountToSwapA);
        });
        after(async function () {
          await TimeUtils.rollback(snapshot3);
        });

        it("pool should have expected liquidity and prices", async () => {
          const liquidity = await pool.liquidity();
          console.log("liquidity", liquidity);
          expect(liquidity).gt(0);

          const priceA = await facadeUni.getPrice(pool.address, tokenA.address);
          const priceB = await facadeUni.getPrice(pool.address, tokenB.address);
          console.log("priceA", priceA);
          console.log("priceB", priceB);
          console.log("slot0 after swap", await pool.slot0());
        });
      });
    });
  });
});