import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../scripts/utils/Misc";
import {
  ConverterController__factory, IBorrowManager__factory,
  IERC20Metadata__factory,
  IPlatformAdapter, IPlatformAdapter__factory,
  ITetuConverter,
  ITetuConverter__factory, ITetuLiquidator,
  PairBasedStrategyLibFacade
} from "../../../typechain";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {BigNumber} from "ethers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {
  AGGREGATOR_ONE_INCH, AGGREGATOR_OPEN_OCEAN,
  AGGREGATOR_TETU_LIQUIDATOR, AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR,
  AggregatorType,
  AggregatorUtils
} from "../../baseUT/utils/AggregatorUtils";
import {IterationPlanLib} from "../../../typechain/contracts/test/facades/PairBasedStrategyLibFacade";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID, ZKEVM_NETWORK_ID} from '../../baseUT/utils/HardhatUtils';
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {PLAN_REPAY_SWAP_REPAY_1, PLATFORM_KIND_AAVE2_2, PLATFORM_KIND_AAVE3_3} from "../../baseUT/AppConstants";
import {InjectUtils} from "../../baseUT/strategies/InjectUtils";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";
import {ZkevmCoreTokensUtils} from "../../baseUT/cores/ZkevmCoreTokens";
import {ITetuLiquidatorPoolInfo, TetuLiquidatorUtils} from "../../baseUT/utils/TetuLiquidatorUtils";

describe('PairBasedStrategyLibAggregatorsTest', () => {
  const CHAINS_IN_ORDER_EXECUTION: number[] = [ZKEVM_NETWORK_ID, BASE_NETWORK_ID, POLYGON_NETWORK_ID];

  interface ITestSet {
    chainId: number;
    tetuLiquidator: string;
    tetuConverter: string;
    aggregator: string;
    aggregatorType: AggregatorType;
    tokenIn: string;
    tokenOut: string;
    liquidatorPools?: ITetuLiquidatorPoolInfo[];
  }

  const CHAINS: ITestSet[] = [
    {
      chainId: POLYGON_NETWORK_ID,
      tetuLiquidator: MaticAddresses.TETU_LIQUIDATOR,
      tetuConverter: MaticAddresses.TETU_CONVERTER,
      aggregator: MaticAddresses.AGG_ONEINCH_V5,
      aggregatorType: AGGREGATOR_ONE_INCH,
      tokenIn: MaticAddresses.USDC_TOKEN,
      tokenOut: MaticAddresses.USDT_TOKEN
    },
    {
      chainId: BASE_NETWORK_ID,
      tetuLiquidator: BaseAddresses.TETU_LIQUIDATOR,
      tetuConverter: BaseAddresses.TETU_CONVERTER,
      aggregator: BaseAddresses.AGG_ONEINCH_V5,
      aggregatorType: AGGREGATOR_ONE_INCH,
      tokenIn: BaseAddresses.USDC_TOKEN,
      tokenOut: BaseAddresses.USDbC_TOKEN
    },
    {
      chainId: ZKEVM_NETWORK_ID,
      tetuLiquidator: ZkevmAddresses.TETU_LIQUIDATOR,
      tetuConverter: ZkevmAddresses.TETU_CONVERTER,
      aggregator: ZkevmAddresses.AGG_OPENOCEAN_ROUTER,
      aggregatorType: AGGREGATOR_OPEN_OCEAN,
      tokenIn: ZkevmAddresses.USDC_TOKEN,
      tokenOut: ZkevmAddresses.USDT_TOKEN,

      liquidatorPools: ZkevmCoreTokensUtils.getLiquidatorPools(),
    },
  ];

  CHAINS_IN_ORDER_EXECUTION.forEach(function (chainId) {
    describe(`chain ${chainId}`, function () {
      CHAINS.forEach(function (testSet: ITestSet) {
        if (chainId === testSet.chainId) {
          let snapshotBefore: string;
          let signer: SignerWithAddress;
          let facade: PairBasedStrategyLibFacade;
          let converter: ITetuConverter;
          let converterGovernance: SignerWithAddress;

          before(async function () {
            await HardhatUtils.setupBeforeTest(chainId);
            snapshotBefore = await TimeUtils.snapshot();
            await HardhatUtils.switchToMostCurrentBlock(chainId); // 1inch works on current block only

            [signer] = await ethers.getSigners();
            await InjectUtils.injectTetuConverterBeforeAnyTest(signer);

            facade = await MockHelper.createPairBasedStrategyLibFacade(signer);
            converter = ITetuConverter__factory.connect(testSet.tetuConverter, signer);
            const converterController = await ConverterController__factory.connect(await converter.controller(), signer);

            converterGovernance = await Misc.impersonate(await converterController.governance());
            await converterController.connect(converterGovernance).setWhitelistValues([facade.address], true);

            if (testSet.liquidatorPools) {
              const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
              const liquidatorOperator = await Misc.impersonate('0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94')
              await tools.liquidator.connect(liquidatorOperator).addLargestPools(TetuLiquidatorUtils.getLargePools(testSet.liquidatorPools), true);
              await tools.liquidator.connect(liquidatorOperator).addBlueChipsPools(TetuLiquidatorUtils.getBlueChips(testSet.liquidatorPools), true);
            }
          });
          after(async function () {
            await HardhatUtils.restoreBlockFromEnv();
            await TimeUtils.rollback(snapshotBefore);
          });

          describe("swap", () => {
            interface ISwapParams {
              tokens: string[];
              liquidationThresholds: string[];
              indexIn: number;
              indexOut: number;
              amountIn: string;
              aggregatorType: AggregatorType;

              tokenToSwap?: string;
              amountToSwap?: string;
              mockConverter?: string;
              incorrectAggregatorAddress?: boolean;
            }

            interface ISwapResults {
              balances: number[];
              spentAmountIn: number;
            }

            async function makeSwap(p: ISwapParams): Promise<ISwapResults> {
              const decimalsTokenIn = await IERC20Metadata__factory.connect(p.tokens[p.indexIn], signer).decimals();
              const amountIn = parseUnits(p.amountIn, decimalsTokenIn);
              const amountToSwap = p.amountToSwap
                ? parseUnits(p.amountToSwap, decimalsTokenIn)
                : amountIn;

              await TokenUtils.getToken(p.tokens[p.indexIn], facade.address, amountIn);

              const swapData = await AggregatorUtils.buildSwapData(
                signer,
                chainId,
                p.aggregatorType,
                p.tokens[p.indexIn],
                p.tokens[p.indexOut],
                amountToSwap,
                facade.address,
              );

              const planInputParams: IterationPlanLib.SwapRepayPlanParamsStruct = {
                converter: p.mockConverter || testSet.tetuConverter,
                liquidator: testSet.tetuLiquidator,
                tokens: p.tokens,
                liquidationThresholds: await Promise.all(p.tokens.map(
                  async (token: string, index: number) => parseUnits(
                    p.liquidationThresholds[index],
                    await IERC20Metadata__factory.connect(token, signer).decimals()
                  )
                )),
                usePoolProportions: false,
                prices: [parseUnits("1", 18), parseUnits("1", 18)],
                decs: [6, 6],

                // not used by _swap()

                propNotUnderlying18: 0,
                balanceAdditions: [0, 0],
                planKind: 0,
                entryDataParam: 0
              };
              const aggParams = {
                useLiquidator: p.aggregatorType === AGGREGATOR_TETU_LIQUIDATOR,
                amountToSwap,
                tokenToSwap: p.tokenToSwap ?? p.tokens[p.indexIn],
                aggregator: p.incorrectAggregatorAddress
                  ? testSet.tetuConverter // emulate incorrect aggregator address
                  : p.aggregatorType === AGGREGATOR_TETU_LIQUIDATOR || p.aggregatorType === AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR
                    ? testSet.tetuLiquidator
                    : testSet.aggregator,
                swapData
              };

              const {
                spentAmountIn,
                updatedPropNotUnderlying18
              } = await facade.callStatic._swap(planInputParams, aggParams, p.indexIn, p.indexOut, amountIn);
              await facade._swap(planInputParams, aggParams, p.indexIn, p.indexOut, amountIn);

              return {
                spentAmountIn: +formatUnits(spentAmountIn, decimalsTokenIn),
                balances: await Promise.all(p.tokens.map(
                  async (token: string, index: number) => +formatUnits(
                    await IERC20Metadata__factory.connect(token, signer).balanceOf(facade.address),
                    await IERC20Metadata__factory.connect(token, signer).decimals()
                  )
                )),
              }
            }

            describe("Good paths", () => {
              describe("amountIn > liquidation threshold", () => {
                describe("swap 0=>1", () => {
                  describe("Use liquidator", () => {
                    let snapshot: string;
                    before(async function () {
                      snapshot = await TimeUtils.snapshot();
                    });
                    after(async function () {
                      await TimeUtils.rollback(snapshot);
                    });

                    async function makeSwapTest(): Promise<ISwapResults> {
                      return makeSwap({
                        tokens: [testSet.tokenIn, testSet.tokenOut],
                        amountIn: "100",
                        indexIn: 0,
                        indexOut: 1,
                        liquidationThresholds: ["0", "0"],
                        aggregatorType: AGGREGATOR_TETU_LIQUIDATOR
                      });
                    }

                    it("should return amountIn", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.spentAmountIn).eq(100);
                    })
                    it("should set zero balanceIn", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.balances[0]).eq(0);
                    })
                    it("should set not-zero balanceOut", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.balances[1]).gt(80); // we assume that 1USDC gives us at least 80 DAI or more
                    })
                  });
                  describe(`${testSet.aggregatorType}`, () => {
                    let snapshot: string;
                    before(async function () {
                      snapshot = await TimeUtils.snapshot();
                    });
                    after(async function () {
                      await TimeUtils.rollback(snapshot);
                    });

                    async function makeSwapTest(): Promise<ISwapResults> {
                      return makeSwap({
                        tokens: [testSet.tokenIn, testSet.tokenOut],
                        amountIn: "100",
                        indexIn: 0,
                        indexOut: 1,
                        liquidationThresholds: ["0", "0"],
                        aggregatorType: testSet.aggregatorType
                      });
                    }

                    it("should return amountIn", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.spentAmountIn).eq(100);
                    })
                    it("should set zero balanceIn", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.balances[0]).eq(0);
                    })
                    it("should set not-zero balanceOut", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.balances[1]).gt(80); // we assume that 1USDC gives us at least 80 DAI or more
                    })
                  });
                });
                describe("swap 1=>0", () => {
                  describe("Use liquidator", () => {
                    let snapshot: string;
                    before(async function () {
                      snapshot = await TimeUtils.snapshot();
                    });
                    after(async function () {
                      await TimeUtils.rollback(snapshot);
                    });

                    async function makeSwapTest(): Promise<ISwapResults> {
                      return makeSwap({
                        tokens: [testSet.tokenIn, testSet.tokenOut],
                        amountIn: "100",
                        indexIn: 1,
                        indexOut: 0,
                        liquidationThresholds: ["0", "0"],
                        aggregatorType: AGGREGATOR_TETU_LIQUIDATOR
                      });
                    }

                    it("should return amountIn", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.spentAmountIn).eq(100);
                    })
                    it("should set zero balanceIn", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.balances[0]).gt(80); // we assume that 1 DAI gives us at least 80 USDC or more
                    })
                    it("should set not-zero balanceOut", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.balances[1]).eq(0);
                    })
                  });
                  describe(`${testSet.aggregatorType}`, () => {
                    let snapshot: string;
                    before(async function () {
                      snapshot = await TimeUtils.snapshot();
                    });
                    after(async function () {
                      await TimeUtils.rollback(snapshot);
                    });

                    async function makeSwapTest(): Promise<ISwapResults> {
                      return makeSwap({
                        tokens: [testSet.tokenIn, testSet.tokenOut],
                        amountIn: "100",
                        indexIn: 1,
                        indexOut: 0,
                        liquidationThresholds: ["0", "0"],
                        aggregatorType: testSet.aggregatorType
                      });
                    }

                    it("should return amountIn", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.spentAmountIn).eq(100);
                    })
                    it("should set zero balanceIn", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.balances[0]).gt(80); // we assume that 1 DAI gives us at least 80 USDC or more
                    })
                    it("should set not-zero balanceOut", async () => {
                      const r = await loadFixture(makeSwapTest);
                      expect(r.balances[1]).eq(0);
                    })
                  });
                });
              });
              describe("amountIn > amountToSwap, use liquidator as aggregator", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeSwapTest(): Promise<ISwapResults> {
                  return makeSwap({
                    tokens: [testSet.tokenIn, testSet.tokenOut],
                    amountIn: "100",
                    amountToSwap: "90",
                    indexIn: 0,
                    indexOut: 1,
                    liquidationThresholds: ["0", "0"],
                    aggregatorType: AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR
                  });
                }

                it("should return amountIn", async () => {
                  const r = await loadFixture(makeSwapTest);
                  expect(r.spentAmountIn).eq(90);
                })
                it("should set zero balanceIn", async () => {
                  const r = await loadFixture(makeSwapTest);
                  expect(r.balances[0]).eq(10); // 100 - 90
                })
              });
            });

            describe("Bad paths", () => {
              describe("amountIn <= liquidation threshold", () => {
                let snapshot: string;
                before(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                async function makeSwapTest(): Promise<ISwapResults> {
                  return makeSwap({
                    tokens: [testSet.tokenIn, testSet.tokenOut],
                    amountIn: "100",
                    indexIn: 0,
                    indexOut: 1,
                    liquidationThresholds: ["100", "0"],
                    aggregatorType: AGGREGATOR_TETU_LIQUIDATOR
                  });
                }

                it("should return zero amount", async () => {
                  const r = await loadFixture(makeSwapTest);
                  expect(r.spentAmountIn).eq(0);
                })
                it("should not change balances", async () => {
                  const r = await loadFixture(makeSwapTest);
                  expect(r.balances.join()).eq([100, 0].join());
                })
              });
              describe("reverts", () => {
                let snapshot: string;
                beforeEach(async function () {
                  snapshot = await TimeUtils.snapshot();
                });
                afterEach(async function () {
                  await TimeUtils.rollback(snapshot);
                });

                it("should revert if token to swap is incorrect, liquidator as aggregator", async () => {
                  await expect(
                    makeSwap({
                      tokens: [testSet.tokenIn, testSet.tokenOut],
                      amountIn: "100",
                      indexIn: 1, // (!) wrong
                      indexOut: 0, // (!) wrong
                      liquidationThresholds: ["0", "0"],
                      aggregatorType: AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR,

                      tokenToSwap: testSet.tokenIn,
                    })
                  ).revertedWith("TS-25 swap by agg"); // INCORRECT_SWAP_BY_AGG_PARAM
                });

                it("should revert if token to swap is incorrect, liquidator", async () => {
                  await expect(
                    makeSwap({
                      tokens: [testSet.tokenIn, testSet.tokenOut],
                      amountIn: "100",
                      indexIn: 1, // (!) wrong
                      indexOut: 0, // (!) wrong
                      liquidationThresholds: ["0", "0"],
                      aggregatorType: AGGREGATOR_TETU_LIQUIDATOR,

                      tokenToSwap: testSet.tokenIn,
                    })
                  ).revertedWith("TS-25 swap by agg"); // INCORRECT_SWAP_BY_AGG_PARAM
                });

                it("should revert if aggregator is incorrect", async () => {
                  await expect(
                    makeSwap({
                      tokens: [testSet.tokenIn, testSet.tokenOut],
                      amountIn: "100",
                      indexIn: 0,
                      indexOut: 1,
                      liquidationThresholds: ["0", "0"],
                      incorrectAggregatorAddress: true,
                      aggregatorType: AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR
                    })
                  ).revertedWith("PBS-1 Unknown router"); // UNKNOWN_SWAP_ROUTER
                })

                it("should revert if amountToSwap exceeds balance", async () => {
                  await expect(
                    makeSwap({
                      amountIn: "100", // (!) balance is equal to amountIn
                      amountToSwap: "101", // (!) but we are going to swap bigger amount

                      tokens: [testSet.tokenIn, testSet.tokenOut],
                      indexIn: 0,
                      indexOut: 1,
                      liquidationThresholds: ["0", "0"],
                      aggregatorType: AGGREGATOR_TETU_LIQUIDATOR_AS_AGGREGATOR,
                    })
                  ).revertedWith("TS-7 not enough balance"); // NOT_ENOUGH_BALANCE
                })

                it("should revert if price impact is too high", async () => {
                  const mockConverter = await MockHelper.createMockTetuConverter(signer);
                  await mockConverter.setIsConversionValid(
                    testSet.tokenIn,
                    parseUnits("100", 6),
                    testSet.tokenOut,
                    0, // arbitrary (unknown beforehand) amount-out
                    0 // FAILED_0
                  );

                  await expect(
                    makeSwap({
                      mockConverter: mockConverter.address,

                      tokens: [testSet.tokenIn, testSet.tokenOut],
                      amountIn: "100", // (!) balance is equal to amountIn
                      indexIn: 0,
                      indexOut: 1,
                      liquidationThresholds: ["0", "0"],
                      aggregatorType: AGGREGATOR_TETU_LIQUIDATOR,
                    })
                  ).revertedWith("TS-16 price impact"); // PRICE_IMPACT
                });
              });
            });
          });
        }
      });
    });
  });

  /** Skipped, because currently we have only single pool adapter (AAVE3) that is able to borrow USDT under USDC */
  describe.skip("withdrawStep", () => {
    CHAINS.forEach(function (testSet: ITestSet) {
      if (POLYGON_NETWORK_ID === testSet.chainId) {
        let snapshotBefore: string;
        let signer: SignerWithAddress;
        let facade: PairBasedStrategyLibFacade;
        let converter: ITetuConverter;
        let converterGovernance: SignerWithAddress;
        let platformAdapterAave2: IPlatformAdapter;
        let platformAdapterAave3: IPlatformAdapter;

        before(async function () {
          await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
          snapshotBefore = await TimeUtils.snapshot();
          await HardhatUtils.switchToMostCurrentBlock(); // 1inch works on current block only

          [signer] = await ethers.getSigners();
          await InjectUtils.injectTetuConverterBeforeAnyTest(signer);

          facade = await MockHelper.createPairBasedStrategyLibFacade(signer);
          converter = ITetuConverter__factory.connect(testSet.tetuConverter, signer);
          const converterController = await ConverterController__factory.connect(await converter.controller(), signer);

          converterGovernance = await Misc.impersonate(await converterController.governance());
          await converterController.connect(converterGovernance).setWhitelistValues([facade.address], true);

          const borrowManager = await IBorrowManager__factory.connect(await converterController.borrowManager(), signer);
          const countPlatformAdapters = (await borrowManager.platformAdaptersLength()).toNumber();
          for (let i = 0; i < countPlatformAdapters; ++i) {
            const pa = IPlatformAdapter__factory.connect(await borrowManager.platformAdaptersAt(i), signer);
            const platformKind = await pa.platformKind();
            if (platformKind === PLATFORM_KIND_AAVE2_2) {
              platformAdapterAave2 = pa;
            } else if (platformKind === PLATFORM_KIND_AAVE3_3) {
              platformAdapterAave3 = pa;
            } else {
              // disable all platform adapters except aave2 and aave3
              // we use aave 2 and aave3 in this test because they both have debt-gap != 0
              await pa.connect(converterGovernance).setFrozen(true);
            }
          }
          if (!platformAdapterAave2 || !platformAdapterAave3) throw Error("Platform adapter wasn't found");
        });
        after(async function () {
          await HardhatUtils.restoreBlockFromEnv();
          await TimeUtils.rollback(snapshotBefore);
        });
        interface IWithdrawStepParams {
          tokenX: string;
          tokenY: string;

          tokenToSwap?: string;
          amountToSwap: string;

          liquidationThresholds: string[];
          propNotUnderlying18: string;

          planKind: number;

          balanceX: string;
          balanceY: string;

          // collateral amounts for exist borrows on AAVE2, AAVE3
          collaterals: string[];
        }

        interface IWithdrawStepResults {
          balanceX: number;
          balanceY: number;
        }

        async function makeWithdrawStep(p: IWithdrawStepParams): Promise<IWithdrawStepResults> {
          const tokenX = IERC20Metadata__factory.connect(p.tokenX, signer);
          const tokenY = IERC20Metadata__factory.connect(p.tokenY, signer);
          const decimalsX = await tokenX.decimals();
          const decimalsY = await tokenY.decimals();
          const signerFacade = await DeployerUtilsLocal.impersonate(facade.address);

          // set up current balances
          await TokenUtils.getToken(p.tokenX, facade.address, parseUnits(p.balanceX, decimalsX));
          await TokenUtils.getToken(p.tokenY, facade.address, parseUnits(p.balanceY, decimalsY));

          // prepare borrows
          console.log("Prepare borrows");
          const collateral0 = parseUnits(p.collaterals[0], decimalsX);
          const collateral1 = parseUnits(p.collaterals[1], decimalsX);
          await tokenX.connect(signerFacade).approve(converter.address, Misc.MAX_UINT);
          await tokenY.connect(signerFacade).approve(converter.address, Misc.MAX_UINT);

          await platformAdapterAave3.connect(converterGovernance).setFrozen(true);
          const plan0 = await converter.findBorrowStrategies(
            "0x",
            testSet.tokenIn,
            collateral0,
            testSet.tokenOut,
            1
          );
          console.log("plan0", plan0);
          await TokenUtils.getToken(p.tokenX, facade.address, plan0.collateralAmountsOut[0]);
          await converter.connect(signerFacade).borrow(
            plan0.converters[0],
            testSet.tokenIn,
            plan0.collateralAmountsOut[0],
            testSet.tokenOut,
            plan0.amountToBorrowsOut[0],
            facade.address
          );

          await platformAdapterAave3.connect(converterGovernance).setFrozen(false);
          await platformAdapterAave2.connect(converterGovernance).setFrozen(true);

          const plan1 = await converter.findBorrowStrategies(
            "0x",
            testSet.tokenIn,
            collateral1,
            testSet.tokenOut,
            1
          );
          console.log("plan1", plan1);
          await TokenUtils.getToken(p.tokenX, facade.address, plan1.collateralAmountsOut[0]);
          await converter.connect(await DeployerUtilsLocal.impersonate(facade.address)).borrow(
            plan1.converters[0],
            testSet.tokenIn,
            plan1.collateralAmountsOut[0],
            testSet.tokenOut,
            plan1.amountToBorrowsOut[0],
            facade.address
          );
          await platformAdapterAave2.connect(converterGovernance).setFrozen(true);

          await tokenY.connect(signerFacade).transfer(signer.address, plan0.amountToBorrowsOut[0]);
          await tokenY.connect(signerFacade).transfer(signer.address, plan1.amountToBorrowsOut[0]);

          console.log("Make withdraw");

          await facade.withdrawStep(
            [converter.address, testSet.tetuLiquidator],
            [p.tokenX, p.tokenY],
            [
              parseUnits(p.liquidationThresholds[0], decimalsX),
              parseUnits(p.liquidationThresholds[1], decimalsY)
            ],
            p.tokenToSwap || Misc.ZERO_ADDRESS,
            p.tokenToSwap === undefined
              ? BigNumber.from(0)
              : parseUnits(p.amountToSwap, await IERC20Metadata__factory.connect(p.tokenToSwap, signer).decimals()),
            Misc.ZERO_ADDRESS,
            "0x",
            true,
            p.planKind,
            [
              Array.isArray(p.propNotUnderlying18)
                ? Misc.MAX_UINT
                : parseUnits(p.propNotUnderlying18 || "0", 18),
              0
            ]
          );

          return {
            balanceX: +formatUnits(await tokenX.balanceOf(facade.address), decimalsX),
            balanceY: +formatUnits(await tokenY.balanceOf(facade.address), decimalsY),
          }
        }

        /**
         * There are two borrows with debt-gap-required=true
         * We are going to repay X
         * First borrow has size A < X
         * So, we close first borrow completely (A) and repay second borrow partially (B)
         * A + B < X because of not-zero debt-gap of the first borrow.
         * In this case, _borrowToProportions will revert with "TS-29 opposite debt exists".
         * We need one more repay instead, so we will have R-S-R-R scheme
         *
         */
        describe("SCB-777", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeWithdrawStepTest(): Promise<IWithdrawStepResults> {
            return makeWithdrawStep({
              tokenX: testSet.tokenIn,
              tokenY: testSet.tokenOut,

              amountToSwap: "727.183544",
              tokenToSwap: testSet.tokenIn,

              planKind: PLAN_REPAY_SWAP_REPAY_1,
              propNotUnderlying18: "0.44",

              liquidationThresholds: ["0.01000", "0.01000"],
              balanceX: "373.533405",
              balanceY: "290.142283",

              collaterals: [
                "635", // aave2
                "198620" // aave3
              ]
            });
          }

          it("should not revert", async () => {
            const ret = await makeWithdrawStepTest();
            // expect([ret.balanceX, ret.balanceY].join()).eq([3004, 0].join());
          });
        });
      }
    });
  });
});
