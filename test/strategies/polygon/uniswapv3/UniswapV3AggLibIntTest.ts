import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {
  ILiquidationParams,
  IQuoteRepayParams,
  IRepayParams
} from "../../../baseUT/mocks/TestDataTypes";
import {setupMockedQuoteRepay, setupMockedRepay} from "../../../baseUT/mocks/MockRepayUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {
  ConverterController__factory,
  IConverterController__factory,
  IERC20Metadata__factory, ITetuConverter, ITetuConverter__factory, ITetuLiquidator,
  MockForwarder,
  MockTetuConverter, MockTetuLiquidatorSingleCall,
  MockToken, PriceOracleMock,
  UniswapV3AggLibFacade
} from "../../../../typechain";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {setupIsConversionValid, setupMockedLiquidation} from "../../../baseUT/mocks/MockLiquidationUtils";
import {BigNumber, BytesLike} from "ethers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {AggregatorUtils} from "../../../baseUT/utils/AggregatorUtils";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {MaticHolders} from "../../../../scripts/addresses/MaticHolders";

describe('UniswapV3AggLibIntTest', () => {
  /** prop0 + prop1 */
  const SUM_PROPORTIONS = 100_000;
  //region Variables
  let snapshotBefore: string;
  let governance: SignerWithAddress;
  let signer: SignerWithAddress;
  let facade: UniswapV3AggLibFacade;
  //endregion Variables

  //region before, after
  before(async function () {
    [signer] = await ethers.getSigners();

    governance = await DeployerUtilsLocal.getControllerGovernance(signer);
    snapshotBefore = await TimeUtils.snapshot();

    facade = await MockHelper.createUniswapV3AggLibFacade(signer);
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
      useLiquidator: boolean;

      // bad paths params
      aggregator?: string;
      tokenToSwap?: string;
    }

    interface ISwapResults {
      balances: number[];
      spentAmountIn: number;
    }

    async function makeSwap(p: ISwapParams): Promise<ISwapResults> {
      const decimalsTokenIn = await IERC20Metadata__factory.connect(p.tokens[p.indexIn], signer).decimals();
      const amountIn = parseUnits(p.amountIn, decimalsTokenIn);

      await BalanceUtils.getAmountFromHolder(p.tokens[p.indexIn], p.holderIn, facade.address, Number(p.amountIn));

      let swapData: BytesLike = "0x";
      if (! p.useLiquidator) {
        const params = {
          fromTokenAddress: p.tokens[p.indexIn],
          toTokenAddress: p.tokens[p.indexOut],
          amount: amountIn.toString(),
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
      }

      const planInputParams = {
          converter: MaticAddresses.TETU_CONVERTER,
          tokens: p.tokens,
          liquidationThresholds: await Promise.all(p.tokens.map(
            async (token: string, index: number) => parseUnits(
              p.liquidationThresholds[index],
              await IERC20Metadata__factory.connect(token, signer).decimals()
            )
          )),

          // not used by _swap()

          prices: [0, 0],
          propNotUnderlying18: 0,
          decs: [0, 0],
          balanceAdditions: [0, 0]
        };
      const aggParams = {
        useLiquidator: p.useLiquidator,
        amountToSwap: amountIn,
        tokenToSwap: p.tokenToSwap ??  p.tokens[p.indexIn],
        aggregator: p.aggregator ??
          (p.useLiquidator
            ? MaticAddresses.TETU_LIQUIDATOR
            : MaticAddresses.AGG_ONEINCH_V5
          ),
        swapData
      };

      const ret = await facade.callStatic._swap(planInputParams, aggParams, p.indexIn, p.indexOut, amountIn);
      await facade._swap(planInputParams, aggParams, p.indexIn, p.indexOut, amountIn);

      return {
        spentAmountIn: +formatUnits(ret, decimalsTokenIn),
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
                useLiquidator: true
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
                useLiquidator: false
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
                tokens: [MaticAddresses.USDC_TOKEN, MaticAddresses.DAI_TOKEN],
                amountIn: "100",
                holderIn: MaticHolders.HOLDER_DAI,
                indexIn: 1,
                indexOut: 0,
                liquidationThresholds: ["0", "0"],
                useLiquidator: true
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
                useLiquidator: false
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
            useLiquidator: true
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
      describe("incorrect token to swap", () => {
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
            indexIn: 1, // (!) wrong
            indexOut: 0, // (!) wrong
            liquidationThresholds: ["0", "0"],
            useLiquidator: false,

            tokenToSwap: MaticAddresses.USDC_TOKEN,
          });
        }

        it("should revert", async () => {
          await expect(
            loadFixture(makeSwapTest)
          ).revertedWith("TS-25 swap by agg"); // INCORRECT_SWAP_BY_AGG_PARAM
        })
      });
      describe("incorrect aggregator", () => {
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
            useLiquidator: false,

            aggregator: MaticAddresses.TETU_CONVERTER // (!) incorrect
          });
        }

        it("should revert", async () => {
          await expect(
            loadFixture(makeSwapTest)
          ).revertedWith("U3S-12 Unknown router"); // UNKNOWN_SWAP_ROUTER
        })
      });
    });
  });

//endregion Unit tests
});