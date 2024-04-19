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
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {expect} from "chai";
import {Misc} from "../../scripts/utils/Misc";
import {writeFileSyncRestoreFolder} from "../baseUT/utils/FileUtils";
import {writeFileSync} from "fs";
import {Univ3TokenSellerLib} from "../../typechain/contracts/token-seller/Univ3TokenSeller";
import TokenSellerConfigStruct = Univ3TokenSellerLib.TokenSellerConfigStruct;
import {MockHelper} from "../baseUT/helpers/MockHelper";

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
    saveToCsv(states, "");
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

  interface IDerivedValues {
    tickLimit: number;
    tickSpacing: number;
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
    needToRefresh: boolean;
    isPositionOpened: boolean;

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
    derivedValues: {
      tickLimit: number;
      tickSpacing: number;
    }
    start: IState;
    init: IState;
    afterSwap: IState[];
    afterRefresh: IState;
    final: IState;
  }

  interface IWidePoolData {
    lowerTick: number,
    upperTick: number,
    liquidityAmount: BigNumber
  }

  interface IInitPoolResults {
    sqrtPriceX96: BigNumber,
    amountA: BigNumber,
    amountB: BigNumber
  }
  //endregion Data types

  //region Utils
  async function getCurrentNarrowRangeState(mainPool: IMainPoolParams, tokenSeller: Univ3TokenSeller, sqrtPriceX96: BigNumber): Promise<IRangeState> {
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

  async function getCurrentWideRangeState(
    mainPool: IMainPoolParams,
    sqrtPriceX96: BigNumber,
    lowerTickWide: number,
    upperTickWide: number,
    liquidityAmountWide: BigNumber
  ): Promise<IRangeState> {
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

  async function initializePool(mainPool: IMainPoolParams, pool: UniswapV3Pool): Promise<IInitPoolResults> {
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

  async function putLiquidityToWideRange(
    pool: UniswapV3Pool,
    mainPool: IMainPoolParams,
    sqrtPriceX96: BigNumber,
    amountA: BigNumber,
    amountB: BigNumber,
  ): Promise<IWidePoolData> {
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

    return {lowerTick, upperTick, liquidityAmount};
  }

  async function createTokenSeller(
    pool: UniswapV3Pool,
    mainPool: IMainPoolParams,
    narrowRange: INarrowRangeParams,
    openPosition: boolean = true
  ): Promise<Univ3TokenSeller> {
    const poolInfo = await pool.slot0();

    const minSqrtPriceX96 = mainPool.poolSwapTokens
      ? poolInfo.sqrtPriceX96
        .mul(parseUnits("1", 18))
        .div(parseUnits(narrowRange.sqrtMinPriceRatio, 18))
      : poolInfo.sqrtPriceX96
        .mul(parseUnits(narrowRange.sqrtMinPriceRatio, 18))
        .div(parseUnits("1", 18));

    const tokenSellerConfig: TokenSellerConfigStruct = {
      amountA: parseUnits(narrowRange.amountA, decimalsA),
      tickRangeSize: narrowRange.tickRangeSize,
      tickLimit: await facadeUni._getTickAtSqrtRatio(minSqrtPriceX96),
      thresholdTokenB: parseUnits(narrowRange.thresholdTokenB, decimalsB),
      thresholdRatio: parseUnits(narrowRange.thresholdRatio, 5),
      thresholdLastRefreshPoolSec: 0 // todo
    }

    const tokenSeller = (await DeployerUtils.deployContract(
      signer,
      "Univ3TokenSeller",
      tokenA.address, tokenB.address, pool.address, tokenSellerConfig, signer.address,
    )) as Univ3TokenSeller;
    console.log("Token seller is created");

    if (openPosition) {
      await tokenA.transfer(tokenSeller.address, parseUnits(narrowRange.balanceA, decimalsA));
      await tokenSeller.openPosition();
      console.log("Token seller opens a position");
    }

    return tokenSeller;
  }
  //endregion Utils

  //region Stat utils
  async function getBalancesAB(user: string): Promise<number[]> {
    return [
      +formatUnits(await tokenA.balanceOf(user), decimalsA),
      +formatUnits(await tokenB.balanceOf(user), decimalsB),
    ]
  }

  function registerResults(states: IStateHistory[], state: IStateHistory) {
    states.push(state);
    // saveToCsv([state], states.length.toString());
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
      "needToRefresh",
      "isPositionOpened",
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

      state.needToRefresh ? 1 : 0,
      state.isPositionOpened ? 1 : 0,
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

      "tickLimit",
      "tickSpacing",
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

      state.derivedValues.tickLimit,
      state.derivedValues.tickSpacing
    ];
  }

  function saveToCsv(states: IStateHistory[], tag?: string) {
    const pathOut = `${pathWithoutExt}${tag}.csv`
    const firstRow = ["param"];
    for (let i = 0; i < states.length; ++i) {
      const items = [
        `start:${i}`,
        `init:${i}`,
        ...states[i].afterSwap.map((x, index) => `afterSwap:${i}:${index}`),
        `afterRefresh:${i}`,
        `final:${i}`,
      ];
      firstRow.push(...items);
    }
    writeFileSyncRestoreFolder(pathOut, firstRow.join(";") + '\n', { encoding: 'utf8', flag: 'w'});

    const column0 = stateToArrayHeaders();
    const columns: (string | number | BigNumber)[][] = [];
    for (let i = 0; i < states.length; ++i) {
      columns.push(
        stateToArray(states[i].start),
        stateToArray(states[i].init),
      );
      columns.push(
        ...states[i].afterSwap.map(x => stateToArray(x)),
      );
      columns.push(
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
      for (let j = 0; j < data.length; ++j) {
        const x = data[j];
        line.push(x[i]);
        line.push(""); // init
        line.push(...states[j].afterSwap.map(_ => ""));
        line.push(""); // afterRefresh
        line.push(""); // final
      }
      writeFileSync(
        pathOut,
        line.join(';') + '\n',
        { encoding: 'utf8', flag: 'a' },
      );
    }

  }
  //endregion Stat utils

  describe("refreshPool (init => {swap => refreshPool} * N => withdraw)", () => {
    //region Test data
    const MAIN_POOLS: IMainPoolParams[] = [
// Main set
      {tag: "price 1:1,0.01%", fee: 100, amountA: "1000", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: false},
      {tag: "price 1000:1,0.01%", fee: 100, amountA: "1000", amountB: "1", pricesRange: ["0.01", "100"], poolSwapTokens: false},
      {tag: "price 1:1000,0.01%", fee: 100, amountA: "1", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: false},

      {tag: "price 1:1, swapped, 0.03%", fee: 3000, amountA: "1000", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: true},
      {tag: "price 1:1000, swapped, 0.03%", fee: 3000, amountA: "1", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: true},
      {tag: "price 1000:1, swapped, 0.03%", fee: 3000, amountA: "1000", amountB: "1", pricesRange: ["0.01", "100"], poolSwapTokens: true},

// Additional set (study)
      // {tag: "price 1:1, swapped, 0.01%", fee: 100, amountA: "1000", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: true},
      // {tag: "price 1:1000, swapped, 0.01%", fee: 100, amountA: "1", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: true},
      // {tag: "price 1000:1, swapped, 0.01%", fee: 100, amountA: "1000", amountB: "1", pricesRange: ["0.01", "100"], poolSwapTokens: true},

      // {tag: "price 1000:1,1%", fee: 10000, amountA: "1000", amountB: "1", pricesRange: ["0.01", "100"], poolSwapTokens: false},
      // {tag: "price 1:1,1%", fee: 10000, amountA: "1000", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: false},
      // {tag: "price 1:1000,1%", fee: 10000, amountA: "1", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: false},
      // {tag: "price 1000:1,0.3%", fee: 3000, amountA: "1000", amountB: "1", pricesRange: ["0.01", "100"], poolSwapTokens: false},
      // {tag: "price 1:1,0.3%", fee: 3000, amountA: "1000", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: false},
      // {tag: "price 1:1000,0.3%", fee: 3000, amountA: "1", amountB: "1000", pricesRange: ["0.01", "100"], poolSwapTokens: false},
    ];

    const NARROW_RANGES: INarrowRangeParams[] = [
      {tag: "10ths,5", balanceA: "50000", amountA: "10000", sqrtMinPriceRatio: "0.1", thresholdRatio: "0", thresholdTokenB: "0", tickRangeSize: 5},
      // {tag: "100ths,3", balanceA: "500000", amountA: "100000", sqrtMinPriceRatio: "0.01", thresholdRatio: "0", thresholdTokenB: "0", tickRangeSize: 3},
    ];

    const SWAP_SETS: ISwapParams[] = [
      {tag: "A1000", swapTokenA: true, swapAmount: "1000"},
      {tag: "B1000", swapTokenA: false, swapAmount: "1000"},
      // {tag: "B10000", swapTokenA: false, swapAmount: "10000"},
      // {tag: "A10000", swapTokenA: true, swapAmount: "10000"},
      // {tag: "B333", swapTokenA: false, swapAmount: "333"},
      // {tag: "A333", swapTokenA: true, swapAmount: "333"},
    ];

    const MULTI_SWAPS_THRESHOLD_RATIO: string[] = ["0.01", "0.1", "0.2", "0.5", "0.7", "1"];
    const MULTI_SWAPS_AMOUNTS_B: string[] = ["0.1", "0.5", "1", "5", "10", "50", "100", "500", "1000", "5000", "10000"];
    //endregion Test data

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
            needToRefresh: false,
            isPositionOpened: false,
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

          const {sqrtPriceX96, amountA, amountB} = await initializePool(mainPool, pool);

          const {lowerTick, upperTick, liquidityAmount} = await putLiquidityToWideRange(
            pool,
            mainPool,
            sqrtPriceX96,
            amountA,
            amountB
          );

          lowerTickWide = lowerTick;
          upperTickWide = upperTick;
          liquidityAmountWide = liquidityAmount;
          sqrtPriceX96Wide = sqrtPriceX96;

          wideRangeState0 = await getCurrentWideRangeState(mainPool, sqrtPriceX96, lowerTickWide, upperTickWide, liquidityAmountWide);
          console.log("Main pool is initialized");
        });

        after(async function () {
          await TimeUtils.rollback(snapshot1);
        });

        it("pool should have expected liquidity", async () => {
          const liquidity = await pool.liquidity();
          console.log("liquidity", liquidity);
          expect(liquidity).gt(0);
          expect(wideRangeState0.amountsAB[0]).approximately(Number(mainPool.amountA), 1);
          expect(wideRangeState0.amountsAB[1]).approximately(Number(mainPool.amountB), 1);
        });

        NARROW_RANGES.forEach(function (narrowRange: INarrowRangeParams) {
          describe(`Narrow range: ${narrowRange.tag}`, () => {
            let tokenSeller: Univ3TokenSeller;
            let snapshot2: string;
            let init: IState;
            let derivedValues: IDerivedValues;
            before(async function () {
              console.log("Set up token seller");
              snapshot2 = await TimeUtils.snapshot();

              tokenSeller = await createTokenSeller(pool, mainPool, narrowRange);

              const poolInfo = await pool.slot0();
              init = {
                mainPool: wideRangeState0,
                tick: poolInfo.tick,
                sqrtPriceX96: poolInfo.sqrtPriceX96,
                needToRefresh: await tokenSeller.needToRefresh(),
                isPositionOpened: await tokenSeller.isPositionOpened(),
                narrowRange: await getCurrentNarrowRangeState(mainPool, tokenSeller, poolInfo.sqrtPriceX96),
                balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                balancesAbSigner: await getBalancesAB(signer.address),
                balancesAbSigner1: await getBalancesAB(signer1.address),
                balancesAbSigner2: await getBalancesAB(signer2.address),
              }

              const config = await tokenSeller.config();
              derivedValues = {
                tickLimit: config.tickLimit,
                tickSpacing: await tokenSeller.tickSpacing(),
              }
            });
            after(async function () {
              await TimeUtils.rollback(snapshot2);
            });

            it("pool should have expected liquidity", async () => {
              const liquidity = await pool.liquidity();
              console.log("liquidity", liquidity);
              expect(liquidity).gt(0);
              expect(init.narrowRange.amountsAB[0]).approximately(Number(narrowRange.amountA), 1);
              expect(init.narrowRange.amountsAB[1]).eq(0);
            });
            it("narrow range should have expected tick range", async () => {
              expect(
                init.narrowRange.upperTick - init.narrowRange.lowerTick
              ).eq(
                narrowRange.tickRangeSize * derivedValues.tickSpacing
              )
            });
            it("token seller should have expected balances", async () => {
              expect(init.balancesAbTokenSeller[0]).approximately(Number(narrowRange.balanceA) - Number(narrowRange.amountA), 1e-5);
              expect(init.balancesAbTokenSeller[1]).eq(0);
            });
            it("should have expected state", async () => {
              expect(init.needToRefresh).eq(false);
              expect(init.isPositionOpened).eq(true);
            });

            // test single swaps
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
                    mainPool: await getCurrentWideRangeState(mainPool, sqrtPriceX96, lowerTickWide, upperTickWide, liquidityAmountWide),
                    tick,
                    sqrtPriceX96,
                    needToRefresh: await tokenSeller.needToRefresh(),
                    isPositionOpened: await tokenSeller.isPositionOpened(),
                    narrowRange: await getCurrentNarrowRangeState(mainPool, tokenSeller, sqrtPriceX96),
                    balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                    balancesAbSigner: await getBalancesAB(signer.address),
                    balancesAbSigner1: await getBalancesAB(signer1.address),
                    balancesAbSigner2: await getBalancesAB(signer2.address),
                  }
                  console.log("init", init)
                  console.log("afterSwap", afterSwap)
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot3);
                });

                it("swapper should receive positive amount of the target token", async () => {
                  const indexTargetToken = swapParams.swapTokenA ? 1 : 0;
                  expect(afterSwap.balancesAbSigner2[indexTargetToken]).gt(init.balancesAbSigner2[indexTargetToken]);
                });
                it("swapper should spend expected amount of the source token", async () => {
                  const indexSourceToken = swapParams.swapTokenA ? 0 : 1;
                  expect(
                    afterSwap.balancesAbSigner2[indexSourceToken]
                  ).eq(
                    init.balancesAbSigner2[indexSourceToken] - Number(swapParams.swapAmount)
                  );
                });
                it("should have expected state", async () => {
                  if (Math.abs(afterSwap.tick - init.tick) > derivedValues.tickSpacing) {
                    expect(afterSwap.needToRefresh).eq(true);
                  }
                  expect(afterSwap.isPositionOpened).eq(true);
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
                      mainPool: await getCurrentWideRangeState(mainPool, sqrtPriceX96, lowerTickWide, upperTickWide, liquidityAmountWide),
                      tick,
                      sqrtPriceX96,
                      needToRefresh: await tokenSeller.needToRefresh(),
                      isPositionOpened: await tokenSeller.isPositionOpened(),
                      narrowRange: await getCurrentNarrowRangeState(mainPool, tokenSeller, sqrtPriceX96),
                      balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                      balancesAbSigner: await getBalancesAB(signer.address),
                      balancesAbSigner1: await getBalancesAB(signer1.address),
                      balancesAbSigner2: await getBalancesAB(signer2.address),
                    }
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshot4);
                  });

                  it("should not change current price and current tick", async () => {
                    expect(afterRefresh.sqrtPriceX96).eq(afterSwap.sqrtPriceX96);
                    expect(afterRefresh.tick).eq(afterSwap.tick);
                  });
                  it("new tick range should have expected size", async () => {
                    expect(
                      afterRefresh.narrowRange.upperTick - afterRefresh.narrowRange.lowerTick
                    ).eq(
                      derivedValues.tickSpacing * narrowRange.tickRangeSize
                    );
                  });
                  it("new tick range should have expected bounds", async () => {
                    if (mainPool.poolSwapTokens) {
                      expect(
                        (afterRefresh.tick - afterRefresh.narrowRange.upperTick) <= derivedValues.tickSpacing
                        || afterRefresh.tick > derivedValues.tickLimit
                      ).eq(true);
                    } else {
                      expect(
                        (afterRefresh.narrowRange.lowerTick - afterRefresh.tick) < derivedValues.tickSpacing
                        // special case: lowerTick - tickSpacing === tick, but price(lowerTick) < price(tick)
                        || (afterRefresh.narrowRange.lowerTick - afterRefresh.tick) === derivedValues.tickSpacing
                        || afterRefresh.tick < derivedValues.tickLimit
                      ).eq(true);
                    }
                  });
                  if (!swapParams.swapTokenA) {
                    it("tokenSeller should withdraw some amount of token B", async () => {
                      if (Math.abs(afterSwap.tick - init.tick) > derivedValues.tickSpacing) {
                        expect(afterRefresh.balancesAbSigner[1]).gt(afterSwap.balancesAbSigner[1]);
                        expect(afterRefresh.balancesAbTokenSeller[1]).eq(0);
                      }
                    });
                    it("tokenSeller should deposit additional amount of token A", async () => {
                      if (Math.abs(afterSwap.tick - init.tick) > derivedValues.tickSpacing) {
                        expect(afterRefresh.balancesAbTokenSeller[0]).lt(afterSwap.balancesAbTokenSeller[0]);
                      }
                    });
                    it("tokenSeller should deposit token A only", async () => {
                      if (Math.abs(afterSwap.tick - init.tick) > derivedValues.tickSpacing) {
                        expect(afterRefresh.narrowRange.liquidityAmount).gt(0);
                        expect(afterRefresh.narrowRange.amountsAB[0]).eq(Number(narrowRange.amountA));
                        expect(afterRefresh.narrowRange.amountsAB[1]).eq(0);
                      }
                    });
                  }
                  it("should have expected state", async () => {
                    expect(afterRefresh.needToRefresh).eq(false);
                    expect(afterRefresh.isPositionOpened).eq(true);
                  });

                  describe("exit from pool", () => {
                    let snapshot5: string;
                    let final: IState;
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
                      final = {
                        mainPool: await getCurrentWideRangeState(mainPool, sqrtPriceX96, 0, 0, BigNumber.from(0)),
                        tick,
                        sqrtPriceX96,
                        needToRefresh: await tokenSeller.needToRefresh(),
                        isPositionOpened: await tokenSeller.isPositionOpened(),
                        narrowRange: await getCurrentNarrowRangeState(mainPool, tokenSeller, sqrtPriceX96),
                        balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                        balancesAbSigner: await getBalancesAB(signer.address),
                        balancesAbSigner1: await getBalancesAB(signer1.address),
                        balancesAbSigner2: await getBalancesAB(signer2.address),
                      }

                      registerResults(states, {
                        inputParams: {mainPool, narrowRange, swapParams},
                        derivedValues,
                        start,
                        init,
                        afterSwap: [afterSwap],
                        afterRefresh,
                        final
                      });
                    });
                    after(async function () {
                      await TimeUtils.rollback(snapshot5);
                    });

                    it("pool should have NO liquidity", async () => {
                      expect(await pool.liquidity()).eq(0);
                    });
                    it("tokenSeller should not have any tokens", async () => {
                      expect(await final.balancesAbTokenSeller[0]).eq(0);
                      expect(await final.balancesAbTokenSeller[1]).eq(0);
                    });
                    it("total amount of token A should be equal to the initial amount", async () => {
                      expect(
                        final.balancesAbSigner[0] + final.balancesAbSigner1[0] + final.balancesAbSigner2[0]
                      ).approximately(
                        start.balancesAbSigner[0] + start.balancesAbSigner1[0] + start.balancesAbSigner2[0],
                        1e-5
                      );
                    });
                    it("total amount of token B should be equal to the initial amount", async () => {
                      expect(
                        final.balancesAbSigner[1] + final.balancesAbSigner1[1] + final.balancesAbSigner2[1],
                      ).approximately(
                        start.balancesAbSigner[1] + start.balancesAbSigner1[1] + start.balancesAbSigner2[1],
                        1e5
                      );
                    });
                    it("swapper should spend expected amount of the source token", async () => {
                      const indexSourceToken = swapParams.swapTokenA ? 0 : 1;
                      expect(
                        final.balancesAbSigner2[indexSourceToken]
                      ).eq(
                        start.balancesAbSigner2[indexSourceToken] - Number(swapParams.swapAmount)
                      );
                    });
                    it("swapper should receive positive amount of the target token", async () => {
                      const indexTargetToken = swapParams.swapTokenA ? 1 : 0;
                      expect(final.balancesAbSigner2[indexTargetToken]).gt(start.balancesAbSigner2[indexTargetToken]);
                    });
                    it("both signer and pool-owner should receive swapped amount of the target token", async () => {
                      const indexSourceToken = swapParams.swapTokenA ? 0 : 1;
                      expect(
                        final.balancesAbSigner[indexSourceToken] + final.balancesAbSigner1[indexSourceToken]
                        - (start.balancesAbSigner[indexSourceToken] + start.balancesAbSigner1[indexSourceToken])
                      ).approximately(Number(swapParams.swapAmount), 1e-3);
                      expect(final.balancesAbSigner[indexSourceToken]).gte(start.balancesAbSigner[indexSourceToken]);
                      expect(final.balancesAbSigner1[indexSourceToken]).gt(start.balancesAbSigner1[indexSourceToken]);
                    });
                    it("should have expected state", async () => {
                      expect(final.needToRefresh).eq(false);
                      expect(final.isPositionOpened).eq(false);
                    });
                  });
                });
              });
            });

            // test multiple swaps with various values of threshold-ratio
            MULTI_SWAPS_THRESHOLD_RATIO.forEach(function (thresholdRatio: string) {
              let listAfterSwap: IState[];
              let afterSwap: IState;
              let totalSwapAmount: number;
              describe(`ThresholdRatio=${thresholdRatio}, multiswap B=>A up to needRefresh=true`, () => {
                let snapshot3: string;
                before(async function () {
                  snapshot3 = await TimeUtils.snapshot();
                  listAfterSwap = [];

                  const tokenSellerConfig = await tokenSeller.config();
                  await tokenSeller.setConfig({
                    ...tokenSellerConfig,
                    thresholdRatio: parseUnits(thresholdRatio, 5)
                  })

                  totalSwapAmount = 0;
                  for (const amountB of MULTI_SWAPS_AMOUNTS_B) {
                    totalSwapAmount += Number(amountB);
                    const amountToSwap = parseUnits(amountB, decimalsB);
                    await tokenB.connect(signer2).approve(uniswapV3Callee.address, amountToSwap);
                    await uniswapV3Callee.connect(signer2).swap(pool.address, signer2.address, tokenB.address, amountToSwap);
                    const {sqrtPriceX96, tick} = await pool.slot0();
                    const state = {
                      mainPool: await getCurrentWideRangeState(mainPool, sqrtPriceX96, lowerTickWide, upperTickWide, liquidityAmountWide),
                      tick,
                      sqrtPriceX96,
                      needToRefresh: await tokenSeller.needToRefresh(),
                      isPositionOpened: await tokenSeller.isPositionOpened(),
                      narrowRange: await getCurrentNarrowRangeState(mainPool, tokenSeller, sqrtPriceX96),
                      balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                      balancesAbSigner: await getBalancesAB(signer.address),
                      balancesAbSigner1: await getBalancesAB(signer1.address),
                      balancesAbSigner2: await getBalancesAB(signer2.address),
                    }
                    listAfterSwap.push(state);
                    afterSwap = state;
                    if (await tokenSeller.needToRefresh()) break;
                  }
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot3);
                });
                it("swapper should receive positive amount of the target token", async () => {
                  const indexTargetToken = 0; // token A
                  expect(afterSwap.balancesAbSigner2[indexTargetToken]).gt(init.balancesAbSigner2[indexTargetToken]);
                });
                it("swapper should spend expected amount of the source token", async () => {
                  const indexSourceToken = 1; // token B
                  expect(
                    afterSwap.balancesAbSigner2[indexSourceToken]
                  ).eq(
                    init.balancesAbSigner2[indexSourceToken] - totalSwapAmount
                  );
                });
                it("should have expected state", async () => {
                  if (Math.abs(afterSwap.tick - init.tick) > derivedValues.tickSpacing) {
                    expect(afterSwap.needToRefresh).eq(true);
                  }
                  expect(afterSwap.isPositionOpened).eq(true);
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
                      mainPool: await getCurrentWideRangeState(mainPool, sqrtPriceX96, lowerTickWide, upperTickWide, liquidityAmountWide),
                      tick,
                      sqrtPriceX96,
                      needToRefresh: await tokenSeller.needToRefresh(),
                      isPositionOpened: await tokenSeller.isPositionOpened(),
                      narrowRange: await getCurrentNarrowRangeState(mainPool, tokenSeller, sqrtPriceX96),
                      balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                      balancesAbSigner: await getBalancesAB(signer.address),
                      balancesAbSigner1: await getBalancesAB(signer1.address),
                      balancesAbSigner2: await getBalancesAB(signer2.address),
                    }
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshot4);
                  });

                  it("should not change current price and current tick", async () => {
                    expect(afterRefresh.sqrtPriceX96).eq(afterSwap.sqrtPriceX96);
                    expect(afterRefresh.tick).eq(afterSwap.tick);
                  });
                  it("new tick range should have expected size", async () => {
                    expect(
                      afterRefresh.narrowRange.upperTick - afterRefresh.narrowRange.lowerTick
                    ).eq(
                      derivedValues.tickSpacing * narrowRange.tickRangeSize
                    );
                  });
                  it("new tick range should have expected bounds", async () => {
                    if (mainPool.poolSwapTokens) {
                      expect(
                        (afterRefresh.tick - afterRefresh.narrowRange.upperTick) <= derivedValues.tickSpacing
                        || afterRefresh.tick > derivedValues.tickLimit
                      ).eq(true);
                    } else {
                      expect(
                        (afterRefresh.narrowRange.lowerTick - afterRefresh.tick) < derivedValues.tickSpacing
                        // special case: lowerTick - tickSpacing === tick, but price(lowerTick) < price(tick)
                        || (afterRefresh.narrowRange.lowerTick - afterRefresh.tick) === derivedValues.tickSpacing
                        || afterRefresh.tick < derivedValues.tickLimit
                      ).eq(true);
                    }
                  });
                  it("tokenSeller should withdraw some amount of token B", async () => {
                    if (Math.abs(afterSwap.tick - init.tick) > derivedValues.tickSpacing) {
                      expect(afterRefresh.balancesAbSigner[1]).gt(afterSwap.balancesAbSigner[1]);
                      expect(afterRefresh.balancesAbTokenSeller[1]).eq(0);
                    }
                  });
                  it("tokenSeller should deposit additional amount of token A", async () => {
                    if (Math.abs(afterSwap.tick - init.tick) > derivedValues.tickSpacing) {
                      expect(afterRefresh.balancesAbTokenSeller[0]).lt(afterSwap.balancesAbTokenSeller[0]);
                    }
                  });
                  it("tokenSeller should deposit token A only", async () => {
                    if (Math.abs(afterSwap.tick - init.tick) > derivedValues.tickSpacing) {
                      expect(afterRefresh.narrowRange.liquidityAmount).gt(0);
                      expect(afterRefresh.narrowRange.amountsAB[1]).eq(0);
                      expect(afterRefresh.narrowRange.amountsAB[0]).approximately(Number(narrowRange.amountA), 1e-5);
                    }
                  });
                  it("should have expected state", async () => {
                    expect(afterRefresh.needToRefresh).eq(false);
                    expect(afterRefresh.isPositionOpened).eq(true);
                  });

                  describe("exit from pool", () => {
                    let snapshot5: string;
                    let final: IState;
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
                      final = {
                        mainPool: await getCurrentWideRangeState(mainPool, sqrtPriceX96, 0, 0, BigNumber.from(0)),
                        tick,
                        sqrtPriceX96,
                        needToRefresh: await tokenSeller.needToRefresh(),
                        isPositionOpened: await tokenSeller.isPositionOpened(),
                        narrowRange: await getCurrentNarrowRangeState(mainPool, tokenSeller, sqrtPriceX96),
                        balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                        balancesAbSigner: await getBalancesAB(signer.address),
                        balancesAbSigner1: await getBalancesAB(signer1.address),
                        balancesAbSigner2: await getBalancesAB(signer2.address),
                      }

                      registerResults(states, {
                        inputParams: {
                          mainPool,
                          narrowRange: {
                            ...narrowRange,
                            thresholdRatio,
                          },
                          swapParams: {
                            tag: `${listAfterSwap.length} swaps`,
                            swapTokenA: false,
                            swapAmount: totalSwapAmount.toString(),
                          }
                        },
                        derivedValues,
                        start,
                        init,
                        afterSwap: listAfterSwap,
                        afterRefresh,
                        final
                      });
                    });
                    after(async function () {
                      await TimeUtils.rollback(snapshot5);
                    });

                    it("pool should have NO liquidity", async () => {
                      expect(await pool.liquidity()).eq(0);
                    });
                    it("tokenSeller should not have any tokens", async () => {
                      expect(await final.balancesAbTokenSeller[0]).eq(0);
                      expect(await final.balancesAbTokenSeller[1]).eq(0);
                    });
                    it("total amount of token A should be equal to the initial amount", async () => {
                      expect(
                        final.balancesAbSigner[0] + final.balancesAbSigner1[0] + final.balancesAbSigner2[0]
                      ).approximately(
                        start.balancesAbSigner[0] + start.balancesAbSigner1[0] + start.balancesAbSigner2[0],
                        1e-5
                      );
                    });
                    it("total amount of token B should be equal to the initial amount", async () => {
                      expect(
                        final.balancesAbSigner[1] + final.balancesAbSigner1[1] + final.balancesAbSigner2[1],
                      ).approximately(
                        start.balancesAbSigner[1] + start.balancesAbSigner1[1] + start.balancesAbSigner2[1],
                        1e5
                      );
                    });
                    it("swapper should spend expected amount of the source token", async () => {
                      const indexSourceToken = 1; // token B
                      expect(
                        final.balancesAbSigner2[indexSourceToken]
                      ).eq(
                        start.balancesAbSigner2[indexSourceToken] - totalSwapAmount
                      );
                    });
                    it("swapper should receive positive amount of the target token", async () => {
                      const indexTargetToken = 0; // token A
                      expect(final.balancesAbSigner2[indexTargetToken]).gt(start.balancesAbSigner2[indexTargetToken]);
                    });
                    it("both signer and pool-owner should receive swapped amount of the target token", async () => {
                      const indexSourceToken = 1; // token B
                      expect(
                        final.balancesAbSigner[indexSourceToken] + final.balancesAbSigner1[indexSourceToken]
                        - (start.balancesAbSigner[indexSourceToken] + start.balancesAbSigner1[indexSourceToken])
                      ).approximately(totalSwapAmount, 1e-3);
                      expect(final.balancesAbSigner[indexSourceToken]).gte(start.balancesAbSigner[indexSourceToken]);
                      expect(final.balancesAbSigner1[indexSourceToken]).gt(start.balancesAbSigner1[indexSourceToken]);
                    });
                    it("should have expected state", async () => {
                      expect(final.needToRefresh).eq(false);
                      expect(final.isPositionOpened).eq(false);
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

  describe("unit tests", () => {
    const mainPool: IMainPoolParams = {
        tag: "price 1:1, swapped, 0.03%",
        fee: 3000,
        amountA: "1000",
        amountB: "1000",
        pricesRange: ["0.01", "100"],
        poolSwapTokens: true
    };
    const narrowRange: INarrowRangeParams = {
      tag: "test",
      thresholdTokenB: "0",
      sqrtMinPriceRatio: "0.1",
      thresholdRatio: "0.01",
      tickRangeSize: 3,
      amountA: "10000",
      balanceA: "20000"
    }

    let snapshotEach: string;
    let snapshot1: string;
    let pool: UniswapV3Pool;
    let tokenSeller: Univ3TokenSeller;

    before(async function () {
        snapshot1 = await TimeUtils.snapshot();

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

        // initialize pool, put liquidity into wide range
        const {sqrtPriceX96, amountA, amountB} = await initializePool(mainPool, pool);
        await putLiquidityToWideRange(
          pool,
          mainPool,
          sqrtPriceX96,
          amountA,
          amountB
        );

        // create token seller, put liquidity into narrow range
        tokenSeller = await createTokenSeller(pool, mainPool, narrowRange, false);
    });
    after(async function () {
      await TimeUtils.rollback(snapshot1);
    });
    beforeEach(async function () {
      snapshotEach = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotEach);
    });

    describe("refreshPool - threshold by time", () => {
      it("should skip refreshPool if not enough time passed since last call of refreshPool", async () => {
        const tokenSellerConfig = await tokenSeller.config();
        const thresholdLastRefreshPoolSec = 2; // sec
        await tokenSeller.setConfig({
          ...tokenSellerConfig,
          thresholdRatio: parseUnits("0", 5),
          thresholdLastRefreshPoolSec
        })

        await tokenA.transfer(tokenSeller.address, parseUnits(narrowRange.balanceA, decimalsA));
        await tokenSeller.openPosition();

        const needToRefreshBefore = await tokenSeller.needToRefresh();

        // make first swap
        const amountToSwap = parseUnits("10000", decimalsA);
        await tokenA.connect(signer2).approve(uniswapV3Callee.address, amountToSwap);
        await uniswapV3Callee.connect(signer2).swap(pool.address, signer2.address, tokenA.address, amountToSwap);

        // make first refreshPool
        await tokenSeller.refreshPool();
        const needToRefreshAfterFirstRefreshPool = await tokenSeller.needToRefresh();

        // make second swap
        await tokenA.connect(signer2).approve(uniswapV3Callee.address, amountToSwap);
        await uniswapV3Callee.connect(signer2).swap(pool.address, signer2.address, tokenA.address, amountToSwap);

        const needToRefreshAfterSecondSwap = await tokenSeller.needToRefresh();

        function delay(ms: number) {
          return new Promise(resolve => setTimeout(resolve, ms));
        }

        await delay(3000);
        await tokenSeller.setOwner(await tokenSeller.owner());
        const needToRefreshAfter = await tokenSeller.needToRefresh();

        expect(needToRefreshBefore).eq(false);
        expect(needToRefreshAfterFirstRefreshPool).eq(false);
        expect(needToRefreshAfterSecondSwap).eq(false);
        expect(needToRefreshAfter).eq(true);
      });
    });

    describe("setConfig", () => {
      interface IParams {
        config: TokenSellerConfigStruct;
        notOwner?: boolean;
      }

      interface IResults {
        config: TokenSellerConfigStruct;
      }

      async function makeTest(p: IParams): Promise<IResults> {
        const user = p.notOwner
          ? await Misc.impersonate(ethers.Wallet.createRandom().address)
          : signer;
        await tokenSeller.connect(user).setConfig(p.config);
        return {config: await tokenSeller.config()};
      }

      const NEW_CONFIG: TokenSellerConfigStruct = {
        amountA: 1,
        tickLimit: 2,
        thresholdRatio: 3,
        tickRangeSize: 4,
        thresholdTokenB: 5,
        thresholdLastRefreshPoolSec: 6
      }
      it("should set new config", async () => {
        const {config} = await makeTest({config: NEW_CONFIG});
        expect(config.amountA).eq(NEW_CONFIG.amountA);
        expect(config.tickLimit).eq(NEW_CONFIG.tickLimit);
        expect(config.thresholdRatio).eq(NEW_CONFIG.thresholdRatio);
        expect(config.tickRangeSize).eq(NEW_CONFIG.tickRangeSize);
        expect(config.thresholdTokenB).eq(NEW_CONFIG.thresholdTokenB);
        expect(config.thresholdLastRefreshPoolSec).eq(NEW_CONFIG.thresholdLastRefreshPoolSec);
      });

      it("should revert if not owner", async () => {
        await expect(makeTest({config: NEW_CONFIG, notOwner: true})).revertedWithCustomError(tokenSeller,"OnlyOwner");
      });
    });

    describe("setOwner / acceptOwner", () => {
      it("should change owner", async () => {
        const newOwner = await Misc.impersonate(ethers.Wallet.createRandom().address);
        const owner = await Misc.impersonate(await tokenSeller.owner());
        await tokenSeller.connect(owner).setOwner(newOwner.address);
        await tokenSeller.connect(newOwner).acceptOwner();
        expect(await tokenSeller.owner()).eq(newOwner.address);
        expect(await tokenSeller.pendingOwner()).eq(Misc.ZERO_ADDRESS);
      });

      it("revert if not owner", async () => {
        const notOwner = await Misc.impersonate(ethers.Wallet.createRandom().address);
        await expect(tokenSeller.connect(notOwner).setOwner(notOwner.address)).revertedWithCustomError(tokenSeller, "OnlyOwner");
      });

      it("revert if not new owner", async () => {
        const newOwner = await Misc.impersonate(ethers.Wallet.createRandom().address);
        const owner = await Misc.impersonate(await tokenSeller.owner());
        await tokenSeller.connect(owner).setOwner(newOwner.address);
        await expect(tokenSeller.connect(owner).acceptOwner()).revertedWithCustomError(tokenSeller, "ErrorPendingOwner");
      });

      it("revert if new owner is zero", async () => {
        const owner = await Misc.impersonate(await tokenSeller.owner());
        await expect(tokenSeller.connect(owner).setOwner(Misc.ZERO_ADDRESS)).revertedWithCustomError(tokenSeller, "ErrorZeroAddress");
      });
    });

    describe("openPosition / isPositionOpened / closePosition", () => {
      it("should open and close position", async () => {
        await tokenA.transfer(tokenSeller.address, parseUnits(narrowRange.balanceA, decimalsA));
        await tokenSeller.openPosition();
        expect(await tokenSeller.isPositionOpened()).eq(true);

        await tokenSeller.closePosition();
        expect(await tokenSeller.isPositionOpened()).eq(false);
      });

      it("should revert if the position is already opened", async () => {
        await tokenA.transfer(tokenSeller.address, parseUnits(narrowRange.balanceA, decimalsA));
        await tokenSeller.openPosition();
        await expect(tokenSeller.openPosition()).revertedWithCustomError(tokenSeller, "AlreadyOpened");
      });

      it("should revert if balance is zero", async () => {
        await expect(tokenSeller.openPosition()).revertedWithCustomError(tokenSeller, "ZeroAmountA");
      });

      it("should NOT revert if try to close not opened position", async () => {
        await tokenA.transfer(tokenSeller.address, parseUnits(narrowRange.balanceA, decimalsA));
        await tokenSeller.openPosition();

        await tokenSeller.closePosition();
        await tokenSeller.closePosition();
        // no exception here
      });
    });

    describe("withdraw / balanceOf", () => {
      it("should withdraw all", async () => {
        const amount = parseUnits("1", decimalsA);
        await tokenA.transfer(tokenSeller.address, amount);
        expect(await tokenSeller.balanceOf(tokenA.address)).eq(amount);

        const receiver = ethers.Wallet.createRandom().address;
        await tokenSeller.withdraw(receiver, tokenA.address, amount);
        expect(await tokenSeller.balanceOf(tokenA.address)).eq(0);
        expect(await tokenA.balanceOf(receiver)).eq(amount);
      });

      it("should revert if not owner", async () => {
        const notOwner = await Misc.impersonate(ethers.Wallet.createRandom().address);
        const amount = parseUnits("1", decimalsA);
        await tokenA.transfer(tokenSeller.address, amount);
        const receiver = ethers.Wallet.createRandom().address;
        await expect(tokenSeller.connect(notOwner).withdraw(receiver, tokenA.address, amount)).revertedWithCustomError(tokenSeller, "OnlyOwner");
      });
    });

    describe("uniswapV3MintCallback", () => {
      it("should revert if not the pool", async () => {
        const mockedPool = await MockHelper.createMockUniswapV3Pool(signer);

        await mockedPool.setTokens(tokenA.address, tokenB.address);
        const notOwner = await Misc.impersonate(mockedPool.address);

        const amount = parseUnits("1", decimalsA);
        await tokenA.mint(tokenSeller.address, amount);
        await tokenB.mint(tokenSeller.address, amount);

        const data = defaultAbiCoder.encode(
          ["address"],
          [await tokenSeller.owner()]
        );
        await expect(
          tokenSeller.connect(notOwner).uniswapV3MintCallback(amount, amount, data)
        ).revertedWithCustomError(tokenSeller, "OnlyPool");
      });
    });

    describe("refreshPool / setOperator", () => {
      it("should success if owner", async () => {
        const owner = await Misc.impersonate(await tokenSeller.owner());
        await tokenSeller.connect(owner).refreshPool();
        // no exception
      });

      it("should revert if not owner and not operator", async () => {
        const owner = await Misc.impersonate(await tokenSeller.owner());
        const notOperator = await Misc.impersonate(ethers.Wallet.createRandom().address);
        await expect(tokenSeller.connect(notOperator).refreshPool()).revertedWithCustomError(tokenSeller, "OnlyOwnerOrOperator");
      });


      it("should success if operator", async () => {
        const owner = await Misc.impersonate(await tokenSeller.owner());
        const operator = await Misc.impersonate(ethers.Wallet.createRandom().address);
        await tokenSeller.connect(owner).setOperator(operator.address, true);
        await tokenSeller.connect(operator).refreshPool();
        await tokenSeller.connect(owner).setOperator(operator.address, false);
        await expect(tokenSeller.connect(operator).refreshPool()).revertedWithCustomError(tokenSeller, "OnlyOwnerOrOperator");
      });
    });
  });
});