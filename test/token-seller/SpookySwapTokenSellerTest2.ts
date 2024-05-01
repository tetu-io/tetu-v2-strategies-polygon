import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IERC20, IERC20Metadata__factory, MockToken__factory,
  UniswapV3Callee,
  UniswapV3LibFacade, UniswapV3Pool, UniswapV3Pool__factory, Univ3TokenSeller, Univ3TokenSeller__factory
} from "../../typechain";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {FTM_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {writeFileSyncRestoreFolder} from "../baseUT/utils/FileUtils";
import {writeFileSync} from "fs";
import {expect} from "chai";
import {DeployTokenSellerUtils} from "../../scripts/token-seller/DeployTokenSellerUtils";
import {TokenUtils} from "../../scripts/utils/TokenUtils";
import {FtmAddresses} from "../../scripts/addresses/FtmAddresses";
import {Misc} from "../../scripts/utils/Misc";

describe('SpookySwapTokenSellerTest2', () => {
  const pathWithoutExt = `./tmp/SpookySwapTokenSellerTest`;
  const SIGNER_AMOUNT_A = "1";

  const SIGNER_BALANCE_A = "10";
  const MAX_AMOUNT_TO_SWAP_A = "100";
  const MAX_AMOUNT_TO_SWAP_B = "100";

  // const TOKEN_A = "0xF21ABFC5D68819EA0044fdB256d0AA854DC3034b";
  // const TOKEN_B = "0xF992a90B4F2D59B65548bF9766a02ee8170E7F07";
  // const POOL = "0x11aB7c23B6d05Aa08D69A1eD669Ad19f3eAC52d9";

  const POOL = "0x56e837286dc7366ef6d6464d332ac6f9d32bc5a0";
  const TOKEN_A = "0xe4436821e403e78a6dd62f7a9f5611f97a18f44c"; // sacra (token to sell)
  const TOKEN_B = "0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83"; // ftm

  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;

  let tokenA: IERC20;
  let tokenB: IERC20;
  const decimalsA = 18;
  const decimalsB = 6;
  const tickRangeSize = 13;
  let pool: UniswapV3Pool;
  let facadeUni: UniswapV3LibFacade;
  let uniswapV3Callee: UniswapV3Callee;

  const states: IStateHistory[] = [];

  before(async function () {
    [signer, signer1, signer2] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.setupBeforeTest(FTM_NETWORK_ID);

    tokenA = IERC20Metadata__factory.connect(TOKEN_A, signer);
    tokenB = IERC20Metadata__factory.connect(TOKEN_B, signer);

    pool = UniswapV3Pool__factory.connect(POOL, signer);
    facadeUni = (await DeployerUtils.deployContract(signer, "UniswapV3LibFacade")) as UniswapV3LibFacade;
    uniswapV3Callee = (await DeployerUtils.deployContract(signer, "UniswapV3Callee")) as UniswapV3Callee;
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
    saveToCsv(states, "");
  });

  function getRealPrice(sqrtPrice: BigNumber): BigNumber {
    const QX96 = BigNumber.from(2).pow(96);
    return sqrtPrice.mul(Misc.ONE18).mul(sqrtPrice).div(QX96).div(QX96);
  }

  it("calculate prices and ticks", async () => {
    for (let tick = 40443; tick < 43810; tick += 200) {
      const sqrt = await facadeUni._getSqrtRatioAtTick(tick);
      const price = +formatUnits(getRealPrice(sqrt), 18);
      console.log(tick, price);
    }

    const tickCurrent = 40810;

    const tickLower = 40600;
    const tickUpper = 40800;

    const tickLimit = 46600;

    const tickTest = 43810;

    const sqrtPriceCurrent = await facadeUni._getSqrtRatioAtTick(tickCurrent);

    const sqrtPriceLower = await facadeUni._getSqrtRatioAtTick(tickLower);
    const sqrtPriceUpper = await facadeUni._getSqrtRatioAtTick(tickUpper);

    const sqrtPriceLimit = await facadeUni._getSqrtRatioAtTick(tickLimit);

    const sqrtPriceTest = await facadeUni._getSqrtRatioAtTick(tickTest);

    const priceCurrent = +formatUnits(getRealPrice(sqrtPriceCurrent), 18);
    const priceLower = +formatUnits(getRealPrice(sqrtPriceLower), 18);
    const priceUpper = +formatUnits(getRealPrice(sqrtPriceUpper), 18);
    const priceLimit = +formatUnits(getRealPrice(sqrtPriceLimit), 18);
    const priceTest = +formatUnits(getRealPrice(sqrtPriceTest), 18);

    console.log("tick, priceCurrent", tickCurrent, priceCurrent);
    console.log("tick, priceLower", tickLower, priceLower);
    console.log("tick, priceUpper", tickUpper, priceUpper);
    console.log("tick, priceLimit", tickLimit, priceLimit);
    console.log("tick, priceTest", tickTest, priceTest);
  });

  //region Data types
  interface ISwapParams {
    tag: string;
    swapTokenA: boolean;
    swapAmount: string;
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
    derivedValues: {
      tickLimit: number;
      tickSpacing: number;
    }
    init: IState;
    afterSwap: IState[];
    afterRefresh: IState;
    final: IState;
  }
  //endregion Data types

  //region Utils
  async function getCurrentNarrowRangeState(poolSwapTokens: boolean, tokenSeller: Univ3TokenSeller, sqrtPriceX96: BigNumber): Promise<IRangeState> {
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
        +formatUnits(poolSwapTokens ? resultAmounts[1] : resultAmounts[0], decimalsA),
        +formatUnits(poolSwapTokens ? resultAmounts[0] : resultAmounts[1], decimalsB),
      ]
    }
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
      "tickLimit",
      "tickSpacing",
    ]
  }
  function stateHistoryToArray(state: IStateHistory): (string | number | BigNumber)[]{
    return [
      state.derivedValues.tickLimit,
      state.derivedValues.tickSpacing
    ];
  }

  function saveToCsv(states: IStateHistory[], tag?: string) {
    const pathOut = `${pathWithoutExt}${tag}.csv`
    const firstRow = ["param"];
    for (let i = 0; i < states.length; ++i) {
      const items = [
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

  // async function getToken(token: string, signer: string, amount: BigNumber) {
  //   await MockToken__factory.connect(token, await Misc.impersonate(signer)).mint(signer, amount);
  // }

  describe("refreshPool (init => {swap => refreshPool} * N => withdraw)", () => {
    const SWAP_SETS: ISwapParams[] = [
      {tag: "A10", swapTokenA: true, swapAmount: "10"},
      {tag: "B10", swapTokenA: false, swapAmount: "10"},
    ];

    describe(`Create token seller`, () => {
      let tokenSeller: Univ3TokenSeller;
      let snapshot2: string;
      let init: IState;
      let derivedValues: IDerivedValues;
      let poolSwapTokens: boolean;
      before(async function () {
        console.log("Set up token seller");
        snapshot2 = await TimeUtils.snapshot();

        await TokenUtils.getToken(tokenA.address, signer.address, parseUnits(SIGNER_BALANCE_A, decimalsA));
        await TokenUtils.getToken(tokenA.address, signer2.address, parseUnits(MAX_AMOUNT_TO_SWAP_A, decimalsA));
        await TokenUtils.getToken(tokenB.address, signer2.address, parseUnits(MAX_AMOUNT_TO_SWAP_B, decimalsB));

        // await getToken(tokenA.address, signer.address, parseUnits(SIGNER_BALANCE_A, decimalsA));
        // await getToken(tokenA.address, signer2.address, parseUnits(MAX_AMOUNT_TO_SWAP_A, decimalsA));
        // await getToken(tokenB.address, signer2.address, parseUnits(MAX_AMOUNT_TO_SWAP_B, decimalsB));

        tokenSeller = Univ3TokenSeller__factory.connect(
          await DeployTokenSellerUtils.deployTokenSeller(
            signer,
            tokenA.address,
            tokenB.address,
            POOL,
            SIGNER_AMOUNT_A,
            tickRangeSize
          ),
          signer
        );
        poolSwapTokens = await tokenSeller.poolSwapTokens();
        await tokenA.transfer(tokenSeller.address, parseUnits(SIGNER_AMOUNT_A, decimalsA));
        await tokenSeller.openPosition();

        const poolInfo = await pool.slot0();
        init = {
          tick: poolInfo.tick,
          sqrtPriceX96: poolInfo.sqrtPriceX96,
          needToRefresh: await tokenSeller.needToRefresh(),
          isPositionOpened: await tokenSeller.isPositionOpened(),
          narrowRange: await getCurrentNarrowRangeState(poolSwapTokens, tokenSeller, poolInfo.sqrtPriceX96),
          balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
          balancesAbSigner: await getBalancesAB(signer.address),
          balancesAbSigner1: await getBalancesAB(signer1.address),
          balancesAbSigner2: await getBalancesAB(signer2.address),
        }
        console.log("init", init);

        const config = await tokenSeller.config();
        derivedValues = {
          tickLimit: config.tickLimit,
          tickSpacing: await tokenSeller.tickSpacing(),
        }

        console.log("config", config);
        console.log("poolSwapTokens", await tokenSeller.poolSwapTokens());
        console.log("tokenA", await tokenSeller.tokenA());
        console.log("tokenB", await tokenSeller.tokenB());
      });
      after(async function () {
        await TimeUtils.rollback(snapshot2);
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
              tick,
              sqrtPriceX96,
              needToRefresh: await tokenSeller.needToRefresh(),
              isPositionOpened: await tokenSeller.isPositionOpened(),
              narrowRange: await getCurrentNarrowRangeState(poolSwapTokens, tokenSeller, sqrtPriceX96),
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
                tick,
                sqrtPriceX96,
                needToRefresh: await tokenSeller.needToRefresh(),
                isPositionOpened: await tokenSeller.isPositionOpened(),
                narrowRange: await getCurrentNarrowRangeState(poolSwapTokens, tokenSeller, sqrtPriceX96),
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
                derivedValues.tickSpacing * tickRangeSize
              );
            });
            it("new tick range should have expected bounds", async () => {
              if (poolSwapTokens) {
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
                  expect(afterRefresh.narrowRange.amountsAB[0]).eq(SIGNER_AMOUNT_A);
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

                const {sqrtPriceX96, tick} = await pool.slot0();
                final = {
                  tick,
                  sqrtPriceX96,
                  needToRefresh: await tokenSeller.needToRefresh(),
                  isPositionOpened: await tokenSeller.isPositionOpened(),
                  narrowRange: await getCurrentNarrowRangeState(poolSwapTokens, tokenSeller, sqrtPriceX96),
                  balancesAbTokenSeller: await getBalancesAB(tokenSeller.address),
                  balancesAbSigner: await getBalancesAB(signer.address),
                  balancesAbSigner1: await getBalancesAB(signer1.address),
                  balancesAbSigner2: await getBalancesAB(signer2.address),
                }

                registerResults(states, {
                  derivedValues,
                  init,
                  afterSwap: [afterSwap],
                  afterRefresh,
                  final
                });
              });
              after(async function () {
                await TimeUtils.rollback(snapshot5);
              });

              it("tokenSeller should not have any tokens", async () => {
                expect(await final.balancesAbTokenSeller[0]).eq(0);
                expect(await final.balancesAbTokenSeller[1]).eq(0);
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
});