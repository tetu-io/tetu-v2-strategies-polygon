import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {parseUnits} from "ethers/lib/utils";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {AlgebraConverterStrategy, AlgebraConverterStrategy__factory, IController__factory, IERC20__factory, IPairBasedDefaultStateProvider, ISetupPairBasedStrategy, IStrategyV2, ISwapper__factory, KyberConverterStrategy, KyberConverterStrategy__factory, PairBasedStrategyLibFacade, UniswapV3ConverterStrategy, UniswapV3ConverterStrategy__factory, VaultFactory__factory} from "../../../../typechain";
import {expect} from "chai";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {BigNumber, BytesLike} from "ethers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {PackedData} from "../../../baseUT/utils/PackedData";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {KYBER_PID} from "../../../baseUT/strategies/pair/PairBasedStrategyBuilder";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';

describe('PairBasedStrategySetupIntTest', () => {
  //region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let operator: SignerWithAddress;
  let strategyUniv3: UniswapV3ConverterStrategy;
  let strategyAlgebra: AlgebraConverterStrategy;
  let strategyKyber: KyberConverterStrategy;
  //endregion Variables

  //region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();

    strategyUniv3 = await createUniv3();
    strategyAlgebra = await createAlgebra();
    strategyKyber = await createKyber();

    operator = await UniversalTestUtils.getAnOperator(strategyUniv3.address, signer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
//endregion before, after

//region Initialize strategies
  async function createUniv3(): Promise<UniswapV3ConverterStrategy> {
    const gov = await Misc.impersonate(MaticAddresses.GOV_ADDRESS);
    const core = Addresses.getCore() as CoreAddresses;

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      MaticAddresses.USDC_TOKEN,
      'TetuV2_UniswapV3_USDC-USDT-0.01%',
      async (_splitterAddress: string) => {
        const _strategy = UniswapV3ConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          MaticAddresses.TETU_CONVERTER,
          MaticAddresses.UNISWAPV3_USDC_USDT_100,
          0,
          0,
          [0, 0, Misc.MAX_UINT, 0],
        );

        return _strategy as unknown as IStrategyV2;
      },
      IController__factory.connect(core.controller, gov),
      gov,
      0,
      300,
      300,
      false,
    );

    return UniswapV3ConverterStrategy__factory.connect(data.strategy.address, gov);
  }

  async function createAlgebra(): Promise<AlgebraConverterStrategy> {
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);
    const core = Addresses.getCore();

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      PolygonAddresses.USDC_TOKEN,
      'TetuV2_Algebra_USDC_USDT',
      async (_splitterAddress: string) => {
        const _strategy = AlgebraConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'AlgebraConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          getConverterAddress(),
          MaticAddresses.ALGEBRA_USDC_USDT,
          0,
          0,
          true,
          {
            rewardToken: MaticAddresses.dQUICK_TOKEN,
            bonusRewardToken: MaticAddresses.WMATIC_TOKEN,
            pool: MaticAddresses.ALGEBRA_USDC_USDT,
            startTime: 1663631794,
            endTime: 4104559500
          },
          [0, 0, Misc.MAX_UINT, 0],
        );

        return _strategy as unknown as IStrategyV2;
      },
      DeployerUtilsLocal.getController(signer),
      gov,
      1_000,
      300,
      300,
      false,
    );
    return data.strategy as AlgebraConverterStrategy
  }

  async function createKyber(): Promise<KyberConverterStrategy> {
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);
    const core = Addresses.getCore();
    const pId = KYBER_PID;

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      PolygonAddresses.USDC_TOKEN,
      'TetuV2_Kyber_USDC_USDT',
      async (_splitterAddress: string) => {
        const _strategy = KyberConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'KyberConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          getConverterAddress(),
          MaticAddresses.KYBER_USDC_USDT,
          0,
          0,
          true,
          pId,
          [0, 0, Misc.MAX_UINT, 0],
        );

        return _strategy as unknown as IStrategyV2;
      },
      DeployerUtilsLocal.getController(signer),
      gov,
      0,
      0,
      300,
      false,
    );
    return data.strategy as KyberConverterStrategy
  }

//endregion Initialize strategies

//region Unit tests
  describe("setFuseStatus", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface ISetFuseStatusParams {
      fuseStatus: number;
      notAsOperator?: boolean;
    }

    interface ISetFuseStatusResults {
      status: number;
    }

    async function callSetFuseStatus(strategy: ISetupPairBasedStrategy, p: ISetFuseStatusParams): Promise<ISetFuseStatusResults> {
      const s = p.notAsOperator
        ? strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
        : strategy.connect(operator);
      await s.setFuseStatus(p.fuseStatus);
      const state = await PackedData.getDefaultState(strategy as unknown as IPairBasedDefaultStateProvider);
      return {status: state.fuseStatus}
    }

    describe("Univ3", () => {
      it("should set expected values", async () => {
        const ret = await callSetFuseStatus(strategyUniv3, {
          fuseStatus: 1,
        });
        expect(ret.status).eq(1);
      });
      it("should revert if not operator", async () => {
        await expect(callSetFuseStatus(strategyUniv3, {
          fuseStatus: 1,
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });

    describe("Algebra", () => {
      it("should set expected values", async () => {
        const ret = await callSetFuseStatus(strategyAlgebra, {
          fuseStatus: 1,
        });
        expect(ret.status).eq(1);
      });
      it("should revert if not operator", async () => {
        await expect(callSetFuseStatus(strategyAlgebra, {
          fuseStatus: 1,
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });

    /// Kyber is not used after security incident nov-2023
    describe.skip("Kyber", () => {
      it("should set expected values", async () => {
        const ret = await callSetFuseStatus(strategyKyber, {
          fuseStatus: 1,
        });
        expect(ret.status).eq(1);
      });
      it("should revert if not operator", async () => {
        await expect(callSetFuseStatus(strategyKyber, {
          fuseStatus: 1,
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });
  });

  describe("setFuseThresholds", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface ISetFuseThresholdsParams {
      thresholds: string[];
      notAsOperator?: boolean;
    }

    interface ISetFuseThresholdsResults {
      thresholds: number[];
    }

    async function callSetFuseStatus(strategy: ISetupPairBasedStrategy, p: ISetFuseThresholdsParams): Promise<ISetFuseThresholdsResults> {
      const s = p.notAsOperator
        ? strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
        : strategy.connect(operator);
      const ttA = new Array<BigNumber>(4);
      for (let i = 0; i < 4; ++i) {
        ttA[i] = parseUnits(p.thresholds[i], 18);
      }
      await s.setFuseThresholds([ttA[0], ttA[1], ttA[2], ttA[3]]);
      const state = await PackedData.getDefaultState(strategy as unknown as IPairBasedDefaultStateProvider);
      return {
        thresholds: state.fuseThresholds,
      }
    }

    describe("Univ3", () => {
      it("should set expected values", async () => {
        const ret = await callSetFuseStatus(strategyUniv3, {
          thresholds: ["1", "2", "4", "3"],
        });
        expect([...ret.thresholds].join()).eq([1, 2, 4, 3].join());
      });
      it("should revert if not operator", async () => {
        await expect(callSetFuseStatus(strategyUniv3, {
          thresholds: ["1", "2", "4", "3"],
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });

    describe("Algebra", () => {
      it("should set expected values", async () => {
        const ret = await callSetFuseStatus(strategyAlgebra, {
          thresholds: ["1", "2", "4", "3"],
        });
        expect([...ret.thresholds].join()).eq([1, 2, 4, 3].join());
      });
      it("should revert if not operator", async () => {
        await expect(callSetFuseStatus(strategyAlgebra, {
          thresholds: ["1", "2", "4", "3"],
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });

    /// Kyber is not used after security incident nov-2023
    describe.skip("Kyber", () => {
      it("should set expected values", async () => {
        const ret = await callSetFuseStatus(strategyKyber, {
          thresholds: ["1", "2", "4", "3"],
        });
        expect([...ret.thresholds].join()).eq([1, 2, 4, 3].join());
      });
      it("should revert if not operator", async () => {
        await expect(callSetFuseStatus(strategyKyber, {
          thresholds: ["1", "2", "4", "3"],
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });
  });

  describe("setStrategyProfitHolder", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface ISetProfitHolderParams {
      profitHolder: string;
      notAsOperator?: boolean;
    }

    interface ISetProfitHolderResults {
      profitHolder: string;
    }

    async function callSetProfitHolder(strategy: ISetupPairBasedStrategy, p: ISetProfitHolderParams): Promise<ISetProfitHolderResults> {
      const s = p.notAsOperator
        ? strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
        : strategy.connect(operator);
      await s.setStrategyProfitHolder(p.profitHolder);
      const state = await PackedData.getDefaultState(strategy as unknown as IPairBasedDefaultStateProvider);
      return { profitHolder: state.profitHolder };
    }

    describe("Univ3", () => {
      it("should set expected values", async () => {
        const profitHolder = ethers.Wallet.createRandom().address;
        const ret = await callSetProfitHolder(strategyUniv3, {profitHolder});
        expect(ret.profitHolder).eq(profitHolder);
      });
      it("should revert if not operator", async () => {
        const profitHolder = ethers.Wallet.createRandom().address;
        await expect(callSetProfitHolder(strategyUniv3, {
          profitHolder,
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });

    describe("Algebra", () => {
      it("should set expected values", async () => {
        const profitHolder = ethers.Wallet.createRandom().address;
        const ret = await callSetProfitHolder(strategyAlgebra, {profitHolder});
        expect(ret.profitHolder).eq(profitHolder);
      });
      it("should revert if not operator", async () => {
        const profitHolder = ethers.Wallet.createRandom().address;
        await expect(callSetProfitHolder(strategyAlgebra, {
          profitHolder,
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });

    /// Kyber is not used after security incident nov-2023
    describe.skip("Kyber", () => {
      it("should set expected values", async () => {
        const profitHolder = ethers.Wallet.createRandom().address;
        const ret = await callSetProfitHolder(strategyKyber, {profitHolder});
        expect(ret.profitHolder).eq(profitHolder);
      });
      it("should revert if not operator", async () => {
        const profitHolder = ethers.Wallet.createRandom().address;
        await expect(callSetProfitHolder(strategyKyber, {
          profitHolder,
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });
  });

  describe("setWithdrawDone", () => {
    let snapshot: string;
    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    interface ISetWithdrawDoneParams {
      done: number;
      notAsOperator?: boolean;
    }

    interface IWithdrawDoneResults {
      done: number;
    }

    async function callSetProfitHolder(strategy: ISetupPairBasedStrategy, p: ISetWithdrawDoneParams): Promise<IWithdrawDoneResults> {
      const s = p.notAsOperator
        ? strategy.connect(await Misc.impersonate(ethers.Wallet.createRandom().address))
        : strategy.connect(operator);
      await s.setWithdrawDone(p.done);
      const state = await PackedData.getDefaultState(strategy as unknown as IPairBasedDefaultStateProvider);
      return { done: state.withdrawDone };
    }

    describe("Univ3", () => {
      it("should set expected values", async () => {
        const ret = await callSetProfitHolder(strategyUniv3, {done: 1});
        expect(ret.done).eq(1);
      });
      it("should revert if not operator", async () => {
        const profitHolder = ethers.Wallet.createRandom().address;
        await expect(callSetProfitHolder(strategyUniv3, {
          done: 1,
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });

    describe("Algebra", () => {
      it("should set expected values", async () => {
        const ret = await callSetProfitHolder(strategyAlgebra, {done: 1});
        expect(ret.done).eq(1);
      });
      it("should revert if not operator", async () => {
        const profitHolder = ethers.Wallet.createRandom().address;
        await expect(callSetProfitHolder(strategyAlgebra, {
          done: 1,
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });

    /// Kyber is not used after security incident nov-2023
    describe.skip("Kyber", () => {
      it("should set expected values", async () => {
        const profitHolder = ethers.Wallet.createRandom().address;
        const ret = await callSetProfitHolder(strategyKyber, {done: 1});
        expect(ret.done).eq(1);
      });
      it("should revert if not operator", async () => {
        const profitHolder = ethers.Wallet.createRandom().address;
        await expect(callSetProfitHolder(strategyKyber, {
          done: 1,
          notAsOperator: true
        })).revertedWith("SB: Denied"); // DENIED
      });
    });
  });
//endregion Unit tests
});
