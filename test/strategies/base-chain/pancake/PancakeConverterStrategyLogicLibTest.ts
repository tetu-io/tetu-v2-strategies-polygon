import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BASE_NETWORK_ID, HardhatUtils, ZKEVM_NETWORK_ID} from "../../../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {
  IERC20Metadata__factory,
  IPairBasedDefaultStateProvider__factory, IPancakeMasterChefV3,
  IPancakeMasterChefV3__factory, IPancakeNonfungiblePositionManager,
  IPancakeNonfungiblePositionManager__factory, IPancakeV3Pool,
  IPancakeV3Pool__factory, IRebalancingStrategy__factory, PairBasedStrategyLogicLibFacade,
  PancakeConverterStrategyLogicLibFacade,
  PancakeDebtLibFacade
} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";
import fs from "fs";
import {IPancakeSaverParams, IPancakeState, PancakeState} from "../../../baseUT/strategies/pancake/PancakeState";
import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";
import {expect} from "chai";
import {NumberUtils} from "../../../baseUT/utils/NumberUtils";
import {BigNumber} from "ethers";

describe('PancakeConverterStrategyLogicLibTest', function () {
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let facade: PancakeConverterStrategyLogicLibFacade;

  interface IChainInfo {
    chainId: number;
    asset: string;
    pool: string;
    chef: string;
    swapper: string;
    controller: string;
  }

  const chains: number[] = [BASE_NETWORK_ID, /* ZKEVM_NETWORK_ID */ ]
  const chainInfos: IChainInfo[] = [
    {
      chainId: BASE_NETWORK_ID,
      asset: BaseAddresses.USDbC_TOKEN,
      pool: BaseAddresses.PANCAKE_POOL_USDC_USDbC_LP_100,
      swapper: BaseAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
      chef: BaseAddresses.PANCAKE_MASTER_CHEF_V3,
      controller: BaseAddresses.TETU_CONTROLLER,
    },
    {
      chainId: ZKEVM_NETWORK_ID,
      asset: ZkevmAddresses.USDC,
      pool: ZkevmAddresses.PANCAKE_POOL_USDT_USDC_LP,
      swapper: ZkevmAddresses.TETU_PANCAKE3_SWAPPER,
      chef: ZkevmAddresses.PANCAKE_MASTER_CHEF_V3,
      controller: ZkevmAddresses.TETU_CONTROLLER
    },
  ]

  async function getProps(
    pool: IPancakeV3Pool,
    facadePair: PairBasedStrategyLogicLibFacade,
    facadeDebtLib: PancakeDebtLibFacade
  ): Promise<{prop0: number, prop1: number}> {
    const tickSpacing = await pool.tickSpacing();
    const currentTick = (await pool.slot0()).tick;
    const tickRange = 0; // todo
    const fee = await pool.fee();
    const range = await facadePair.calcTickRange(currentTick, tickRange, tickSpacing);
    const props = await facadeDebtLib.getEntryDataProportions(pool.address, range.lowerTick, range.upperTick, false);
    const prop0 = +formatUnits(props.prop0, 18);
    const prop1 = +formatUnits(props.prop1, 18);
    console.log("props", prop0, prop1);

    return {prop0, prop1};
  }

  async function getFees(decimalsA: number, decimalsB: number): Promise<number[]> {
    const fees: number[] = [];
    // let's get amount of fees
    const snapshot3 = await TimeUtils.snapshot();
    const r = await facade.callStatic.claimRewards();
    // assume here, that r.tokensOut contains: [tokenA, tokenB, cake-reward]
    fees.push(+formatUnits(r.amountsOut[0], decimalsA));
    fees.push(+formatUnits(r.amountsOut[1], decimalsB));
    await TimeUtils.rollback(snapshot3);
    return fees;
  }


  chains.forEach(function (chainId: number) {
    const chainInfo = chainInfos[chainInfos.findIndex(x => x.chainId === chainId)];

    describe(`${chainId}`, function() {
      before(async function () {
        await HardhatUtils.setupBeforeTest(chainId);
        snapshotBefore = await TimeUtils.snapshot();
        [signer, signer2] = await ethers.getSigners();

        facade = await DeployerUtils.deployContract(signer, "PancakeConverterStrategyLogicLibFacade") as PancakeConverterStrategyLogicLibFacade;
      })
      after(async function () {
        await HardhatUtils.restoreBlockFromEnv();
        await TimeUtils.rollback(snapshotBefore);
      });

      async function waitForRewardsAndFees(multy: number) {
        const state = await PackedData.getDefaultState(
          IPairBasedDefaultStateProvider__factory.connect(facade.address, signer)
        );

        // wait to get rewards
        await TimeUtils.advanceNBlocks(20_000);
        console.log("------------------- wait for rewards, make swap to generate fee");
        await UniversalUtils.makePoolVolume(
          signer,
          state,
          chainInfo.swapper,
          parseUnits('10000', 6).mul(multy)
        );
      }

      describe("Study: typical user flow: enter/exit @skip-on-coverage", function () {
        let snapshot0: string;
        before(async function () {
          snapshot0 = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot0);
        });

        it("General flow: enter, wait, get rewards, withdraw", async () => {
          const strategyProfitHolder = ethers.Wallet.createRandom().address;
          const facadePair = await MockHelper.createPairBasedStrategyLogicLibFacade(signer);
          const facadeDebtLib = (await DeployerUtils.deployContract(signer, 'PancakeDebtLibFacade')) as PancakeDebtLibFacade;
          const chef = IPancakeMasterChefV3__factory.connect(chainInfo.chef, signer);
          console.log("chef", chef.address)
          const nftAddress = await chef.nonfungiblePositionManager();
          console.log("nftAddress", nftAddress)
          const nft = IPancakeNonfungiblePositionManager__factory.connect(nftAddress, signer);

          const pool = IPancakeV3Pool__factory.connect(chainInfo.pool, signer);
          const tokenA = await pool.token0();
          const tokenB = await pool.token1();
          const cakeToken = await chef.CAKE();
          console.log("token0", await IERC20Metadata__factory.connect(tokenA, signer).symbol());
          console.log("token1", await IERC20Metadata__factory.connect(tokenB, signer).symbol());

          const tickSpacing = await pool.tickSpacing();
          const currentTick = (await pool.slot0()).tick;
          const tickRange = 0; // todo

          console.log("tickSpacing", tickSpacing);
          console.log("currentTick", currentTick);
          console.log("tickRange", tickRange);

          const fee = await pool.fee();
          console.log("fee", fee);

          console.log("range");
          const range = await facadePair.calcTickRange(currentTick, tickRange, tickSpacing);
          console.log(range.lowerTick, range.upperTick);

          console.log("proportions");
          const props = await facadeDebtLib.getEntryDataProportions(pool.address, range.lowerTick, range.upperTick, false);
          console.log(+formatUnits(props.prop0, 18), +formatUnits(props.prop1, 18));

          // USDC, USDbC = token0, token1
          const amountTokenA = parseUnits("1000", 6);
          const amountTokenB = amountTokenA.mul(props.prop1).div(props.prop0);
          console.log("desired amounts", +formatUnits(amountTokenA, 6), +formatUnits(amountTokenB, 6));
          const amountTokenA2 = parseUnits("500", 6);
          const amountTokenB2 = amountTokenA2.mul(props.prop1).div(props.prop0);
          console.log("desired amounts 2", +formatUnits(amountTokenA2, 6), +formatUnits(amountTokenB2, 6));

          const pathOut = `./tmp/pancake-statuses.csv`;
          const statuses: IPancakeState[] = [];
          if (fs.existsSync(pathOut)) {
            fs.rmSync(pathOut);
          }

          const saver = async (title: string, p?: IPancakeSaverParams): Promise<IPancakeState> => {
            statuses.push(await PancakeState.getPancakeState(
              signer,
              title,
              {
                strategy: facade.address,
                chef,
                nft,
                strategyProfitHolder,
                funcGetPairState: async () => facade.state(),
                tokenA,
                tokenB,
                cakeToken,
                swapTokens: false
              },
              p
            ));
            console.log("status", title, statuses[statuses.length - 1]);
            PancakeState.saveToCSVColumns(pathOut, statuses);
            return statuses[statuses.length - 1];
          }

          console.log("----------------- get tokens on balance");
          await TokenUtils.getToken(tokenA, facade.address, amountTokenA);
          await TokenUtils.getToken(tokenB, facade.address, amountTokenB);

          await saver("b");

          await facade.initStrategyState(
            "0x255707B70BF90aa112006E1b07B9AeA6De021424",
            pool.address,
            0,
            0,
            tokenA,
            [0, 0, Misc.MAX_UINT, 0],
            chainInfo.chef
          );
          await facade.setStrategyProfitHolder(strategyProfitHolder);

          console.log("------------------- enter");
          const ret = await facade.callStatic.enter([amountTokenA, amountTokenB]);
          await facade.enter([amountTokenA, amountTokenB]);
          console.log("consumed amounts", +formatUnits(ret.amountsConsumed[0], 6), +formatUnits(ret.amountsConsumed[1], 6));

          await saver("enter1", {amounts: ret.amountsConsumed});

          await waitForRewardsAndFees(1);

          console.log("------------------- get tokens on balance 2");
          await TokenUtils.getToken(tokenA, facade.address, amountTokenA2);
          await TokenUtils.getToken(tokenB, facade.address, amountTokenB2);
          await saver("beforeEnter2");

          const ret2 = await facade.callStatic.enter([amountTokenA2, amountTokenB2]);
          await facade.enter([amountTokenA2, amountTokenB2]);
          console.log("consumed amounts", +formatUnits(ret2.amountsConsumed[0], 6), +formatUnits(ret2.amountsConsumed[1], 6));

          await saver("enter2", {amounts: ret2.amountsConsumed});

          await waitForRewardsAndFees(2);

          console.log("------------------- claim rewards and fees");
          const rewards1 = await facade.callStatic.claimRewards();
          await facade.claimRewards();
          for (let i = 0; i < rewards1.tokensOut.length; ++i) {
            const token = await IERC20Metadata__factory.connect(rewards1.tokensOut[i], signer)
            console.log("rewards", await token.symbol(), +formatUnits(rewards1.amountsOut[i], await token.decimals()));
          }
          await saver("claimRewards", {rewardTokens: rewards1.tokensOut, rewardAmounts: rewards1.amountsOut});

          await waitForRewardsAndFees(3);

          const statusBeforeExit1 = await saver("beforeExit1");
          console.log("------------------- exit 1");
          const retExit1 = await facade.callStatic.exit(statusBeforeExit1.totalLiquidity.div(2), false);
          await facade.exit(statusBeforeExit1.totalLiquidity.div(2), false);

          await saver("exit1", {amounts: retExit1});

          await waitForRewardsAndFees(4);
          const statusBeforeExit2 = await saver("beforeExit2");
          console.log("------------------- exit 2");
          const retExit2 = await facade.callStatic.exit(statusBeforeExit2.totalLiquidity, false);
          await facade.exit(statusBeforeExit2.totalLiquidity, false);

          await saver("exit2", {amounts: retExit2});
        });
      });

      describe(`User flow: enter, exit, quoteExit, claimRewards`, function () {
        interface ITestSet {
          swapTokens: boolean;
        }
        const testSets: ITestSet[] = [
          {swapTokens: true},
          {swapTokens: false},
        ]

        testSets.forEach(function (testSet: ITestSet) {
          describe(`Swap tokens = ${testSet.swapTokens}`, function () {
            const strategyProfitHolder = ethers.Wallet.createRandom().address;
            const pathOut = `./tmp/pancake-flows-${testSet.swapTokens}.csv`;
            const statuses: IPancakeState[] = [];

            let snapshotRoot: string;
            let facadePair: PairBasedStrategyLogicLibFacade;
            let facadeDebtLib: PancakeDebtLibFacade;
            let chef: IPancakeMasterChefV3;
            let nft: IPancakeNonfungiblePositionManager;
            let pool: IPancakeV3Pool;
            let tokenA: string;
            let tokenB: string;
            let cakeToken: string;
            let amountTokenA: number;
            let amountTokenB: number;
            let decimalsA: number;
            let decimalsB: number;

            let initState: IPancakeState;

            const saver = async (title: string, p?: IPancakeSaverParams): Promise<IPancakeState> => {
              statuses.push(await PancakeState.getPancakeState(
                signer,
                title,
                {
                  strategy: facade.address,
                  chef,
                  nft,
                  strategyProfitHolder,
                  funcGetPairState: async () => facade.state(),
                  tokenA,
                  tokenB,
                  cakeToken,
                  swapTokens: testSet.swapTokens
                },
                p
              ));
              console.log("status", title, statuses[statuses.length - 1]);
              PancakeState.saveToCSVColumns(pathOut, statuses);
              return statuses[statuses.length - 1];
            };

            before(async function () {
              snapshotRoot = await TimeUtils.snapshot();

              facadePair = await MockHelper.createPairBasedStrategyLogicLibFacade(signer);
              facadeDebtLib = (await DeployerUtils.deployContract(signer, 'PancakeDebtLibFacade')) as PancakeDebtLibFacade;

              chef = IPancakeMasterChefV3__factory.connect(chainInfo.chef, signer);
              nft = IPancakeNonfungiblePositionManager__factory.connect(await chef.nonfungiblePositionManager(), signer);

              pool = IPancakeV3Pool__factory.connect(chainInfo.pool, signer);
              tokenA = await pool.token0();
              tokenB = await pool.token1();
              cakeToken = await chef.CAKE();

              const {prop0, prop1} = await getProps(pool, facadePair, facadeDebtLib);

              amountTokenA = 1000;
              amountTokenB = amountTokenA * prop1 / prop0;

              decimalsA = await IERC20Metadata__factory.connect(tokenA, signer).decimals();
              decimalsB = await IERC20Metadata__factory.connect(tokenB, signer).decimals();
              console.log("amountTokenA/B", amountTokenA, amountTokenB);

              if (fs.existsSync(pathOut)) {
                fs.rmSync(pathOut);
              }

              console.log("----------------- get tokens on balance");
              await TokenUtils.getToken(tokenA, facade.address, parseUnits(amountTokenA.toString(), decimalsA));
              await TokenUtils.getToken(tokenB, facade.address, NumberUtils.parseUnitsSafe(amountTokenB, decimalsB));

              initState = await saver("b");

              await facade.initStrategyState(
                chainInfo.controller,
                pool.address,
                0,
                0,
                testSet.swapTokens ? tokenB : tokenA,
                [0, 0, Misc.MAX_UINT, 0],
                chainInfo.chef
              );
              await facade.setStrategyProfitHolder(strategyProfitHolder);

              await IERC20Metadata__factory.connect(cakeToken, await Misc.impersonate(strategyProfitHolder)).approve(facade.address, Misc.MAX_UINT);
              await IERC20Metadata__factory.connect(tokenA, await Misc.impersonate(strategyProfitHolder)).approve(facade.address, Misc.MAX_UINT);
              await IERC20Metadata__factory.connect(tokenB, await Misc.impersonate(strategyProfitHolder)).approve(facade.address, Misc.MAX_UINT);
            });
            after(async function () {
              await TimeUtils.rollback(snapshotRoot);
            });

            describe("Enter", () => {
              let snapshot0: string;
              let stateEnter1: IPancakeState;
              before(async function () {
                console.log("Enter");
                snapshot0 = await TimeUtils.snapshot();
                await prepareEnter();
              });
              after(async function () {
                await TimeUtils.rollback(snapshot0);
              });

              async function prepareEnter() {
                const amountsDesired = testSet.swapTokens
                  ? [NumberUtils.parseUnitsSafe(amountTokenB, decimalsB), parseUnits(amountTokenA.toString(), decimalsA)]
                  : [parseUnits(amountTokenA.toString(), decimalsA), NumberUtils.parseUnitsSafe(amountTokenB, decimalsB),];
                console.log("amountsDesired", amountsDesired);

                const ret = await facade.callStatic.enter(amountsDesired);
                await facade.enter(amountsDesired);

                stateEnter1 = await saver("enter1", {amounts: ret.amountsConsumed});
                await waitForRewardsAndFees(1);
              }

              it("Consumed amounts should be near to desired amounts", async () => {
                expect(stateEnter1.retAmountTokenA).approximately(amountTokenA, 5);
                expect(stateEnter1.retAmountTokenB).approximately(amountTokenB, 5);
              });

              it("should initialize token ID", async () => {
                expect(stateEnter1.tokenId !== 0).eq(true);
              });

              it("should transfer nft to master chef", async () => {
                expect(stateEnter1.masterChefBalance).eq(1);
              });

              it("should increase totalLiquidity to value equal to positionLiquidity", async () => {
                expect(stateEnter1.positionLiquidity.gt(0)).eq(true);
                expect(stateEnter1.positionLiquidity).eq(stateEnter1.totalLiquidity);
              });

              describe("Increase liquidity", () => {
                let snapshot1: string;
                let amountTokenA2: number;
                let amountTokenB2: number;
                let stateBeforeEnter2: IPancakeState;
                let stateEnter2: IPancakeState;

                before(async function () {
                  console.log("enter2");
                  snapshot1 = await TimeUtils.snapshot();

                  const {prop0, prop1} = await getProps(pool, facadePair, facadeDebtLib);

                  amountTokenA2 = 500;
                  amountTokenB2 = amountTokenA2 * prop1 / prop0;

                  const amountsDesired2 = testSet.swapTokens
                    ? [NumberUtils.parseUnitsSafe(amountTokenB2, decimalsB), parseUnits(amountTokenA2.toString(), decimalsA)]
                    : [parseUnits(amountTokenA2.toString(), decimalsA), NumberUtils.parseUnitsSafe(amountTokenB2, decimalsB),];

                  console.log("desiredAmounts", amountsDesired2);

                  await TokenUtils.getToken(tokenA, facade.address, parseUnits(amountTokenA2.toString(), decimalsA));
                  await TokenUtils.getToken(tokenB, facade.address, NumberUtils.parseUnitsSafe(amountTokenB2, decimalsB));

                  stateBeforeEnter2 = await saver("beforeEnter2");

                  const ret = await facade.callStatic.enter(amountsDesired2);
                  await facade.enter(amountsDesired2);

                  stateEnter2 = await saver("enter2", {amounts: ret.amountsConsumed});

                  await waitForRewardsAndFees(2);
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot1);
                });

                it("Consumed amounts should be near to desired amounts", async () => {
                  expect(stateEnter2.retAmountTokenA).approximately(amountTokenA2, 1);
                  expect(stateEnter2.retAmountTokenB).approximately(amountTokenB2, 1);
                });

                it("should not change token ID", async () => {
                  expect(stateEnter2.tokenId).eq(stateBeforeEnter2.tokenId);
                });

                it("should increase totalLiquidity and positionLiquidity", async () => {
                  expect(stateEnter2.positionLiquidity.gt(stateBeforeEnter2.positionLiquidity)).eq(true);
                  expect(stateEnter2.positionLiquidity).eq(stateEnter2.totalLiquidity);
                });

                it("should have unclaimed rewards", async () => {
                  expect(stateEnter2.pendingCake).gt(0);
                });

                describe("Claim rewards", () => {
                  let snapshot2: string;
                  let stateBeforeClaimRewards: IPancakeState;
                  let stateClaimRewards: IPancakeState;
                  before(async function () {
                    snapshot2 = await TimeUtils.snapshot();

                    stateBeforeClaimRewards = await saver("beforeClaimRewards");
                    const rewards1 = await facade.callStatic.claimRewards();
                    await facade.claimRewards();

                    for (let i = 0; i < rewards1.tokensOut.length; ++i) {
                      const token = await IERC20Metadata__factory.connect(rewards1.tokensOut[i], signer);
                      console.log("rewards", await token.symbol(), +formatUnits(rewards1.amountsOut[i], await token.decimals()));
                    }

                    stateClaimRewards = await saver("claimRewards", {
                      rewardTokens: rewards1.tokensOut,
                      rewardAmounts: rewards1.amountsOut
                    });
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshot2);
                  });

                  it("should not have unclaimed rewards", async () => {
                    expect(stateClaimRewards.pendingCake).eq(0);
                  });

                  it("should put claimed rewards on strategy balance", async () => {
                    expect(stateClaimRewards.facadeCakeBalance).eq(stateBeforeClaimRewards.pendingCake);
                  });

                  it("should return expected amounts", async () => {
                    expect(stateClaimRewards.facadeCakeBalance).eq(stateBeforeClaimRewards.pendingCake);
                  });

                  it("should receive fees on the balance", async () => {
                    expect(stateClaimRewards.userBalanceTokenA).approximately(stateBeforeClaimRewards.userBalanceTokenA + stateClaimRewards.retRewardsTokenA, 1e-5);
                    expect(stateClaimRewards.userBalanceTokenB).approximately(stateBeforeClaimRewards.userBalanceTokenB + stateClaimRewards.retRewardsTokenB, 1e-5);
                  });
                });

                describe("Partial exit (half of the liquidity)", () => {
                  let snapshot2: string;
                  let statusBeforeExit1: IPancakeState;
                  let statusExit1: IPancakeState;
                  let liquidityToWithdraw: BigNumber;
                  let fees: number[];
                  const quotedAmounts: number[] = [];
                  before(async function () {
                    snapshot2 = await TimeUtils.snapshot();

                    statusBeforeExit1 = await saver("beforeExit1");
                    liquidityToWithdraw = statusBeforeExit1.totalLiquidity.div(2);
                    const quoted = await facade.callStatic.quoteExit(liquidityToWithdraw);
                    quotedAmounts.push(+formatUnits(quoted[0], decimalsA));
                    quotedAmounts.push(+formatUnits(quoted[1], decimalsB));

                    fees = await getFees(decimalsA, decimalsB);

                    const ret = await facade.callStatic.exit(liquidityToWithdraw, false);
                    await facade.exit(liquidityToWithdraw, false);
                    statusExit1 = await saver("exit1", {amounts: ret});
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshot2);
                  });

                  it("should reduce liquidity on expected value", async () => {
                    expect(statusExit1.totalLiquidity.eq(statusBeforeExit1.totalLiquidity.sub(liquidityToWithdraw))).eq(true);
                    expect(statusExit1.totalLiquidity.eq(statusExit1.positionLiquidity));
                  });

                  it("quoted amount should be equal to real amounts", async () => {
                    expect(quotedAmounts[testSet.swapTokens ? 1 : 0]).approximately(statusExit1.retAmountTokenA, 1e-3);
                    expect(quotedAmounts[testSet.swapTokens ? 0 : 1]).approximately(statusExit1.retAmountTokenB, 1e-3);
                  });

                  it("should increase strategy balances on expected values", async () => {
                    expect(statusExit1.userBalanceTokenA).approximately(statusBeforeExit1.userBalanceTokenA + statusExit1.retAmountTokenA, 1e-5);
                    expect(statusExit1.userBalanceTokenB).approximately(statusBeforeExit1.userBalanceTokenB + statusExit1.retAmountTokenB, 1e-5);
                  });

                  it("should move all fees and rewards to strategyProfitHolder", async () => {
                    expect(statusExit1.profitHolderCakeBalance).eq(statusBeforeExit1.pendingCake);
                    expect(statusExit1.profitHolderBalanceTokenA).eq(fees[testSet.swapTokens ? 1 : 0]);
                    expect(statusExit1.profitHolderBalanceTokenB).eq(fees[testSet.swapTokens ? 0 : 1]);
                  });

                  describe("Full exit", () => {
                    let snapshot3: string;
                    let statusBeforeExit2: IPancakeState;
                    let statusExit2: IPancakeState;
                    let liquidityToWithdraw2: BigNumber;
                    let fees: number[];
                    const quotedAmounts2: number[] = [];
                    before(async function () {
                      snapshot3 = await TimeUtils.snapshot();
                      await waitForRewardsAndFees(4);

                      statusBeforeExit2 = await saver("beforeExit2");
                      liquidityToWithdraw2 = statusBeforeExit2.totalLiquidity;
                      const quoted = await facade.callStatic.quoteExit(liquidityToWithdraw2);
                      quotedAmounts2.push(+formatUnits(quoted[0], decimalsA));
                      quotedAmounts2.push(+formatUnits(quoted[1], decimalsB));

                      fees = await getFees(decimalsA, decimalsB);

                      const ret = await facade.callStatic.exit(liquidityToWithdraw2, false);
                      await facade.exit(liquidityToWithdraw2, false);
                      statusExit2 = await saver("exit2", {amounts: ret});
                    });
                    after(async function () {
                      await TimeUtils.rollback(snapshot3);
                    });

                    it("should reduce liquidity to zero", async () => {
                      expect(statusExit2.totalLiquidity.eq(0)).eq(true);
                      expect(statusExit2.totalLiquidity.eq(0)).eq(true);
                    });

                    it("quoted amount should be equal to real amounts", async () => {
                      expect(quotedAmounts2[testSet.swapTokens ? 1 : 0]).approximately(statusExit2.retAmountTokenA, 1e-3);
                      expect(quotedAmounts2[testSet.swapTokens ? 0 : 1]).approximately(statusExit2.retAmountTokenB, 1e-3);
                    });

                    it("should increase strategy balances on expected values", async () => {
                      expect(statusExit2.userBalanceTokenA).approximately(statusBeforeExit2.userBalanceTokenA + statusExit2.retAmountTokenA, 1e-6);
                      expect(statusExit2.userBalanceTokenB).approximately(statusBeforeExit2.userBalanceTokenB + statusExit2.retAmountTokenB, 1e-6);
                    });

                    it("should move all fees and rewards to strategyProfitHolder", async () => {
                      expect(statusExit2.profitHolderCakeBalance).eq(statusBeforeExit2.profitHolderCakeBalance);
                      expect(statusExit2.profitHolderBalanceTokenA).eq(fees[testSet.swapTokens ? 1 : 0]);
                      expect(statusExit2.profitHolderBalanceTokenB).eq(fees[testSet.swapTokens ? 0 : 1]);
                    });

                    it("should withdraw nft", () => {
                      expect(statusExit2.masterChefBalance).eq(0);
                    });
                  });
                });
              });

              describe("callNftPositions", function() {
                it("should return exactly same values as nft.positions", async () => {
                  const tokenId = (await facade.state()).tokenId;
                  const expected = await nft.positions(tokenId);
                  const ret = await facadeDebtLib.callNftPositions(nft.address, tokenId);
                  expect([ret.tickLower, ret.tickUpper].join()).eq([expected.tickLower, expected.tickUpper].join());
                });
              });

              describe("Try to enter with modified tick range", () => {
                let snapshot1: string;

                before(async function () {
                  console.log("enter2");
                  snapshot1 = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot1);
                });

                it("should revert if liquidity is not zero", async () => {
                  await facade.moveTickRange(1);

                  const {prop0, prop1} = await getProps(pool, facadePair, facadeDebtLib);

                  const amountTokenA2 = 500;
                  const amountTokenB2 = amountTokenA2 * prop1 / prop0;

                  const amountsDesired2 = testSet.swapTokens
                    ? [NumberUtils.parseUnitsSafe(amountTokenB2, decimalsB), parseUnits(amountTokenA2.toString(), decimalsA)]
                    : [parseUnits(amountTokenA2.toString(), decimalsA), NumberUtils.parseUnitsSafe(amountTokenB2, decimalsB),];

                  await TokenUtils.getToken(tokenA, facade.address, parseUnits(amountTokenA2.toString(), decimalsA));
                  await TokenUtils.getToken(tokenB, facade.address, NumberUtils.parseUnitsSafe(amountTokenB2, decimalsB));

                  await expect(facade.enter(amountsDesired2)).reverted; // reverted inside v.chef.burn(v.tokenId);
                });
              });
            });
          });
        });
      });

    });
  });
});
