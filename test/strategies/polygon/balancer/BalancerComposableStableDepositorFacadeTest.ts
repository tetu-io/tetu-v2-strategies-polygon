import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {parseUnits} from "ethers/lib/utils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {MaticHolders} from "../../../../scripts/addresses/MaticHolders";
import {
  BalancerComposableStableDepositorFacade,
  IBalancerBoostedAavePool__factory,
  IBalancerBoostedAaveStablePool__factory,
  IBalancerGauge__factory,
  IBVault__factory,
  IERC20__factory
} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {BigNumber} from "ethers";
import {expect} from "chai";
import {areAlmostEqual, differenceInPercentsLessThan} from "../../../baseUT/utils/MathUtils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {controlGasLimitsEx} from "../../../../scripts/utils/GasLimitUtils";
import {
  BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_CLAIM_REWARDS,
  BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_ENTER,
  BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_EXIT,
  BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_ASSETS,
  BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_LIQUIDITY,
  BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_RESERVES,
  BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_TOTAL_SUPPLY,
  BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_WEIGHTS, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_QUOTE_EXIT
} from "../../../baseUT/GasLimits";

describe('BalancerComposableStableDepositorFacadeTest', function() {
//region Constants
  const balancerVault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  /** Balancer Boosted Aave USD pool ID */
  const poolBoostedId = "0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b";
  const poolAmDaiId= "0x178e029173417b1f9c8bc16dcec6f697bc323746000000000000000000000758";
  const poolAmUsdcId = "0xf93579002dbe8046c43fefe86ec78b1112247bb8000000000000000000000759";
  const poolAmUsdtId = "0xff4ce5aaab5a627bf82f4a571ab1ce94aa365ea600000000000000000000075a";
  const gauge = "0x1c514fEc643AdD86aeF0ef14F4add28cC3425306";

  const BB_AM_USD = "0x48e6b98ef6329f8f0a30ebb8c7c960330d648085";
//endregion Constants

//region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;
//endregion Variables

//region before, after
  before(async function () {
    [signer, signer1, signer2] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Utils enter/exit
  interface IDepositorChangeBalances {
    poolTokensBefore: {
      tokens: string[];
      balances: BigNumber[];
      lastChangeBlock: BigNumber;
    };
    poolTokensAfter: {
      tokens: string[];
      balances: BigNumber[];
      lastChangeBlock: BigNumber;
    };
  }
  function getMaxPercentDelta(r: IDepositorChangeBalances): BigNumber {
    const totalTokensBefore = r.poolTokensBefore.balances[0]
      .add(r.poolTokensBefore.balances[2])
      .add(r.poolTokensBefore.balances[3]);
    const totalTokensAfter = r.poolTokensAfter.balances[0]
      .add(r.poolTokensAfter.balances[2])
      .add(r.poolTokensAfter.balances[3]);
    console.log("Before", r.poolTokensBefore, totalTokensBefore);
    console.log("After", r.poolTokensAfter, totalTokensAfter);

    const proportionsAfter = [
      r.poolTokensAfter.balances[0].mul(Misc.ONE18).div(totalTokensAfter),
      r.poolTokensAfter.balances[2].mul(Misc.ONE18).div(totalTokensAfter),
      r.poolTokensAfter.balances[3].mul(Misc.ONE18).div(totalTokensAfter),
    ];
    const proportionsBefore = [
      r.poolTokensBefore.balances[0].mul(Misc.ONE18).div(totalTokensBefore),
      r.poolTokensBefore.balances[2].mul(Misc.ONE18).div(totalTokensBefore),
      r.poolTokensBefore.balances[3].mul(Misc.ONE18).div(totalTokensBefore),
    ];
    const percentDeltas = [
      proportionsAfter[0].sub(proportionsBefore[0]).mul(Misc.ONE18).div(proportionsAfter[0]),
      proportionsAfter[1].sub(proportionsBefore[1]).mul(Misc.ONE18).div(proportionsAfter[1]),
      proportionsAfter[2].sub(proportionsBefore[2]).mul(Misc.ONE18).div(proportionsAfter[2]),
    ];

    const maxPercentDeltas = percentDeltas.reduce(
      (prev, current) => current.gt(prev) ? current : prev, percentDeltas[0]
    );

    console.log("proportionsAfter", proportionsAfter);
    console.log("proportionsBefore", proportionsBefore);
    console.log("percentDeltas", percentDeltas);
    console.log("maxPercentDeltas", maxPercentDeltas);

    return maxPercentDeltas;
  }

  interface IDepositorEnterTestResults extends IDepositorChangeBalances {
    amountsConsumedOut: BigNumber[];
    liquidityOut: BigNumber;
    gasUsed: BigNumber;
    /** DAI, USDC, USDT */
    balancesBefore: BigNumber[];
    /** DAI, USDC, USDT */
    balancesAfter: BigNumber[];
  }

  interface IMakeDepositorEnterBadParams {
    amount?: string;
    amountsDesired?: BigNumber[];
  }

  async function makeDepositorEnterTest(
    facade: BalancerComposableStableDepositorFacade,
    params?: IMakeDepositorEnterBadParams
  ) : Promise<IDepositorEnterTestResults> {
    const assets = [MaticAddresses.DAI_TOKEN, MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN];
    const holders = [MaticHolders.HOLDER_DAI, MaticHolders.HOLDER_USDC, MaticHolders.HOLDER_USDT];
    const vault = IBVault__factory.connect(balancerVault, signer);

    const amountsDesired = params?.amountsDesired
      || (
        params?.amount
          ? [
            parseUnits(params.amount, 18), // dai
            parseUnits(params.amount, 6),  // usdc
            parseUnits(params.amount, 6)   // usdt
          ]
          : [
            parseUnits("1", 18), // dai
            parseUnits("1", 6),  // usdc
            parseUnits("1", 6)   // usdt
          ]
      );

    const balancesBefore: BigNumber[] = [];
    for (let i = 0; i < 3; ++i) {
      const holder = await Misc.impersonate(holders[i]);
      await IERC20__factory.connect(assets[i], holder).transfer(facade.address, amountsDesired[i]);
      balancesBefore.push(await IERC20__factory.connect(assets[i], signer).balanceOf(facade.address));
    }
    const poolTokensBefore = await vault.getPoolTokens(poolBoostedId);
    const tx = await facade._depositorEnterAccess(amountsDesired);
    const receipt = await tx.wait();

    const gasUsed = receipt.gasUsed;
    const poolTokensAfter = await vault.getPoolTokens(poolBoostedId);
    const liquidityOut = await facade.lastLiquidityOut();
    const amountsConsumedOut: BigNumber[] = [];
    const amountsConsumedOutLength = (await facade.lastAmountsConsumedOutLength()).toNumber();
    for (let i = 0; i < amountsConsumedOutLength; ++i) {
      amountsConsumedOut.push(await facade.lastAmountsConsumedOut(i));
    }

    const balancesAfter: BigNumber[] = [];
    for (let i = 0; i < 3; ++i) {
      balancesAfter.push(await IERC20__factory.connect(assets[i], signer).balanceOf(facade.address));
    }

    console.log("liquidityOut", liquidityOut);
    console.log("amountsConsumedOut", amountsConsumedOut);
    return {
      amountsConsumedOut,
      liquidityOut,
      gasUsed,
      balancesBefore,
      balancesAfter,
      poolTokensBefore,
      poolTokensAfter
    }
  }

  interface IDepositorExitTestResults extends IDepositorChangeBalances {
    amountsOut: BigNumber[];
    assets: string[];
    balanceFacadeAssetsBefore: BigNumber[];
    balanceFacadeAssetsAfter: BigNumber[];
    liquidityFacadeBefore: BigNumber;
    liquidityFacadeAfter: BigNumber;
    gasUsed: BigNumber;
  }
  async function makeDepositorExitTest(
    facade: BalancerComposableStableDepositorFacade,
    liquidityAmountToWithdraw?: string
  ) : Promise<IDepositorExitTestResults> {
    const assets = [MaticAddresses.DAI_TOKEN, MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN];
    const vault = IBVault__factory.connect(balancerVault, signer);

    const balanceFacadeAssetsBefore = await BalanceUtils.getBalances(signer, facade.address, assets);
    const liquidityFacadeBefore = await facade._depositorLiquidityAccess();
    const poolTokensBefore = await vault.getPoolTokens(poolBoostedId);

    const tx = await facade._depositorExitAccess(
      // 0 means that we withdraw all liquidity, see _depositorExitAccess implementation
      liquidityAmountToWithdraw || 0
    );
    const gasUsed = (await tx.wait()).gasUsed;

    const amountsOut: BigNumber[] = [];
    const amountsOutLength = (await facade.lastAmountsOutLength()).toNumber();
    for (let i = 0; i < amountsOutLength; ++i) {
      amountsOut.push(await facade.lastAmountsOut(i));
    }

    const balanceFacadeAssetsAfter = await BalanceUtils.getBalances(signer, facade.address, assets);
    const liquidityFacadeAfter = await facade._depositorLiquidityAccess();
    const poolTokensAfter = await vault.getPoolTokens(poolBoostedId);

    return {
      amountsOut,
      assets,
      balanceFacadeAssetsBefore,
      balanceFacadeAssetsAfter,
      liquidityFacadeBefore,
      liquidityFacadeAfter,
      poolTokensBefore,
      poolTokensAfter,
      gasUsed
    }
  }

  interface IDepositorClaimRewardsTestResults extends IDepositorChangeBalances {
    tokensOut: string[];
    amountsOut: BigNumber[];
    gasUsed: BigNumber;
  }
  async function makeDepositorClaimRewardsTest(
    facade: BalancerComposableStableDepositorFacade,
  ) : Promise<IDepositorClaimRewardsTestResults> {
    const assets = [MaticAddresses.DAI_TOKEN, MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN];
    const vault = IBVault__factory.connect(balancerVault, signer);

    const poolTokensBefore = await vault.getPoolTokens(poolBoostedId);

    const ret = await facade.callStatic._depositorClaimRewardsAccess();
    const tx = await facade._depositorClaimRewardsAccess();
    const gasUsed = (await tx.wait()).gasUsed;

    const poolTokensAfter = await vault.getPoolTokens(poolBoostedId);

    return {
      amountsOut: ret.amountsOut,
      tokensOut: ret.tokensOut,
      poolTokensBefore,
      poolTokensAfter,
      gasUsed
    }
  }
//endregion Utils enter/exit

//region Unit tests
  describe("BalancerComposableStableDepositorFacadeTest", () => {
    describe("_depositorPoolAssets", () => {
      it("should return expected list of assets", async () => {
        const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
        const ret = (await facade._depositorPoolAssetsAccess()).map(x => x.toLowerCase()).join("\n");
        const expected = [
          MaticAddresses.DAI_TOKEN.toLowerCase(),
          MaticAddresses.USDC_TOKEN.toLowerCase(),
          MaticAddresses.USDT_TOKEN.toLowerCase()
        ].join("\n");

        expect(ret).eq(expected);
      });
      it("should not exceed gas limits @skip-on-coverage", async () => {
        const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
        const gasUsed = await facade.estimateGas._depositorPoolAssetsAccess();

        controlGasLimitsEx(gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_ASSETS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
    describe("_depositorPoolWeights", () => {
      it("should return all weights equal to 1", async () => {
        const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
        const r = await facade._depositorPoolWeightsAccess();
        const ret = [
          r.totalWeight,
          r.weights.join()
        ].join("\n");
        const expected = [
          3,
          [1, 1, 1].join()
        ].join("\n");

        expect(ret).eq(expected);
      });
      it("should not exceed gas limits @skip-on-coverage", async () => {
        const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
        const gasUsed = await facade.estimateGas._depositorPoolWeightsAccess();

        controlGasLimitsEx(gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_WEIGHTS, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
    describe("_depositorPoolReserves", () => {
      it("should return expected amounts", async () => {
        const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
        const r = await facade._depositorPoolReservesAccess();

        const vault = IBVault__factory.connect(balancerVault, signer);
        const poolDai = IBalancerBoostedAavePool__factory.connect((await vault.getPool(poolAmDaiId))[0], signer);
        const poolUsdc = IBalancerBoostedAavePool__factory.connect((await vault.getPool(poolAmUsdcId))[0], signer);
        const poolUsdt = IBalancerBoostedAavePool__factory.connect((await vault.getPool(poolAmUsdtId))[0], signer);

        const daiBalances = await vault.getPoolTokens(poolAmDaiId);
        const usdcBalances = await vault.getPoolTokens(poolAmUsdcId);
        const usdtBalances = await vault.getPoolTokens(poolAmUsdtId);

        const ret = r.map(x => BalanceUtils.toString(x)).join("\n");
        const expected = [
          daiBalances.balances[1].add(
            daiBalances.balances[2].mul(await poolDai.getWrappedTokenRate()).div(Misc.ONE18)
          ),
          usdcBalances.balances[1].add(
            usdcBalances.balances[0].mul(await poolUsdc.getWrappedTokenRate()).div(Misc.ONE18)
          ),
          usdtBalances.balances[1].add(
            usdtBalances.balances[0].mul(await poolUsdt.getWrappedTokenRate()).div(Misc.ONE18)
          ),
        ].map(x => BalanceUtils.toString(x)).join("\n");

        expect(ret).eq(expected);
      });
      it("should not exceed gas limits @skip-on-coverage", async () => {
        const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
        const gasUsed = await facade.estimateGas._depositorPoolReservesAccess();

        controlGasLimitsEx(gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_RESERVES, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
    describe("_depositorLiquidity", () => {
      it("should return not zero liquidity after deposit", async () => {
        const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
        const before = await facade._depositorLiquidityAccess();
        await makeDepositorEnterTest(facade);
        const after = await facade._depositorLiquidityAccess();
        const ret = [
          before.eq(0),
          after.gt(0)
        ].join();
        const expected = [true, true].join();
        expect(ret).eq(expected);
      });
      it("should not exceed gas limits @skip-on-coverage", async () => {
        const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
        const gasUsed = await facade.estimateGas._depositorLiquidityAccess();

        controlGasLimitsEx(gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_LIQUIDITY, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
    describe("_depositorTotalSupply", () => {
      it("should return actual supply", async () => {
        const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
        const ret = await facade._depositorTotalSupplyAccess();

        const vault = IBVault__factory.connect(balancerVault, signer);
        const expected = await IBalancerBoostedAaveStablePool__factory.connect(
          (await vault.getPool(poolBoostedId))[0],
          signer
        ).getActualSupply();
        expect(ret.eq(expected)).eq(true);
      });
      it("should not exceed gas limits @skip-on-coverage", async () => {
        const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
        const gasUsed = await facade.estimateGas._depositorTotalSupplyAccess();

        controlGasLimitsEx(gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_TOTAL_SUPPLY, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });

    describe("_depositorEnter", () => {
      describe("Good paths", () => {
        describe("Deposit to balanceR pool", () => {
          it("should return expected values", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);

            const balanceGaugeBefore = await IBalancerGauge__factory.connect(gauge, signer).balanceOf(facade.address);
            const r = await makeDepositorEnterTest(facade);
            console.log("r", r);

            const balanceGaugeAfter = await IBalancerGauge__factory.connect(gauge, signer).balanceOf(facade.address);
            console.log("balanceGaugeAfter", facade.address, balanceGaugeAfter);
            console.log("liquidityOut", r.liquidityOut);
            console.log("DAI", r.amountsConsumedOut[0], r.balancesAfter[0].sub(r.balancesBefore[0]));

            const ret = [
              balanceGaugeBefore.eq(0),
              // there is small difference in results (static call and call are different calls)
              areAlmostEqual(r.liquidityOut, balanceGaugeAfter),

              r.amountsConsumedOut.length,

              r.amountsConsumedOut[0].gt(0),
              r.amountsConsumedOut[1].gt(0),
              r.amountsConsumedOut[2].gt(0),

              // one of amounts exactly matches to the desired amount "1"
              r.amountsConsumedOut[0].eq(parseUnits("1", 18))
              || r.amountsConsumedOut[1].eq(parseUnits("1", 6))
              || r.amountsConsumedOut[2].eq(parseUnits("1", 6)),

              r.amountsConsumedOut[0].eq(r.balancesBefore[0].sub(r.balancesAfter[0])),
              r.amountsConsumedOut[1].eq(r.balancesBefore[1].sub(r.balancesAfter[1])),
              r.amountsConsumedOut[2].eq(r.balancesBefore[2].sub(r.balancesAfter[2]))
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              true,
              true,

              3,

              true,
              true,
              true,

              true,

              true,
              true,
              true
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Ensure that deposit doesn't change proportions too much", () => {
          it("$1", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
            const r = await makeDepositorEnterTest(facade, {amount: "1"});
            const maxPercentDeltas = getMaxPercentDelta(r);
            expect(maxPercentDeltas.abs().lt(1e7)).eq(true);
          });
          it("$10_000", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
            const r = await makeDepositorEnterTest(facade, {amount: "10000"});
            const maxPercentDeltas = getMaxPercentDelta(r);
            expect(maxPercentDeltas.abs().lt(1e11)).eq(true);
          });
          it("$1_000_000", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
            const r = await makeDepositorEnterTest(facade, {amount: "1000000"});
            const maxPercentDeltas = getMaxPercentDelta(r);
            expect(maxPercentDeltas.abs().lt(1e12)).eq(true);
          });
        });
      });
      describe("Bad paths", () => {
        it("should revert if zero desired amount", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          await expect(makeDepositorEnterTest(
              facade,
              {
                amountsDesired: [
                  parseUnits("0", 18), // dai  (!) zero amount
                  parseUnits("1", 6),  // usdc
                  parseUnits("1", 6)   // usdt
                ]
              }
            )
          ).revertedWith("BAL#510"); // We check this situation in _beforeDeposit and throw ZERO_AMOUNT_BORROWED
        });
      });
      describe("Gas estimation @skip-on-coverage", () => {
        it("should not exceed gas limits", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          const r = await makeDepositorEnterTest(facade);

          controlGasLimitsEx(r.gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_ENTER, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
    });

    describe("_depositorExit", () => {
      describe("Good paths", () => {
        describe("Withdraw full", () => {
          it("should return expected values", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);

            const retEnter = await makeDepositorEnterTest(facade, {amount: "1000"});
            console.log("retEnter", retEnter);

            const retExit = await makeDepositorExitTest(facade);
            console.log("retExit", retExit);

            const percent100 = 2;
            const ret = [
              // we receive back same amounts as ones we have deposited
              retExit.amountsOut.length,
              differenceInPercentsLessThan(retExit.amountsOut[0], retEnter.amountsConsumedOut[0], percent100),
              differenceInPercentsLessThan(retExit.amountsOut[1], retEnter.amountsConsumedOut[1], percent100),
              differenceInPercentsLessThan(retExit.amountsOut[2], retEnter.amountsConsumedOut[2], percent100),

              // all amounts were transferred to the balance of the depositor
              retExit.balanceFacadeAssetsAfter[0].sub(retExit.balanceFacadeAssetsBefore[0]),
              retExit.balanceFacadeAssetsAfter[1].sub(retExit.balanceFacadeAssetsBefore[1]),
              retExit.balanceFacadeAssetsAfter[2].sub(retExit.balanceFacadeAssetsBefore[2]),

              // amount of liquidity in the pool was reduced up to dust level
              differenceInPercentsLessThan(retEnter.liquidityOut.sub(retExit.liquidityFacadeAfter), retEnter.liquidityOut, 1)
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              // we receive back same amounts as ones we have deposited
              3,
              true,
              true,
              true,

              // all amounts were transferred to the balance of the depositor
              retExit.amountsOut[0],
              retExit.amountsOut[1],
              retExit.amountsOut[2],

              // amount of liquidity in the pool was reduced on the withdrawn value
              true
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Ensure that the withdrawing doesn't change proportions too much", () => {
          it("$1", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
            await makeDepositorEnterTest(facade, {amount: "1"});
            const r = await makeDepositorExitTest(facade);
            const maxPercentDeltas = getMaxPercentDelta(r);
            expect(maxPercentDeltas.abs().lt(1e5)).eq(true);
          });
          it("$10_000", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
            await makeDepositorEnterTest(facade, {amount: "10000"});
            const r = await makeDepositorExitTest(facade);
            const maxPercentDeltas = getMaxPercentDelta(r);
            expect(maxPercentDeltas.abs().lt(1e9)).eq(true);
          });
          it("$1_000_000", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
            await makeDepositorEnterTest(facade, {amount: "1000000"});
            const r = await makeDepositorExitTest(facade);
            const maxPercentDeltas = getMaxPercentDelta(r);
            expect(maxPercentDeltas.abs().lt(1e11)).eq(true);
          });
        });
      });
      describe("Bad paths", () => {
      // todo
      });
      describe("Gas estimation @skip-on-coverage", () => {
        it("withdraw $1 should not exceed gas limits @skip-on-coverage", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          await makeDepositorEnterTest(facade, {amount: "1"});
          const retExit = await makeDepositorExitTest(facade);

          controlGasLimitsEx(retExit.gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_EXIT, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
        it("withdraw $100_000 should not exceed gas limits @skip-on-coverage", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          await makeDepositorEnterTest(facade, {amount: "100000"});
          const retExit = await makeDepositorExitTest(facade);

          controlGasLimitsEx(retExit.gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_EXIT, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
    });

    describe("_depositorQuoteExit", () => {
      interface IQuoteExitTestResults {
        exitAmountsOut: BigNumber[];
        quoteExitAmountsOut: BigNumber[];
        gasUsed: BigNumber;
      }
      async function makeQuoteExitTest(
        facade: BalancerComposableStableDepositorFacade,
        amount: string
      ) : Promise<IQuoteExitTestResults> {
        const retEnter = await makeDepositorEnterTest(facade, {amount: "1000"});
        console.log("retEnter", retEnter);

        const retQuoteExit = await facade.callStatic._depositorQuoteExitAccess(0);
        const gasUsed = await facade.estimateGas._depositorQuoteExitAccess(0);
        console.log("retQuoteExit", retQuoteExit);

        const retExit = await makeDepositorExitTest(facade);
        console.log("retExit", retExit);

        return {
          exitAmountsOut: retExit.amountsOut,
          quoteExitAmountsOut: retQuoteExit,
          gasUsed
        }
      }
      describe("Good paths", () => {
        describe("Withdraw full", () => {
          it("should return almost same values as on real exit, $1", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
            const r = await makeQuoteExitTest(facade, "1");

            const ret = [
              r.quoteExitAmountsOut.length,
              differenceInPercentsLessThan(r.exitAmountsOut[0], r.quoteExitAmountsOut[0], 0.11),
              differenceInPercentsLessThan(r.exitAmountsOut[1], r.quoteExitAmountsOut[1], 0.11),
              differenceInPercentsLessThan(r.exitAmountsOut[2], r.quoteExitAmountsOut[2], 0.11),
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              r.exitAmountsOut.length,
              true,
              true,
              true,
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
          it("should return almost same values as on real exit, $100_000", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
            const r = await makeQuoteExitTest(facade, "100000");

            const ret = [
              r.quoteExitAmountsOut.length,
              differenceInPercentsLessThan(r.exitAmountsOut[0], r.quoteExitAmountsOut[0], 0.11),
              differenceInPercentsLessThan(r.exitAmountsOut[1], r.quoteExitAmountsOut[1], 0.11),
              differenceInPercentsLessThan(r.exitAmountsOut[2], r.quoteExitAmountsOut[2], 0.11),
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              r.exitAmountsOut.length,
              true,
              true,
              true,
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
      });
      describe("Bad paths", () => {
        // todo
      });
      describe("Gas estimation @skip-on-coverage", () => {
        it("withdraw $1 should not exceed gas limits @skip-on-coverage", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          await makeDepositorEnterTest(facade, {amount: "1"});
          const retExit = await makeQuoteExitTest(facade, "1");

          controlGasLimitsEx(retExit.gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_QUOTE_EXIT, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
        it("withdraw $100_000 should not exceed gas limits @skip-on-coverage", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          await makeDepositorEnterTest(facade, {amount: "100000"});
          const retExit = await makeQuoteExitTest(facade, "100000");

          controlGasLimitsEx(retExit.gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_QUOTE_EXIT, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
    });

    describe("depositorClaimRewards", () => {
      describe("Good paths", () => {
        describe("Withdraw full", () => {
          it("should return expected values", async () => {
            const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);

            const retEnter = await makeDepositorEnterTest(facade, {amount: "1000"});
            console.log("retEnter", retEnter);

            await TimeUtils.advanceNBlocks(2000);

            const retClaimRewards = await makeDepositorClaimRewardsTest(facade);
            console.log("retExit", retClaimRewards);

            const ret = [
              retClaimRewards.amountsOut.length,
              retClaimRewards.tokensOut.length,

              retClaimRewards.tokensOut[0],
              retClaimRewards.amountsOut[0].gt(0),
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              1,
              1,

              "0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3",
              true
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
      });
      describe("Bad paths", () => {
        // todo
      });
      describe("Gas estimation @skip-on-coverage", () => {
        it("claiming rewards for $1 should not exceed gas limits @skip-on-coverage", async () => {
          const facade = await MockHelper.createBalancerComposableStableDepositorFacade(signer);
          await makeDepositorEnterTest(facade, {amount: "1"});
          const retExit = await makeDepositorClaimRewardsTest(facade);

          controlGasLimitsEx(retExit.gasUsed, BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_CLAIM_REWARDS, (u, t) => {
            expect(u).to.be.below(t + 1);
          });
        });
      });
    });
  });
//endregion Unit tests

});
