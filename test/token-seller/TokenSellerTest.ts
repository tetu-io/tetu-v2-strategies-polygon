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
  UniswapV3Pool__factory, Univ3TokenSeller
} from "../../typechain";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {expect} from "chai";
import {Misc} from "../../scripts/utils/Misc";
import {writeFileSyncRestoreFolder} from "../baseUT/utils/FileUtils";
import {writeFileSync} from "fs";
import {Univ3TokenSellerLib} from "../../typechain/contracts/token-seller/Univ3TokenSeller";
import TokenSellerConfigStruct = Univ3TokenSellerLib.TokenSellerConfigStruct;

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
  const pathWithoutExt = `./tmp/TokenSellerTest`;
  const SIGNER_AMOUNT_A = "10000000";
  const SIGNER_AMOUNT_B = "100000";
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

  const states: IStateHistory[] = [];

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
    console.log("tokenA", tokenA.address);
    console.log("tokenB", tokenB.address);

    uniswapV3Callee = (await DeployerUtils.deployContract(signer, "UniswapV3Callee")) as UniswapV3Callee;

    await tokenA.mint(signer.address, parseUnits(SIGNER_AMOUNT_A, decimalsA));
    await tokenA.mint(signer1.address, parseUnits(SIGNER_AMOUNT_A, decimalsA));
    await tokenA.mint(signer2.address, parseUnits(SIGNER_AMOUNT_A, decimalsA));

    await tokenB.mint(signer.address, parseUnits(SIGNER_AMOUNT_B, decimalsB));
    await tokenB.mint(signer1.address, parseUnits(SIGNER_AMOUNT_B, decimalsB));
    await tokenB.mint(signer2.address, parseUnits(SIGNER_AMOUNT_B, decimalsB));
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
    saveToCsv(states, "all");
  });

  //region Data types
  /**
   * Params of first liquidity provider that deposit to the pool in wide range.
   * Current price is generated by this deposit as amount1/amount0
   */
  interface IMainPoolParams {
    tag: string;
    /** 1 fee unit is 0.0001%. Applicable values: 500, 3000, 10000 */
    fee: number;
    /** Initial amount of the token A in the pool */
    amountA: string;
    /** Initial amount of the token B in the pool */
    amountB: string;
    /**
     * Wide range of prices in percents. It's used to deposit initial amounts of tokens into the pool.
     * I.e. [0.01, 100] means range [0.01% of P, 100% of P], where P is initial price.
     */
    pricesRange: string[];
    /**
     * False: token0 = tokenA, token1 = tokenB
     * True: token0 = tokenB, token1 = tokenA
     */
    poolSwapTokens: boolean;
  }

  interface INarrowRangeParams {
    tag: string;
    /** Total amount of A that should be placed on balance of TokenSeller */
    balanceA: string;
    /** Amount of token A to be deposited to the narrow range */
    amountA: string;
    /** Width of the narrow range in tickSpacing. The actual width = tickRangeSize * tickSpacing */
    tickRangeSize: number;
    /**
     * Min tick is calculated as tick of min price.
     * Min price = (sqrt(current price) * sqrtMinPriceRatio)^2
     */
    sqrtMinPriceRatio: string;
    /**
     * Threshold for the current tick. Refresh is required if
     *    (tick - lower tick) / (upper tick - lower tick)
     * exceeds the threshold.
     */
    thresholdRatio: string;
    /** Min amount allowed to withdraw from token seller to the owner of the narrow range */
    thresholdTokenB: string;
  }

  interface ISwapParams {
    tag: string;
    swapTokenA: boolean;
    swapAmount: string;
  }

  interface IInputParams {
    mainPool: IMainPoolParams;
    narrowRange: INarrowRangeParams;
    swapParams: ISwapParams;
  }

  interface IRangeState {
    lowerTick: number;
    upperTick: number;
    liquidityAmount: BigNumber;
    /** Amounts of tokens A and B that can be withdrawn from the pool */
    amountsAB: number[];
  }

  interface IState {
    sqrtPriceX96: BigNumber;
    tick: number;

    mainPool: IRangeState;
    narrowRange: IRangeState;

    /** Balances of token A and B of TokenSeller contract */
    balancesAbTokenSeller: number[];
    /** Balances of token A and B of signer 1 (wide range owner) */
    balancesAbSigner1: number[];
    /** Balances of token A and B of signer (narrow range owner) */
    balancesAbSigner: number[];
    /** Balances of token A and B of signer 2 (swapper) */
    balancesAbSigner2: number[];
  }

  /**
   * Results of following actions:
   * 1) signer1 deposits to wide range
   * 2) signer deposits to narrow range using TokenSeller
   * 3) signer2 makes a swap
   * 4) TokenSeller.refreshPool
   * 5) signer closes narrow position
   * 6) signer1 closes wide position
   */
  interface IStateHistory {
    inputParams: IInputParams;
    start: IState;
    init: IState;
    afterSwap: IState;
    afterRefresh: IState;
    final: IState;
  }
  //endregion Data types

  //region Test data
  const MAIN_POOLS: IMainPoolParams[] = [
    {tag: "price 1", fee: 10000, amountA: "1000", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: false},
    // todo {tag: "price 1, swap", fee: 10000, amountA: "1000", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: true},
  ];

  const NARROW_RANGES: INarrowRangeParams[] = [
    {tag: "10ths", balanceA: "50000", amountA: "10000", sqrtMinPriceRatio: "0.9", thresholdRatio: "0.001", thresholdTokenB: "1", tickRangeSize: 5}
  ];

  const SWAP_SETS: ISwapParams[] = [
    {tag: "B1000", swapTokenA: false, swapAmount: "1000"},
    {tag: "A1000", swapTokenA: true, swapAmount: "1000"},
  ];
  //endregion Test data

  //region Utils
  async function getBalancesAB(user: string): Promise<number[]> {
    return [
      +formatUnits(await tokenA.balanceOf(user), decimalsA),
      +formatUnits(await tokenB.balanceOf(user), decimalsB),
    ]
  }

  function registerResults(states: IStateHistory[], state: IStateHistory) {
    states.push(state);
    saveToCsv([state], states.length.toString());
  }

  function rangeStateToArrayHeaders(): string[] {
    return [
      "lowerTick",
      "upperTick",
      "liquidityAmount",
      "pool=>amountA",
      "pool=>amountB"
    ];
  }
  function rangeStateToArray(r: IRangeState) {
    return [
      r.lowerTick,
      r.upperTick,
      r.liquidityAmount,
      r.amountsAB[0],
      r.amountsAB[1],
    ]
  }

  function stateToArrayHeaders(): string[] {
    return [
      "tick",
      "sqrtPriceX96",
      ...rangeStateToArrayHeaders().map(x => "main." + x),
      ...rangeStateToArrayHeaders().map(x => "narrow." + x),
      "tokenSeller.balanceA",
      "tokenSeller.balanceB",
      "signer.balanceA",
      "signer.balanceB",
      "poolOwner.balanceA",
      "poolOwner.balanceB",
      "swapper.balanceA",
      "swapper.balanceB",
    ]
  }
  function stateToArray(state: IState) {
    return [
      state.tick,
      state.sqrtPriceX96,

      ...rangeStateToArray(state.mainPool),
      ...rangeStateToArray(state.narrowRange),

      state.balancesAbTokenSeller[0],
      state.balancesAbTokenSeller[1],

      state.balancesAbSigner[0],
      state.balancesAbSigner[1],

      state.balancesAbSigner1[0],
      state.balancesAbSigner1[1],

      state.balancesAbSigner2[0],
      state.balancesAbSigner2[1],
    ]
  }

  function stateHistoryToArrayHeaders(): string[] {
    return [
      "input.main.tag",
      "input.main.fee",
      "input.main.poolSwapTokens",
      "input.main.amountA",
      "input.main.amountB",
      "input.main.priceRangeFrom",
      "input.main.priceRangeTo",

      "input.narrow.tag",
      "input.narrow.balanceA",
      "input.narrow.amountA",
      "input.narrow.tickRangeSize",
      "input.narrow.sqrtMinPriceRatio",
      "input.narrow.thresholdRatio",
      "input.narrow.thresholdTokenB",

      "input.swap.tag",
      "input.swap.swapTokenA",
      "input.swap.swapAmount",
    ]
  }
  function stateHistoryToArray(state: IStateHistory): (string | number | BigNumber)[]{
    return [
      state.inputParams.mainPool.tag,
      state.inputParams.mainPool.fee,
      state.inputParams.mainPool.poolSwapTokens ? 1 : 0,
      state.inputParams.mainPool.amountA,
      state.inputParams.mainPool.amountB,
      state.inputParams.mainPool.pricesRange[0],
      state.inputParams.mainPool.pricesRange[1],

      state.inputParams.narrowRange.tag,
      state.inputParams.narrowRange.balanceA,
      state.inputParams.narrowRange.amountA,
      state.inputParams.narrowRange.tickRangeSize,
      state.inputParams.narrowRange.sqrtMinPriceRatio,
      state.inputParams.narrowRange.thresholdRatio,
      state.inputParams.narrowRange.thresholdTokenB,

      state.inputParams.swapParams.tag,
      state.inputParams.swapParams.swapTokenA ? 1 : 0,
      state.inputParams.swapParams.swapAmount,
    ];
  }

  function saveToCsv(states: IStateHistory[], tag?: string) {
    const pathOut = `${pathWithoutExt}${tag}.csv`
    const subStates = ["start", "init", "afterSwap", "afterRefresh", "final"];
    const firstRow = ["param"];
    for (let i = 0; i < states.length; ++i) {
      const items = subStates.map(x => `${x}:${i}`);
      firstRow.push(...items);
    }
    writeFileSyncRestoreFolder(pathOut, firstRow.join(";") + '\n', { encoding: 'utf8', flag: 'w'});

    const column0 = stateToArrayHeaders();
    const columns: (string | number | BigNumber)[][] = [];
    for (let i = 0; i < states.length; ++i) {
      columns.push(
        stateToArray(states[i].start),
        stateToArray(states[i].init),
        stateToArray(states[i].afterSwap),
        stateToArray(states[i].afterRefresh),
        stateToArray(states[i].final),
      );
    }
    for (let i = 0; i < column0.length; ++i) {
      const line = [
        column0[i],
        ...columns.map(x => x[i])
      ]
      writeFileSync(
        pathOut,
        line.join(';') + '\n',
        { encoding: 'utf8', flag: 'a' },
      );
    }

    // input params
    const headers = stateHistoryToArrayHeaders();
    const data = states.map(x => stateHistoryToArray(x));
    for (let i = 0; i < headers.length; ++i) {
      const line: (string | number | BigNumber)[] = [headers[i]];
      for (const x of data) {
        line.push(x[i]);
        line.push(...subStates.slice(1).map(_ => ""));
      }
      writeFileSync(
        pathOut,
        line.join(';') + '\n',
        { encoding: 'utf8', flag: 'a' },
      );
    }

  }
  //endregion Utils

  MAIN_POOLS.forEach(function (mainPool: IMainPoolParams) {
    describe(`Main pool: ${mainPool.tag}`, () => {
      let snapshot1: string;
      let pool: UniswapV3Pool;
      let lowerTickWide: number;
      let upperTickWide: number;
      let liquidityAmountWide: BigNumber;
      let sqrtPriceX96Wide: BigNumber;
      let wideRangeState0: IRangeState;
      let start: IState;

      //region Utils
      async function getCurrentNarrowRangeState(tokenSeller: Univ3TokenSeller, sqrtPriceX96: BigNumber): Promise<IRangeState> {
        const state = await tokenSeller.state();
        const resultAmounts = await facadeUni.getAmountsForLiquidity(
          sqrtPriceX96,
          state.lowerTick,
          state.upperTick,
          state.liquidityAmount
        );

        return {
          lowerTick: state.lowerTick,
          upperTick: state.upperTick,
          liquidityAmount: state.liquidityAmount,
          amountsAB: [
            +formatUnits(mainPool.poolSwapTokens ? resultAmounts[1] : resultAmounts[0], decimalsA),
            +formatUnits(mainPool.poolSwapTokens ? resultAmounts[0] : resultAmounts[1], decimalsB),
          ]
        }
      }

      async function getCurrentWideRangeState(sqrtPriceX96: BigNumber): Promise<IRangeState> {
        const resultAmounts = await facadeUni.getAmountsForLiquidity(
          sqrtPriceX96,
          lowerTickWide,
          upperTickWide,
          liquidityAmountWide
        );

        return {
          lowerTick: lowerTickWide,
          upperTick: upperTickWide,
          liquidityAmount: liquidityAmountWide,
          amountsAB: [
            +formatUnits(mainPool.poolSwapTokens ? resultAmounts[1] : resultAmounts[0], decimalsA),
            +formatUnits(mainPool.poolSwapTokens ? resultAmounts[0] : resultAmounts[1], decimalsB),
          ]
        }
      }

      async function initializePool(): Promise<{
        sqrtPriceX96: BigNumber,
        amountA: BigNumber,
        amountB: BigNumber
      }> {
        // let's calculate initial price, see https://uniswapv3book.com/milestone_1/calculating-liquidity.html
        const amountA = parseUnits(mainPool.amountA, decimalsA);
        console.log("amountA", amountA);
        const amountB = parseUnits(mainPool.amountB, decimalsB);
        console.log("amountB", amountB);

        const price36 = mainPool.poolSwapTokens
          ? amountA.mul(parseUnits("1", 36)).div(amountB)
          : amountB.mul(parseUnits("1", 36)).div(amountA);
        const sqrtPrice18 = await calcLib.sqrt(price36);
        const sqrtPriceX96 = sqrtPrice18.mul(BigNumber.from(2).pow(96)).div(parseUnits("1", 18)); // 18 = sqrt of 36
        console.log("sqrtPriceX96", sqrtPriceX96);
        await pool.initialize(sqrtPriceX96);
        return {sqrtPriceX96, amountA, amountB}
      }
      //endregion Utils

      before(async function () {
        snapshot1 = await TimeUtils.snapshot();

        start = {
          mainPool: {
            lowerTick: 0,
            upperTick: 0,
            liquidityAmount: BigNumber.from(0),
            amountsAB: [0, 0],
          },
          tick: 0,
          sqrtPriceX96: BigNumber.from(0),
          narrowRange: {
            lowerTick: 0,
            upperTick: 0,
            liquidityAmount: BigNumber.from(0),
            amountsAB: [0, 0],
          },
          balancesAbTokenSeller: [0, 0],
          balancesAbSigner: await getBalancesAB(signer.address),
          balancesAbSigner1: await getBalancesAB(signer1.address),
          balancesAbSigner2: await getBalancesAB(signer2.address),
        }
        pool = UniswapV3Pool__factory.connect(await uniswapV3Factory.callStatic.createPool(
          mainPool.poolSwapTokens ? tokenB.address : tokenA.address,
          mainPool.poolSwapTokens ? tokenA.address : tokenB.address,
          mainPool.fee
        ), signer);
        await uniswapV3Factory.createPool(
          mainPool.poolSwapTokens ? tokenB.address : tokenA.address,
          mainPool.poolSwapTokens ? tokenA.address : tokenB.address,
          mainPool.fee
        );

        // initialize the pool

        const {sqrtPriceX96, amountA, amountB} = await initializePool();

        // provide liquidity in wide range
        const tickCurrent = await facadeUni._getTickAtSqrtRatio(sqrtPriceX96);
        console.log("tickCurrent", tickCurrent);
        const priceLowerSquareX96 = sqrtPriceX96.mul(
          parseUnits(mainPool.pricesRange[0], 5)
        ).mul(
          parseUnits(mainPool.pricesRange[0], 5)
        ).div(
          parseUnits("1", 5 + 5)
        );
        const priceUpperSquareX96 = sqrtPriceX96.mul(
          parseUnits(mainPool.pricesRange[1], 5)
        ).mul(
          parseUnits(mainPool.pricesRange[1], 5)
        ).div(
          parseUnits("1", 5 + 5)
        );
        console.log("priceLowerSquareX96", priceLowerSquareX96);
        console.log("priceUpperSquareX96", priceUpperSquareX96);
        const tickLower0 = await facadeUni._getTickAtSqrtRatio(priceLowerSquareX96);
        const tickUpper0 = await facadeUni._getTickAtSqrtRatio(priceUpperSquareX96);
        const tickSpacing = await facadeUni.getTickSpacing(mainPool.fee)
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
        const liquidityAmount = mainPool.poolSwapTokens
          ? await facadeUni.getLiquidityForAmounts(sqrtPriceX96, lowerTick, upperTick, amountB, amountA)
          : await facadeUni.getLiquidityForAmounts(sqrtPriceX96, lowerTick, upperTick, amountA, amountB);
        console.log("liquidityAmount", liquidityAmount);
        const requiredAmounts = await facadeUni.getAmountsForLiquidity(sqrtPriceX96, lowerTick, upperTick, liquidityAmount);
        console.log("requiredAmounts", requiredAmounts);

        // prepare initial amounts of both token
        await tokenA.connect(signer1).approve(uniswapV3Callee.address, mainPool.poolSwapTokens ? requiredAmounts.amount1 : requiredAmounts.amount0);
        await tokenB.connect(signer1).approve(uniswapV3Callee.address, mainPool.poolSwapTokens ? requiredAmounts.amount0 : requiredAmounts.amount1);

        console.log("signer1.balance before A0", await tokenA.balanceOf(signer1.address));
        console.log("balance before B0", await tokenB.balanceOf(signer1.address));
        await uniswapV3Callee.connect(signer1).mint(pool.address, signer1.address, lowerTick, upperTick, liquidityAmount, {gasLimit: 9_000_000});
        console.log("signer1.balance after A0", await tokenA.balanceOf(signer1.address));
        console.log("signer1.balance after B0", await tokenB.balanceOf(signer1.address));

        lowerTickWide = lowerTick;
        upperTickWide = upperTick;
        liquidityAmountWide = liquidityAmount;
        sqrtPriceX96Wide = sqrtPriceX96;

        wideRangeState0 = await getCurrentWideRangeState(sqrtPriceX96);
        console.log("Main pool is initialized");
      });

      after(async function () {
        await TimeUtils.rollback(snapshot1);
        // todo save states to CSV file
      });

      NARROW_RANGES.forEach(function (narrowRange: INarrowRangeParams) {
        describe(`Narrow range: ${narrowRange.tag}`, () => {
          let tokenSeller: Univ3TokenSeller;
          let snapshot2: string;
          let init: IState;
          before(async function () {
            console.log("Set up token seller");
            snapshot2 = await TimeUtils.snapshot();

            const poolInfo = await pool.slot0();

            const minSqrtPriceX96 = poolInfo.sqrtPriceX96
              .mul(parseUnits(narrowRange.sqrtMinPriceRatio, 18))
              .div(parseUnits("1", 18));

            const tokenSellerConfig: TokenSellerConfigStruct = {
              amountA: parseUnits(narrowRange.amountA, decimalsA),
              tickRangeSize: narrowRange.tickRangeSize,
              minTick: await facadeUni._getTickAtSqrtRatio(minSqrtPriceX96),
              thresholdTokenB: parseUnits(narrowRange.thresholdTokenB, decimalsB),
              thresholdRatio: parseUnits(narrowRange.thresholdRatio, 5),
              thresholdLastRefreshPoolSec: 0 // todo
            }

            tokenSeller = (await DeployerUtils.deployContract(
              signer,
              "Univ3TokenSeller",
              tokenA.address, tokenB.address, pool.address, tokenSellerConfig, signer.address,
            )) as Univ3TokenSeller;
            console.log("Token seller is created");

            await tokenA.transfer(tokenSeller.address, parseUnits(narrowRange.balanceA, decimalsA));
            await tokenSeller.openPosition();
            console.log("Token seller opens a position");

            init = {
              mainPool: wideRangeState0,
              tick: poolInfo.tick,
              sqrtPriceX96: poolInfo.sqrtPriceX96,
              narrowRange: await getCurrentNarrowRangeState(tokenSeller, poolInfo.sqrtPriceX96),
              balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
              balancesAbSigner: await getBalancesAB(signer.address),
              balancesAbSigner1: await getBalancesAB(signer1.address),
              balancesAbSigner2: await getBalancesAB(signer2.address),
            }
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

          SWAP_SETS.forEach(function (swapParams: ISwapParams) {
            describe(`Swap ${swapParams.tag}`, () => {
              let snapshot3: string;
              let afterSwap: IState;
              before(async function () {
                console.log("Prepare to swap");
                snapshot3 = await TimeUtils.snapshot();

                const amountToSwap = parseUnits(swapParams.swapAmount, swapParams.swapTokenA ? decimalsA : decimalsB);

                if (swapParams.swapTokenA) {
                  await tokenA.connect(signer2).approve(uniswapV3Callee.address, amountToSwap);
                } else {
                  await tokenB.connect(signer2).approve(uniswapV3Callee.address, amountToSwap);
                }

                await uniswapV3Callee.connect(signer2).swap(
                  pool.address,
                  signer2.address,
                  swapParams.swapTokenA ? tokenA.address : tokenB.address,
                  amountToSwap
                );
                console.log("Swap is done");

                const {sqrtPriceX96, tick} = await pool.slot0();
                afterSwap = {
                  mainPool: await getCurrentWideRangeState(sqrtPriceX96),
                  tick,
                  sqrtPriceX96,
                  narrowRange: await getCurrentNarrowRangeState(tokenSeller, sqrtPriceX96),
                  balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                  balancesAbSigner: await getBalancesAB(signer.address),
                  balancesAbSigner1: await getBalancesAB(signer1.address),
                  balancesAbSigner2: await getBalancesAB(signer2.address),
                }
              });
              after(async function () {
                await TimeUtils.rollback(snapshot3);
              });

              it("todo pool should have expected liquidity and prices", async () => {
                const liquidity = await pool.liquidity();
                console.log("liquidity", liquidity);
                expect(liquidity).gt(0);

                const priceA = await facadeUni.getPrice(pool.address, tokenA.address);
                const priceB = await facadeUni.getPrice(pool.address, tokenB.address);
                console.log("priceA", priceA);
                console.log("priceB", priceB);
                console.log("slot0 after swap", await pool.slot0());
              });

              describe("refreshPool", () => {
                let snapshot4: string;
                let afterRefresh: IState;
                before(async function () {
                  console.log("Prepare to refresh the pool");
                  snapshot4 = await TimeUtils.snapshot();

                  await tokenSeller.refreshPool();
                  console.log("The pool is refreshed");

                  const {sqrtPriceX96, tick} = await pool.slot0();
                  afterRefresh = {
                    mainPool: await getCurrentWideRangeState(sqrtPriceX96),
                    tick,
                    sqrtPriceX96,
                    narrowRange: await getCurrentNarrowRangeState(tokenSeller, sqrtPriceX96),
                    balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                    balancesAbSigner: await getBalancesAB(signer.address),
                    balancesAbSigner1: await getBalancesAB(signer1.address),
                    balancesAbSigner2: await getBalancesAB(signer2.address),
                  }
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot4);
                });

                it("todo pool should have expected liquidity and prices", async () => {
                  const liquidity = await pool.liquidity();
                  console.log("liquidity", liquidity);
                  expect(liquidity).gt(0);

                  const priceA = await facadeUni.getPrice(pool.address, tokenA.address);
                  const priceB = await facadeUni.getPrice(pool.address, tokenB.address);
                  console.log("priceA", priceA);
                  console.log("priceB", priceB);
                  console.log("slot0 after swap", await pool.slot0());
                });

                describe("exit from pool", () => {
                  let snapshot5: string;
                  before(async function () {
                    console.log("Prepare to exit from the pool");
                    snapshot5 = await TimeUtils.snapshot();

                    await tokenSeller.closePosition();
                    await tokenSeller.withdraw(signer.address, tokenA.address, await tokenSeller.balanceOf(tokenA.address));
                    await tokenSeller.withdraw(signer.address, tokenB.address, await tokenSeller.balanceOf(tokenB.address));

                    await pool.connect(signer1).burn(lowerTickWide, upperTickWide, liquidityAmountWide);
                    await pool.connect(signer1).collect(signer1.address, lowerTickWide, upperTickWide, Misc.MAX_UINT_128, Misc.MAX_UINT_128);
                    console.log("Pool is empty");

                    const {sqrtPriceX96, tick} = await pool.slot0();
                    const final = {
                      mainPool: await getCurrentWideRangeState(sqrtPriceX96),
                      tick,
                      sqrtPriceX96,
                      narrowRange: await getCurrentNarrowRangeState(tokenSeller, sqrtPriceX96),
                      balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                      balancesAbSigner: await getBalancesAB(signer.address),
                      balancesAbSigner1: await getBalancesAB(signer1.address),
                      balancesAbSigner2: await getBalancesAB(signer2.address),
                    }

                    registerResults(states, {
                      inputParams: {mainPool, narrowRange, swapParams},
                      start,
                      init,
                      afterSwap,
                      afterRefresh,
                      final
                    });
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshot5);
                  });

                  it("pool should have expected liquidity and prices", async () => {
                    const liquidity = await pool.liquidity();
                    console.log("liquidity", liquidity);
                    expect(liquidity).eq(0);
                  });
                });
              });
            });
          });
        });
      });

      describe.skip("study: narrow pool", () => {
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
            const tickSpacing = await facadeUni.getTickSpacing(mainPool.fee);
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
            await tokenA.approve(uniswapV3Callee.address, requiredAmounts.amount0);
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
            const tickSpacing = await facadeUni.getTickSpacing(mainPool.fee);
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
            await tokenA.approve(uniswapV3Callee.address, amountA); // requiredAmounts.amount0);
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
    });
  });
});