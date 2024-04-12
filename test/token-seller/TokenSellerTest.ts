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

/**
 * There is uniswap v3 pool with two tokens:
 * - token A - the token to be sold
 * - token B - the token to be withdrawn
 * The pool has some liquidity, so the tokens have some price P.
 *
 * Contract TokenSeller is liquidity provider of token A.
 * It creates range [P0, P1], where P0 <= P < P1
 * The task is to keep P ~ P0, ideally P = P0.
 * P1 >> P, so user is always able to buy any required amount of A.
 * Token seller provides liquidity of A to buy A and doesn't provide liquidity of B to sell A.
 * Anyway, user is able to swap A to B using liquidity from the main pool.
 *
 * If a user buys A, following happens:
 * - amount of B is increased on delta B
 * - price of A is increased: P => P2
 *
 * Token seller does following:
 *  - withdraw liquidity from the pool
 *  - deposit liquidity to the pool with new range [P0', P1'], where P0' <= P2 < P1'
 *  - transfer delta B to specified contract.
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
 */
describe('TokenSellerTest', () => {
  let snapshotBefore: string;
  let signer: SignerWithAddress;
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
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    facadeUni = (await DeployerUtils.deployContract(signer, "UniswapV3LibFacade")) as UniswapV3LibFacade;
    facadeLib = (await DeployerUtils.deployContract(signer, "FacadeUniv3TokenSellerLib")) as FacadeUniv3TokenSellerLib;
    calcLib = (await DeployerUtils.deployContract(signer, "FacadeCalcLib")) as FacadeCalcLib;

    // create uniswapV3-factory and helper classes
    uniswapV3Factory = (await DeployerUtils.deployContract(signer, "UniswapV3Factory")) as UniswapV3Factory;
    tokenA = (await DeployerUtils.deployMockToken(signer, "ToSell", decimalsA)) as MockToken;
    tokenB = (await DeployerUtils.deployMockToken(signer,  "USDC", decimalsB)) as MockToken;

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
    const poolParams: IPoolParams = {
      fee: 10000,
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
      const price36 = amountA.div(amountB).mul(parseUnits("1", 36)).div(parseUnits("1", decimalsA - decimalsB));
      console.log("price36", price36);
      const sqrtPrice18 = await calcLib.sqrt(price36);
      console.log("sqrtPrice18", sqrtPrice18);
      const sqrtPriceX96 = sqrtPrice18.mul(BigNumber.from(2).pow(96)).div(parseUnits("1", 18));
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
      await tokenA.mint(signer.address, requiredAmounts.amount0);
      await tokenA.approve(uniswapV3Callee.address, requiredAmounts.amount0);
      await tokenB.mint(signer.address, requiredAmounts.amount1);
      await tokenB.approve(uniswapV3Callee.address, requiredAmounts.amount1);

      // const preview = await facadeUni.addLiquidityPreview(pool.address, lowerTick, upperTick, amountA, amountB);
      // console.log("preview", preview);

      await uniswapV3Callee.mint(pool.address, signer.address, lowerTick, upperTick, liquidityAmount, {gasLimit: 9_000_000});
      console.log("done");
    });

    after(async function () {
      await TimeUtils.rollback(snapshot1);
    });

    describe("Create token-seller contract", () => {
      it("pool should have expected liquidity and prices", async () => {
        const liquidity = await pool.liquidity();
        console.log("liquidity", liquidity);
        expect(liquidity).gt(0);

        const priceA = await facadeUni.getPrice(pool.address, tokenA.address);
        const priceB = await facadeUni.getPrice(pool.address, tokenB.address);
        expect(priceA).eq(parseUnits("1", decimalsA));
        expect(priceB).eq(parseUnits("1", decimalsB));
      });
    });
  });
});