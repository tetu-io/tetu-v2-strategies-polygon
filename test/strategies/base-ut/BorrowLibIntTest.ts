import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowLibFacade, ConverterController__factory, IConverterController__factory,
  IERC20Metadata, IPriceOracle, IPriceOracle__factory,
  ITetuConverter, ITetuConverter__factory, MockToken,
} from "../../../typechain";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {
  getAaveTwoPlatformAdapter,
  getCompoundThreePlatformAdapter,
  getDForcePlatformAdapter,
  Misc
} from "../../../scripts/utils/Misc";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {IERC20Metadata__factory} from "../../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {MockHelper} from "../../baseUT/helpers/MockHelper";
import {MaticHolders} from "../../../scripts/addresses/MaticHolders";
import {ConverterUtils} from "../../baseUT/utils/ConverterUtils";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  BALANCER_COMPOSABLE_STABLE_DEPOSITOR_POOL_GET_WEIGHTS,
  GAS_BORROW_LIB_01,
  GAS_BORROW_LIB_02,
  GAS_BORROW_LIB_03,
  GAS_BORROW_LIB_04,
  GAS_BORROW_LIB_05,
  GAS_BORROW_LIB_06,
  GAS_BORROW_LIB_07,
  GAS_BORROW_LIB_08
} from "../../baseUT/GasLimits";
import {BigNumber} from "ethers";

describe('BorrowLibIntTest', () => {
  /** prop0 + prop1 */
  const SUM_PROPORTIONS = 100_000;
  const PROPORTION_SMALL = 3316;

  //region Variables
  let snapshotBefore: string;
  let governance: SignerWithAddress;
  let signer: SignerWithAddress;
  let converter: ITetuConverter;
  let usdc: IERC20Metadata;
  let wmatic: IERC20Metadata;
  let usdt: IERC20Metadata;
  let facade: BorrowLibFacade;
  let priceOracle: IPriceOracle;
  //endregion Variables

  //region before, after
  before(async function () {
    [signer] = await ethers.getSigners();

    governance = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();
    converter = await ITetuConverter__factory.connect(MaticAddresses.TETU_CONVERTER, signer);

    usdc = await IERC20Metadata__factory.connect(MaticAddresses.USDC_TOKEN, signer);
    wmatic = await IERC20Metadata__factory.connect(MaticAddresses.WMATIC_TOKEN, signer);
    usdt = await IERC20Metadata__factory.connect(MaticAddresses.USDT_TOKEN, signer);

    facade = await MockHelper.createBorrowLibFacade(signer);

    // whitelist facade in the converter
    const converterController = ConverterController__factory.connect(await converter.controller(), signer);
    const converterGovernance = await converterController.governance();
    await converterController.connect(await Misc.impersonate(converterGovernance)).setWhitelistValues([facade.address], true);

    priceOracle = IPriceOracle__factory.connect(await converterController.priceOracle(), signer);

    // let's use AAVE3 (with debt-tokens and repay-borrow-in-single-block-forbidden problems)
    await ConverterUtils.disablePlatformAdapter(signer, await getDForcePlatformAdapter(signer));
    await ConverterUtils.disablePlatformAdapter(signer, await getAaveTwoPlatformAdapter(signer));
    await ConverterUtils.disablePlatformAdapter(signer, await getCompoundThreePlatformAdapter(signer));
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Unit tests
  describe("rebalanceAssets X:Y", () => {
    interface IBalancesXY {
      balanceX: string;
      balanceY: string;
    }
    interface IState {
      balanceX: number;
      balanceY: number;
      costX: number;
      costY: number;

      collateralX: number;
      debtX: number;

      collateralY: number;
      debtY: number;
    }
    interface IRebalanceAssetsParams {
      tokenX: IERC20Metadata;
      tokenY: IERC20Metadata;
      holderX: string;
      holderY: string;
      /** [0 .. SUM_PROPORTIONS] */
      proportion: number;
      thresholdX?: number;
      thresholdY?: number;
      init: {
        addBeforeBorrow: IBalancesXY;
        /** empty string == all balance */
        subAfterBorrow?: IBalancesXY;
      }
      preBorrow?: {
        collateralAsset: IERC20Metadata;
        borrowAsset: IERC20Metadata;
        /** This amount doesn't depend on init.addBeforeBorrow, it's added independently */
        collateralAmount: string;
      }
    }

    interface IRebalanceAssetsResults {
      initial: IState;
      afterBorrow: IState;
      afterSub: IState;
      final: IState;
      gasUsed: BigNumber;
    }

    async function getState(p: IRebalanceAssetsParams): Promise<IState> {
      const priceX = await priceOracle.getAssetPrice(p.tokenX.address);
      const priceY = await priceOracle.getAssetPrice(p.tokenY.address);
      const decimalsX = await p.tokenX.decimals();
      const decimalsY = await p.tokenY.decimals();

      const balanceX = await p.tokenX.balanceOf(facade.address);
      const balanceY = await p.tokenY.balanceOf(facade.address);

      const costX = balanceX.mul(priceX).div(parseUnits("1", decimalsX));
      const costY = balanceY.mul(priceY).div(parseUnits("1", decimalsY));

      const direct = await converter.getDebtAmountStored(facade.address, p.tokenX.address, p.tokenY.address, false);
      const reverse = await converter.getDebtAmountStored(facade.address, p.tokenY.address, p.tokenX.address, false);

      return {
        balanceX: +formatUnits(balanceX, await p.tokenX.decimals()),
        balanceY: +formatUnits(balanceY, await p.tokenY.decimals()),
        costX: +formatUnits(costX, 18),
        costY: +formatUnits(costY, 18),
        collateralX: +formatUnits(direct.totalCollateralAmountOut, await p.tokenX.decimals()),
        debtY: +formatUnits(direct.totalDebtAmountOut, await p.tokenY.decimals()),
        collateralY: +formatUnits(reverse.totalCollateralAmountOut, await p.tokenY.decimals()),
        debtX: +formatUnits(reverse.totalDebtAmountOut, await p.tokenX.decimals()),
      }
    }

    /**
     * 1) Put assets on balance of the "strategy" (facade)
     * 2) Make pre-borrow if necessary
     * 3) Take assets from the balance of the strategy if necessary
     * 4) Make rebalanceAssets()
     * 5) Check result balances
     */
    async function makeRebalanceAssets(p: IRebalanceAssetsParams): Promise<IRebalanceAssetsResults> {
      const receiver = ethers.Wallet.createRandom().address;
      const facadeAsSigner = await Misc.impersonate(facade.address);

      // set up current balances
      await BalanceUtils.getAmountFromHolder(p.tokenX.address, p.holderX, facade.address, Number(p.init.addBeforeBorrow.balanceX));
      await BalanceUtils.getAmountFromHolder(p.tokenY.address, p.holderY, facade.address, Number(p.init.addBeforeBorrow.balanceY));
      const initial = await getState(p);

      // allow borrow
      await p.tokenX.connect(facadeAsSigner).approve(converter.address, Misc.MAX_UINT);
      await p.tokenY.connect(facadeAsSigner).approve(converter.address, Misc.MAX_UINT);

      // borrow before rebalancing
      if (p.preBorrow) {
        if (p.preBorrow.collateralAsset.address === p.tokenX.address) {
          await BalanceUtils.getAmountFromHolder(p.tokenX.address, p.holderX, facade.address, Number(p.preBorrow.collateralAmount));
        } else {
          await BalanceUtils.getAmountFromHolder(p.tokenY.address, p.holderY, facade.address, Number(p.preBorrow.collateralAmount))
        }

        const plan = await converter.findBorrowStrategies(
          "0x",
          p.preBorrow.collateralAsset.address,
          parseUnits(p.preBorrow.collateralAmount, await p.preBorrow.collateralAsset.decimals()),
          p.preBorrow.borrowAsset.address,
          1
        );
        if (plan.converters.length === 0) {
          throw Error("Conversion plan wasn't found");
        }
        await converter.connect(facadeAsSigner).borrow(
          plan.converters[0],
          p.preBorrow.collateralAsset.address,
          plan.collateralAmountsOut[0],
          p.preBorrow.borrowAsset.address,
          plan.amountToBorrowsOut[0],
          facade.address
        );
      }
      const afterBorrow = await getState(p);

      // decrease balances if necessary
      if (p.init.subAfterBorrow) {
        await p.tokenX.connect(facadeAsSigner).transfer(
          receiver,
          p.init.subAfterBorrow.balanceX
            ? parseUnits(p.init.subAfterBorrow.balanceX, await p.tokenX.decimals())
            : p.tokenX.balanceOf(facade.address)
        );
        await p.tokenY.connect(facadeAsSigner).transfer(
          receiver,
          p.init.subAfterBorrow.balanceY
            ? parseUnits(p.init.subAfterBorrow.balanceY, await p.tokenY.decimals())
            : p.tokenY.balanceOf(facade.address)
        );
      }
      const afterSub = await getState(p);

      // make rebalancing
      const tx = await facade.rebalanceAssets(
        converter.address,
        p.tokenX.address,
        p.tokenY.address,
        // 100_000 was replaced by 1e18
        parseUnits(Number(p.proportion / SUM_PROPORTIONS).toString(), 18),
        parseUnits((p.thresholdX || 0).toString(), await p.tokenX.decimals()),
        parseUnits((p.thresholdY || 0).toString(), await p.tokenY.decimals()),
      );
      const gasUsed = (await tx.wait()).gasUsed;

      // get results
      return {
        initial,
        afterBorrow,
        afterSub,
        final: await getState(p),
        gasUsed
      }
    }

    describe("WMATIC : usdc == 1 : 1", () => {
      describe("Current state - no debts", () => {
        describe("Need to increase WMATIC, reduce USDC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: wmatic,
              tokenY: usdc,

              holderX: MaticHolders.HOLDER_WMATIC,
              holderY: MaticHolders.HOLDER_USDC,

              proportion: 50_000,

              init: {
                addBeforeBorrow: {
                  balanceX: "0",
                  balanceY: "1000"
                }
              },
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX).approximately(r.final.costY, 1e-2);
            expect(r.final.balanceX).gt(r.initial.balanceX);
            expect(r.final.balanceY).lt(r.initial.balanceY);
            expect(r.final.collateralX).eq(0);
            expect(r.final.collateralY).gt(0);
            expect(r.final.debtY).eq(0);
            expect(r.final.debtX).gt(0);
          });
        });
        describe("Need to reduce WMATIC, increase USDC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: wmatic,
              tokenY: usdc,

              holderX: MaticHolders.HOLDER_WMATIC,
              holderY: MaticHolders.HOLDER_USDC,

              proportion: 50_000,

              init: {
                addBeforeBorrow: {
                  balanceX: "1000",
                  balanceY: "0"
                }
              },
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX).approximately(r.final.costY, 1e-2);
            expect(r.final.balanceX).lt(r.initial.balanceX);
            expect(r.final.balanceY).gt(r.initial.balanceY);
            expect(r.final.collateralX).gt(0);
            expect(r.final.collateralY).eq(0);
            expect(r.final.debtY).gt(0);
            expect(r.final.debtX).eq(0);
          });
        });
      });

      describe("Current state - direct debt - WMATIC is borrowed under USDC", () => {
        describe("Need to increase USDC, reduce WMATIC", () => {
          describe("Partial repay and direct borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: 50_000,

                init: {
                  addBeforeBorrow: {
                    balanceX: "100",
                    balanceY: "100"
                  }
                },
                preBorrow: {
                  collateralAsset: usdc,
                  borrowAsset: wmatic,
                  collateralAmount: "1000" // usdc => ~800 wmatic
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              expect(r.final.costX).approximately(r.final.costY, 1e-2);
              expect(r.final.balanceX).gt(r.afterBorrow.balanceX);
              expect(r.final.balanceY).lt(r.afterBorrow.balanceY);
              expect(r.final.collateralX === 0 || r.final.collateralY === 0).eq(true);
              expect(r.final.debtX === 0 || r.final.debtY === 0).eq(true);
            });
          });
          describe("Full repay and reverse borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: 50_000,

                init: {
                  addBeforeBorrow: {
                    balanceX: "0",
                    balanceY: "10000"
                  }
                },
                preBorrow: {
                  collateralAsset: usdc,
                  borrowAsset: wmatic,
                  collateralAmount: "1000" // usdc => ~800 wmatic
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              expect(r.final.costX).approximately(r.final.costY, 1e-2);

              expect(r.final.balanceX).gt(r.afterBorrow.balanceX);
              expect(r.final.balanceY).lt(r.afterBorrow.balanceY);

              expect(r.final.collateralX).eq(0);
              expect(r.final.debtY).eq(0);

              expect(r.final.collateralY).gt(0);
              expect(r.final.debtX).gt(0);
            });
          });
        });
        describe("Need to reduce USDC, increase WMATIC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: usdc,
              tokenY: wmatic,

              holderX: MaticHolders.HOLDER_USDC,
              holderY: MaticHolders.HOLDER_WMATIC,

              proportion: 50_000,

              init: {
                addBeforeBorrow: {
                  balanceX: "5000",
                  balanceY: "100"
                }
              },
              preBorrow: {
                collateralAsset: usdc,
                borrowAsset: wmatic,
                collateralAmount: "1000" // usdc => ~800 wmatic
              }
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX).approximately(r.final.costY, 1e-2);

            expect(r.final.balanceX).lt(r.afterBorrow.balanceX);
            expect(r.final.balanceY).gt(r.afterBorrow.balanceY);

            expect(r.final.collateralX).gt(r.afterBorrow.collateralX);
            expect(r.final.debtY).gt(r.afterBorrow.debtY);

            expect(r.final.collateralY).eq(0);
            expect(r.final.debtX).eq(0);
          });
        });
      });

      describe("Current state - reverse debt - USDC is borrowed under WMATIC", () => {
        describe("Need to increase USDC, reduce WMATIC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: usdc,
              tokenY: wmatic,

              holderX: MaticHolders.HOLDER_USDC,
              holderY: MaticHolders.HOLDER_WMATIC,

              proportion: 50_000,

              init: {
                addBeforeBorrow: {
                  balanceX: "0",
                  balanceY: "1000"
                }
              },
              preBorrow: {
                collateralAsset: wmatic,
                borrowAsset: usdc,
                collateralAmount: "1000" // wmatic => ~300 usdc
              }
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX).approximately(r.final.costY, 1e-2);

            expect(r.final.balanceX).gt(r.afterBorrow.balanceX);
            expect(r.final.balanceY).lt(r.afterBorrow.balanceY);

            expect(r.final.collateralY).gt(r.afterBorrow.collateralY);
            expect(r.final.debtX).gt(r.afterBorrow.debtX);

            expect(r.final.collateralX).eq(0);
            expect(r.final.debtY).eq(0);
          });
        });
        describe("Need to reduce USDC, increase WMATIC", () => {
          describe("Partial repay and direct borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: 50_000,

                init: {
                  addBeforeBorrow: {
                    balanceX: "500",
                    balanceY: "500"
                  }
                },
                preBorrow: {
                  collateralAsset: wmatic,
                  borrowAsset: usdc,
                  collateralAmount: "1000" // wmatic => ~300 usdc
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              expect(r.final.costX).approximately(r.final.costY, 1e-2);

              expect(r.final.balanceX).lt(r.afterBorrow.balanceX);
              expect(r.final.balanceY).gt(r.afterBorrow.balanceY);

              expect(r.final.collateralY).lt(r.afterBorrow.collateralY);
              expect(r.final.debtX).lt(r.afterBorrow.debtX);

              expect(r.final.collateralX).eq(0);
              expect(r.final.debtY).eq(0);
            });
          });
          describe("Full repay and reverse borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: 50_000,

                init: {
                  addBeforeBorrow: {
                    balanceX: "5000",
                    balanceY: "0"
                  }
                },
                preBorrow: {
                  collateralAsset: wmatic,
                  borrowAsset: usdc,
                  collateralAmount: "1000" // wmatic => ~300 usdc
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              expect(r.final.costX).approximately(r.final.costY, 1e-2);

              expect(r.final.balanceX).lt(r.afterBorrow.balanceX);
              expect(r.final.balanceY).gt(r.afterBorrow.balanceY);

              expect(r.final.collateralY).eq(0);
              expect(r.final.debtX).eq(0);

              expect(r.final.collateralX).gt(0);
              expect(r.final.debtY).gt(0);
            });
          });
        });
      });
    });

    describe("WMATIC : usdc == 3 : 97", () => {
      describe("Current state - no debts", () => {
        describe("Need to increase WMATIC, reduce USDC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: wmatic,
              tokenY: usdc,

              holderX: MaticHolders.HOLDER_WMATIC,
              holderY: MaticHolders.HOLDER_USDC,

              proportion: PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "0",
                  balanceY: "1000"
                }
              },
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX*(SUM_PROPORTIONS-PROPORTION_SMALL)).approximately(r.final.costY*(PROPORTION_SMALL), 1);
          });
        });
        describe("Need to reduce WMATIC, increase USDC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: wmatic,
              tokenY: usdc,

              holderX: MaticHolders.HOLDER_WMATIC,
              holderY: MaticHolders.HOLDER_USDC,

              proportion: PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "1000",
                  balanceY: "0"
                }
              },
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX*(SUM_PROPORTIONS-PROPORTION_SMALL)).approximately(r.final.costY*(PROPORTION_SMALL), 1);
          });
        });
      });

      describe("Current state - direct debt - WMATIC is borrowed under USDC", () => {
        describe("Need to increase USDC, reduce WMATIC", () => {
          describe("Partial repay and direct borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "100",
                    balanceY: "100"
                  }
                },
                preBorrow: {
                  collateralAsset: usdc,
                  borrowAsset: wmatic,
                  collateralAmount: "1000" // usdc => ~800 wmatic
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              expect(r.final.costX*(SUM_PROPORTIONS-PROPORTION_SMALL)).approximately(r.final.costY*(PROPORTION_SMALL), 1);
            });
          });
          describe("Full repay and reverse borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "0",
                    balanceY: "10000"
                  }
                },
                preBorrow: {
                  collateralAsset: usdc,
                  borrowAsset: wmatic,
                  collateralAmount: "1000" // usdc => ~800 wmatic
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              // 21533757.280518062 ~ 21533760.77834328
              expect(r.final.costX*(SUM_PROPORTIONS-PROPORTION_SMALL)).approximately(r.final.costY*(PROPORTION_SMALL), 10);
            });
          });
        });
        describe("Need to reduce USDC, increase WMATIC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: usdc,
              tokenY: wmatic,

              holderX: MaticHolders.HOLDER_USDC,
              holderY: MaticHolders.HOLDER_WMATIC,

              proportion: PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "5000",
                  balanceY: "100"
                }
              },
              preBorrow: {
                collateralAsset: usdc,
                borrowAsset: wmatic,
                collateralAmount: "1000" // usdc => ~800 wmatic
              }
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX*(SUM_PROPORTIONS-PROPORTION_SMALL)).approximately(r.final.costY*(PROPORTION_SMALL), 1);
          });
        });
      });

      describe("Current state - reverse debt - USDC is borrowed under WMATIC", () => {
        describe("Need to increase USDC, reduce WMATIC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: usdc,
              tokenY: wmatic,

              holderX: MaticHolders.HOLDER_USDC,
              holderY: MaticHolders.HOLDER_WMATIC,

              proportion: PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "0",
                  balanceY: "1000"
                }
              },
              preBorrow: {
                collateralAsset: wmatic,
                borrowAsset: usdc,
                collateralAmount: "1000" // wmatic => ~300 usdc
              }
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX*(SUM_PROPORTIONS-PROPORTION_SMALL)).approximately(r.final.costY*(PROPORTION_SMALL), 1);
          });
        });
        describe("Need to reduce USDC, increase WMATIC", () => {
          describe("Partial repay and direct borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "500",
                    balanceY: "500"
                  }
                },
                preBorrow: {
                  collateralAsset: wmatic,
                  borrowAsset: usdc,
                  collateralAmount: "1000" // wmatic => ~300 usdc
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              expect(r.final.costX*(SUM_PROPORTIONS-PROPORTION_SMALL)).approximately(r.final.costY*(PROPORTION_SMALL), 1);
            });
          });
          describe("Full repay and reverse borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "5000",
                    balanceY: "0"
                  }
                },
                preBorrow: {
                  collateralAsset: wmatic,
                  borrowAsset: usdc,
                  collateralAmount: "1000" // wmatic => ~300 usdc
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              expect(r.final.costX*(SUM_PROPORTIONS-PROPORTION_SMALL)).approximately(r.final.costY*(PROPORTION_SMALL), 1);
            });
          });
        });
      });
    });

    describe("WMATIC : usdc == 97 : 3", () => {
      describe("Current state - no debts", () => {
        describe("Need to increase WMATIC, reduce USDC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: wmatic,
              tokenY: usdc,

              holderX: MaticHolders.HOLDER_WMATIC,
              holderY: MaticHolders.HOLDER_USDC,

              proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "0",
                  balanceY: "1000"
                }
              },
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX*(PROPORTION_SMALL)).approximately(r.final.costY*(SUM_PROPORTIONS - PROPORTION_SMALL), 1);
          });
        });
        describe("Need to reduce WMATIC, increase USDC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: wmatic,
              tokenY: usdc,

              holderX: MaticHolders.HOLDER_WMATIC,
              holderY: MaticHolders.HOLDER_USDC,

              proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "1000",
                  balanceY: "0"
                }
              },
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX*(PROPORTION_SMALL)).approximately(r.final.costY*(SUM_PROPORTIONS - PROPORTION_SMALL), 1);
          });
        });
      });

      describe("Current state - direct debt - WMATIC is borrowed under USDC", () => {
        describe("Need to increase USDC, reduce WMATIC", () => {
          describe("Partial repay and direct borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "100",
                    balanceY: "100"
                  }
                },
                preBorrow: {
                  collateralAsset: usdc,
                  borrowAsset: wmatic,
                  collateralAmount: "1000" // usdc => ~800 wmatic
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              expect(r.final.costX*(PROPORTION_SMALL)).approximately(r.final.costY*(SUM_PROPORTIONS - PROPORTION_SMALL), 1);
            });
          });
          describe("Full repay and reverse borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "0",
                    balanceY: "10000"
                  }
                },
                preBorrow: {
                  collateralAsset: usdc,
                  borrowAsset: wmatic,
                  collateralAmount: "1000" // usdc => ~800 wmatic
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              // 21533757.280518062 ~ 21533760.77834328
              expect(r.final.costX*(PROPORTION_SMALL)).approximately(r.final.costY*(SUM_PROPORTIONS - PROPORTION_SMALL), 10);
            });
          });
        });
        describe("Need to reduce USDC, increase WMATIC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: usdc,
              tokenY: wmatic,

              holderX: MaticHolders.HOLDER_USDC,
              holderY: MaticHolders.HOLDER_WMATIC,

              proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "5000",
                  balanceY: "100"
                }
              },
              preBorrow: {
                collateralAsset: usdc,
                borrowAsset: wmatic,
                collateralAmount: "1000" // usdc => ~800 wmatic
              }
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            // 19267926.73364667 ~ 19267929.81618987
            expect(r.final.costX*(PROPORTION_SMALL)).approximately(r.final.costY*(SUM_PROPORTIONS - PROPORTION_SMALL), 10);
          });
        });
      });

      describe("Current state - reverse debt - USDC is borrowed under WMATIC", () => {
        describe("Need to increase USDC, reduce WMATIC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: usdc,
              tokenY: wmatic,

              holderX: MaticHolders.HOLDER_USDC,
              holderY: MaticHolders.HOLDER_WMATIC,

              proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "0",
                  balanceY: "1000"
                }
              },
              preBorrow: {
                collateralAsset: wmatic,
                borrowAsset: usdc,
                collateralAmount: "1000" // wmatic => ~300 usdc
              }
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            console.log("Results", r);
            expect(r.final.costX*(PROPORTION_SMALL)).approximately(r.final.costY*(SUM_PROPORTIONS - PROPORTION_SMALL), 1);
          });
        });
        describe("Need to reduce USDC, increase WMATIC", () => {
          describe("Partial repay and direct borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "500",
                    balanceY: "500"
                  }
                },
                preBorrow: {
                  collateralAsset: wmatic,
                  borrowAsset: usdc,
                  collateralAmount: "1000" // wmatic => ~300 usdc
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              expect(r.final.costX*(PROPORTION_SMALL)).approximately(r.final.costY*(SUM_PROPORTIONS - PROPORTION_SMALL), 1);
            });
          });
          describe("Full repay and reverse borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "5000",
                    balanceY: "0"
                  }
                },
                preBorrow: {
                  collateralAsset: wmatic,
                  borrowAsset: usdc,
                  collateralAmount: "1000" // wmatic => ~300 usdc
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              console.log("Results", r);
              expect(r.final.costX*(PROPORTION_SMALL)).approximately(r.final.costY*(SUM_PROPORTIONS - PROPORTION_SMALL), 1);
            });
          });
        });
      });
    });

    describe("USDC: USDT", () => {
      describe("Proportions 3:97", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
          return makeRebalanceAssets({
            tokenX: usdc,
            tokenY: usdt,

            holderX: MaticHolders.HOLDER_USDC,
            holderY: MaticHolders.HOLDER_USDT,

            proportion: PROPORTION_SMALL,

            init: {
              addBeforeBorrow: {
                balanceX: "0.000994",
                balanceY: "816.231976"
              }
            },
            preBorrow: {
              collateralAsset: usdc,
              borrowAsset: usdt,
              collateralAmount: "984.543579"
            }
          })
        }

        it("should set expected balances", async () => {
          const r = await loadFixture(makeRebalanceAssetsTest);
          console.log("Results", r);
          expect(r.final.costX*(SUM_PROPORTIONS-PROPORTION_SMALL)).approximately(r.final.costY*(PROPORTION_SMALL), 1);
        });
      });
    });

    describe("Gas estimation @skip-on-coverage", () => {
      describe("Current state - no debts", () => {
        describe("Need to increase WMATIC, reduce USDC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: wmatic,
              tokenY: usdc,

              holderX: MaticHolders.HOLDER_WMATIC,
              holderY: MaticHolders.HOLDER_USDC,

              proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "0",
                  balanceY: "1000"
                }
              },
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            controlGasLimitsEx(r.gasUsed, GAS_BORROW_LIB_01, (u, t) => {
              expect(u).to.be.below(t + 1);
            });
          });
        });
        describe("Need to reduce WMATIC, increase USDC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: wmatic,
              tokenY: usdc,

              holderX: MaticHolders.HOLDER_WMATIC,
              holderY: MaticHolders.HOLDER_USDC,

              proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "1000",
                  balanceY: "0"
                }
              },
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            controlGasLimitsEx(r.gasUsed, GAS_BORROW_LIB_02, (u, t) => {
              expect(u).to.be.below(t + 1);
            });
          });
        });
      });

      describe("Current state - direct debt - WMATIC is borrowed under USDC", () => {
        describe("Need to increase USDC, reduce WMATIC", () => {
          describe("Partial repay and direct borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "100",
                    balanceY: "100"
                  }
                },
                preBorrow: {
                  collateralAsset: usdc,
                  borrowAsset: wmatic,
                  collateralAmount: "1000" // usdc => ~800 wmatic
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              controlGasLimitsEx(r.gasUsed, GAS_BORROW_LIB_03, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("Full repay and reverse borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "0",
                    balanceY: "10000"
                  }
                },
                preBorrow: {
                  collateralAsset: usdc,
                  borrowAsset: wmatic,
                  collateralAmount: "1000" // usdc => ~800 wmatic
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              controlGasLimitsEx(r.gasUsed, GAS_BORROW_LIB_04, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
        });
        describe("Need to reduce USDC, increase WMATIC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: usdc,
              tokenY: wmatic,

              holderX: MaticHolders.HOLDER_USDC,
              holderY: MaticHolders.HOLDER_WMATIC,

              proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "5000",
                  balanceY: "100"
                }
              },
              preBorrow: {
                collateralAsset: usdc,
                borrowAsset: wmatic,
                collateralAmount: "1000" // usdc => ~800 wmatic
              }
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            controlGasLimitsEx(r.gasUsed, GAS_BORROW_LIB_05, (u, t) => {
              expect(u).to.be.below(t + 1);
            });
          });
        });
      });

      describe("Current state - reverse debt - USDC is borrowed under WMATIC", () => {
        describe("Need to increase USDC, reduce WMATIC", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
            return makeRebalanceAssets({
              tokenX: usdc,
              tokenY: wmatic,

              holderX: MaticHolders.HOLDER_USDC,
              holderY: MaticHolders.HOLDER_WMATIC,

              proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

              init: {
                addBeforeBorrow: {
                  balanceX: "0",
                  balanceY: "1000"
                }
              },
              preBorrow: {
                collateralAsset: wmatic,
                borrowAsset: usdc,
                collateralAmount: "1000" // wmatic => ~300 usdc
              }
            })
          }

          it("should set expected balances", async () => {
            const r = await loadFixture(makeRebalanceAssetsTest);
            controlGasLimitsEx(r.gasUsed, GAS_BORROW_LIB_06, (u, t) => {
              expect(u).to.be.below(t + 1);
            });
          });
        });
        describe("Need to reduce USDC, increase WMATIC", () => {
          describe("Partial repay and direct borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "500",
                    balanceY: "500"
                  }
                },
                preBorrow: {
                  collateralAsset: wmatic,
                  borrowAsset: usdc,
                  collateralAmount: "1000" // wmatic => ~300 usdc
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              controlGasLimitsEx(r.gasUsed, GAS_BORROW_LIB_07, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("Full repay and reverse borrow are required", () => {
            let snapshot: string;
            before(async function () {
              snapshot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshot);
            });

            async function makeRebalanceAssetsTest(): Promise<IRebalanceAssetsResults> {
              return makeRebalanceAssets({
                tokenX: usdc,
                tokenY: wmatic,

                holderX: MaticHolders.HOLDER_USDC,
                holderY: MaticHolders.HOLDER_WMATIC,

                proportion: SUM_PROPORTIONS - PROPORTION_SMALL,

                init: {
                  addBeforeBorrow: {
                    balanceX: "5000",
                    balanceY: "0"
                  }
                },
                preBorrow: {
                  collateralAsset: wmatic,
                  borrowAsset: usdc,
                  collateralAmount: "1000" // wmatic => ~300 usdc
                }
              })
            }

            it("should set expected balances", async () => {
              const r = await loadFixture(makeRebalanceAssetsTest);
              controlGasLimitsEx(r.gasUsed, GAS_BORROW_LIB_08, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
        });
      });
    });
  });
//endregion Unit tests
});