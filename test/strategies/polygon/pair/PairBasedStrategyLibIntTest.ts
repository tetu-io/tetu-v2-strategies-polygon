import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../../scripts/utils/Misc";
import {
  ConverterController__factory,
  IERC20Metadata__factory, ITetuConverter__factory, PairBasedStrategyLibFacade
} from "../../../../typechain";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {BigNumber, BytesLike} from "ethers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {AggregatorUtils} from "../../../baseUT/utils/AggregatorUtils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {MaticHolders} from "../../../../scripts/addresses/MaticHolders";

describe('PairBasedStrategyLibIntTest', () => {
  /** prop0 + prop1 */
  const SUM_PROPORTIONS = 100_000;
  //region Variables
  let snapshotBefore: string;
  let governance: SignerWithAddress;
  let signer: SignerWithAddress;
  let facade: PairBasedStrategyLibFacade;
  //endregion Variables

  //region before, after
  before(async function () {
    [signer] = await ethers.getSigners();

    governance = await DeployerUtilsLocal.getControllerGovernance(signer);
    snapshotBefore = await TimeUtils.snapshot();

    facade = await MockHelper.createPairBasedStrategyLibFacade(signer);
    const converter = ITetuConverter__factory.connect(MaticAddresses.TETU_CONVERTER, signer);
    const converterController = await ConverterController__factory.connect(await converter.controller(), signer);
    const converterGovernance = await converterController.governance();
    await converterController.connect(await Misc.impersonate(converterGovernance)).setWhitelistValues([facade.address], true);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Unit tests
  describe("swap", () => {
    interface ISwapParams {
      tokens: string[];
      liquidationThresholds: string[];
      indexIn: number;
      indexOut: number;
      amountIn: string;
      holderIn: string;
      aggregator: string;

      tokenToSwap?: string;
      amountToSwap?: string;
      mockConverter?: string;
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

      await BalanceUtils.getAmountFromHolder(p.tokens[p.indexIn], p.holderIn, facade.address, Number(p.amountIn));

      let swapData: BytesLike = "0x";
      if (p.aggregator === MaticAddresses.AGG_ONEINCH_V5) {
        const params = {
          fromTokenAddress: p.tokens[p.indexIn],
          toTokenAddress: p.tokens[p.indexOut],
          amount: amountToSwap.toString(),
          fromAddress: facade.address,
          slippage: 1,
          disableEstimate: true,
          allowPartialFill: false,
          protocols: 'POLYGON_BALANCER_V2',
        };
        console.log("params", params);

        const swapTransaction = await AggregatorUtils.buildTxForSwap(JSON.stringify(params));
        console.log('Transaction for swap: ', swapTransaction);
        swapData = swapTransaction.data;
        console.log("swapData", swapData);
        console.log("swapData.length", swapData.length);
      } else if (p.aggregator === MaticAddresses.TETU_LIQUIDATOR) {
        swapData = AggregatorUtils.buildTxForSwapUsingLiquidatorAsAggregator({
          tokenIn: p.tokens[p.indexIn],
          tokenOut: p.tokens[p.indexOut],
          amount: amountToSwap,
          slippage: BigNumber.from(5_000)
        });
        console.log("swapData for tetu liquidator", swapData);
      }

      const planInputParams = {
          converter: p.mockConverter || MaticAddresses.TETU_CONVERTER,
          tokens: p.tokens,
          liquidationThresholds: await Promise.all(p.tokens.map(
            async (token: string, index: number) => parseUnits(
              p.liquidationThresholds[index],
              await IERC20Metadata__factory.connect(token, signer).decimals()
            )
          )),
          usePoolProportions: false,

          // not used by _swap()

          prices: [0, 0],
          propNotUnderlying18: 0,
          decs: [0, 0],
          balanceAdditions: [0, 0],
          planKind: 0
        };
      const aggParams = {
        useLiquidator: p.aggregator === Misc.ZERO_ADDRESS,
        amountToSwap,
        tokenToSwap: p.tokenToSwap ??  p.tokens[p.indexIn],
        aggregator: p.aggregator === Misc.ZERO_ADDRESS
          ? MaticAddresses.TETU_LIQUIDATOR
          : p.aggregator,
        swapData
      };

      const {spentAmountIn, updatedPropNotUnderlying18} = await facade.callStatic._swap(planInputParams, aggParams, p.indexIn, p.indexOut, amountIn);
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
                tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
                amountIn: "100",
                holderIn: MaticHolders.HOLDER_USDC,
                indexIn: 0,
                indexOut: 1,
                liquidationThresholds: ["0", "0"],
                aggregator: Misc.ZERO_ADDRESS
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
          describe("Use 1inch", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeSwapTest(): Promise<ISwapResults> {
              return makeSwap({
                tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
                amountIn: "100",
                holderIn: MaticHolders.HOLDER_USDC,
                indexIn: 0,
                indexOut: 1,
                liquidationThresholds: ["0", "0"],
                aggregator: MaticAddresses.AGG_ONEINCH_V5
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
          describe("Use 1inch, 8358413440", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeSwapTest(): Promise<ISwapResults> {
              return makeSwap({
                tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN],
                amountIn: "8358.413440",
                holderIn: MaticHolders.HOLDER_USDC,
                indexIn: 0,
                indexOut: 1,
                liquidationThresholds: ["0", "0"],
                aggregator: MaticAddresses.AGG_ONEINCH_V5
              });
            }

            it("should return amountIn", async () => {
              const r = await loadFixture(makeSwapTest);
              expect(r.spentAmountIn).eq(8358.413440);
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
                tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
                amountIn: "100",
                holderIn: MaticHolders.HOLDER_DAI,
                indexIn: 1,
                indexOut: 0,
                liquidationThresholds: ["0", "0"],
                aggregator: Misc.ZERO_ADDRESS
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
          describe("Use 1inch", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeSwapTest(): Promise<ISwapResults> {
              return makeSwap({
                tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
                amountIn: "100",
                holderIn: MaticHolders.HOLDER_DAI,
                indexIn: 1,
                indexOut: 0,
                liquidationThresholds: ["0", "0"],
                aggregator: MaticAddresses.AGG_ONEINCH_V5
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
            tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
            amountIn: "100",
            amountToSwap: "90",
            holderIn: MaticHolders.HOLDER_USDC,
            indexIn: 0,
            indexOut: 1,
            liquidationThresholds: ["0", "0"],
            aggregator: MaticAddresses.TETU_LIQUIDATOR
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
            tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
            amountIn: "100",
            holderIn: MaticHolders.HOLDER_USDC,
            indexIn: 0,
            indexOut: 1,
            liquidationThresholds: ["100", "0"],
            aggregator: Misc.ZERO_ADDRESS
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
              tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
              amountIn: "100",
              holderIn: MaticHolders.HOLDER_USDC,
              indexIn: 1, // (!) wrong
              indexOut: 0, // (!) wrong
              liquidationThresholds: ["0", "0"],
              aggregator: MaticAddresses.TETU_LIQUIDATOR,

              tokenToSwap: MaticAddresses.USDC_TOKEN,
            })
          ).revertedWith("TS-25 swap by agg"); // INCORRECT_SWAP_BY_AGG_PARAM
        });

        it("should revert if token to swap is incorrect, liquidator", async () => {
          await expect(
            makeSwap({
              tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
              amountIn: "100",
              holderIn: MaticHolders.HOLDER_USDC,
              indexIn: 1, // (!) wrong
              indexOut: 0, // (!) wrong
              liquidationThresholds: ["0", "0"],
              aggregator: MaticAddresses.ZERO_ADDRESS,

              tokenToSwap: MaticAddresses.USDC_TOKEN,
            })
          ).revertedWith("TS-25 swap by agg"); // INCORRECT_SWAP_BY_AGG_PARAM
        });

        it("should revert if aggregator is incorrect", async () => {
          await expect(
            makeSwap({
              tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
              amountIn: "100",
              holderIn: MaticHolders.HOLDER_USDC,
              indexIn: 0,
              indexOut: 1,
              liquidationThresholds: ["0", "0"],
              aggregator: MaticAddresses.TETU_CONVERTER // (!) incorrect
            })
          ).revertedWith("PBS-1 Unknown router"); // UNKNOWN_SWAP_ROUTER
        })

        it("should revert if amountToSwap exceeds balance", async () => {
          await expect(
            makeSwap({
              amountIn: "100", // (!) balance is equal to amountIn
              amountToSwap: "101", // (!) but we are going to swap bigger amount

              tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
              holderIn: MaticHolders.HOLDER_USDC,
              indexIn: 0,
              indexOut: 1,
              liquidationThresholds: ["0", "0"],
              aggregator: MaticAddresses.TETU_LIQUIDATOR,
            })
          ).revertedWith("TS-7 not enough balance"); // NOT_ENOUGH_BALANCE
        })

        it("should revert if price impact is too high", async () => {
          const mockConverter = await MockHelper.createMockTetuConverter(signer);
          (await mockConverter).setIsConversionValid(
            MaticAddresses.USDC_TOKEN,
            parseUnits("100", 6),
            MaticAddresses.DAI_TOKEN,
            0, // arbitrary (unknown before-hand) amount-out
            0 // FAILED_0
          );

          await expect(
            makeSwap({
              mockConverter: mockConverter.address,

              tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
              amountIn: "100", // (!) balance is equal to amountIn
              holderIn: MaticHolders.HOLDER_USDC,
              indexIn: 0,
              indexOut: 1,
              liquidationThresholds: ["0", "0"],
              aggregator: MaticAddresses.TETU_LIQUIDATOR,
            })
          ).revertedWith("TS-16 price impact"); // PRICE_IMPACT
        });
      });
    });
  });

//endregion Unit tests
});