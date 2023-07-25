/* tslint:disable:no-trailing-whitespace */
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  IERC20__factory,
  IERC20Metadata__factory,
  IStrategyV2,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
  UniswapV3Lib, ISwapper, IERC20, ISwapper__factory,
} from "../../../../typechain";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {IStateNum, IStateParams, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {UniswapV3LiquidityUtils} from "./utils/UniswapV3LiquidityUtils";
import {UniversalUtils} from "../../../UniversalUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {BigNumber} from "ethers";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: 'boolean',
      default: false,
    },
    hardhatChainId: {
      type: 'number',
      default: 137,
    },
  }).argv;

describe('UniswapV3ConverterStrategyFuseTest', function () {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }
//region Constants
  const DEFAULT_FUSE_THRESHOLDS = ["0.9995", "0.9997", "1.0005", "1.0003"];

  const FUSE_DISABLED_0 = 0;
  const FUSE_OFF_1 = 1;
  const FUSE_ON_LOWER_LIMIT_2 = 2;
  const FUSE_ON_UPPER_LIMIT_3 = 3;
  const FUSE_ON_LOWER_LIMIT_UNDERLYING_4 = 4;
  const FUSE_ON_UPPER_LIMIT_UNDERLYING_5 = 5;
//endregion Constants

//region Variables
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let swapper: ISwapper;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: UniswapV3ConverterStrategy;
  let lib: UniswapV3Lib;
  let stateParams: IStateParams;
//endregion Variables

  //region before, after
  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();

    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: undefined,
          },
        },
      ],
    });

    [signer] = await ethers.getSigners();
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    const core = Addresses.getCore();
    const controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    const converterAddress = getConverterAddress();
    swapper = ISwapper__factory.connect(MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, signer);

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_UniswapV3_USDC_USDT-0.01%',
      async (_splitterAddress: string) => {
        const _strategy = UniswapV3ConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          converterAddress,
          MaticAddresses.UNISWAPV3_USDC_USDT_100,
          0,
          0,
          [
            parseUnits(DEFAULT_FUSE_THRESHOLDS[0], 18),
            parseUnits(DEFAULT_FUSE_THRESHOLDS[1], 18),
            parseUnits(DEFAULT_FUSE_THRESHOLDS[2], 18),
            parseUnits(DEFAULT_FUSE_THRESHOLDS[3], 18)
          ]
        );

        return _strategy as unknown as IStrategyV2;
      },
      controller,
      gov,
      1_000,
      300,
      300,
      false,
    );
    strategy = data.strategy as UniswapV3ConverterStrategy
    vault = data.vault.connect(signer)

    await ConverterUtils.whitelist([strategy.address]);
    await vault.connect(gov).setWithdrawRequestBlocks(0)

    await ConverterUtils.disableAaveV2(signer)

    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
    await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, parseUnits('0.001', 6));

    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN])
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

    lib = await DeployerUtils.deployContract(signer, 'UniswapV3Lib') as UniswapV3Lib

    stateParams = {
      mainAssetSymbol: await IERC20Metadata__factory.connect(MaticAddresses.USDC_TOKEN, signer).symbol()
    }

    // prices should be the same in the pool and in the oracle
    const state = await strategy.getState();
    await PriceOracleImitatorUtils.uniswapV3(signer, state.pool, state.tokenA);

    // prices should be the same in the pool and in the liquidator
    const pools = [
      {
        pool: state.pool,
        swapper: MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
        tokenIn: MaticAddresses.USDC_TOKEN,
        tokenOut: MaticAddresses.USDT_TOKEN,
      },
    ]
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    const liquidatorOperator = await Misc.impersonate('0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94')
    await tools.liquidator.connect(liquidatorOperator).addLargestPools(pools, true);
    await tools.liquidator.connect(liquidatorOperator).addBlueChipsPools(pools, true);
  })

  after(async function () {
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: parseInt(process.env.TETU_MATIC_FORK_BLOCK || '', 10) || undefined,
          },
        },
      ],
    });
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after


//region Utils
  interface ICycleParams {
    pathOut: string;
    countRebalances: number;
    movePricesUp: boolean;
  }

  interface IPrepareOverCollateralResults {
    states: IStateNum[];
  }

  async function movePriceUpDown(p: ICycleParams): Promise<IPrepareOverCollateralResults> {
    const states: IStateNum[] = [];
    const pathOut = p.pathOut;

    console.log('deposit...');
    await asset.approve(vault.address, Misc.MAX_UINT);
    await TokenUtils.getToken(asset.address, signer.address, parseUnits('1000', 6));
    await vault.deposit(parseUnits('1000', 6), signer.address);

    const swapAmounts: BigNumber[] = [];

    const state = await strategy.getState();
    for (let i = 0; i < p.countRebalances; ++i) {
      console.log(`Swap and rebalance. Step ${i}`);
      const amounts = await UniswapV3LiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib, MaticAddresses.UNISWAPV3_USDC_USDT_100);
      const priceB = await lib.getPrice(MaticAddresses.UNISWAPV3_USDC_USDT_100, MaticAddresses.USDT_TOKEN);
      let swapAmount = amounts[1].mul(priceB).div(parseUnits('1', 6));
      swapAmount = swapAmount.add(swapAmount.div(100));
      swapAmounts.push(swapAmount);

      await UniversalUtils.movePoolPriceUp(signer, state.pool, state.tokenA, state.tokenB, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAmount);
      states.push(await StateUtilsNum.getState(signer, signer, strategy, vault, `p${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);

      if (!(await strategy.needRebalance())) {
        console.log('Not need rebalance... continue');
      } else {
        await strategy.rebalanceNoSwaps(true);
        const stateAfterRebalance = await StateUtilsNum.getState(signer, signer, strategy, vault, `r${i}`);
        states.push(stateAfterRebalance);
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
        if (stateAfterRebalance.fuseStatus === FUSE_ON_UPPER_LIMIT_3) break;
      }
    }

    console.log("===========================");
    for (let i = 0; i < 2 * p.countRebalances; ++i) {
      console.log(`Swap and rebalance. Step ${i}`);
      const amounts = await UniswapV3LiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib, MaticAddresses.UNISWAPV3_USDC_USDT_100);
      const priceB = await lib.getPrice(MaticAddresses.UNISWAPV3_USDC_USDT_100, MaticAddresses.USDT_TOKEN);
      let swapAmount = amounts[1].mul(priceB).div(parseUnits('1', 6));
      swapAmount = swapAmount.add(swapAmount.div(100));
      swapAmounts.push(swapAmount);

      await UniversalUtils.movePoolPriceDown(signer, state.pool, state.tokenA, state.tokenB, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAmount);
      states.push(await StateUtilsNum.getState(signer, signer, strategy, vault, `pd${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);

      if (!(await strategy.needRebalance())) {
        console.log('Not need rebalance... continue');
      } else {
        await strategy.rebalanceNoSwaps(true);
        const stateAfterRebalance = await StateUtilsNum.getState(signer, signer, strategy, vault, `r${i}`);
        states.push(stateAfterRebalance);
        await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
        if (stateAfterRebalance.fuseStatus === FUSE_ON_UPPER_LIMIT_3) break;
      }
    }

    return {states};
  }

//endregion Utils

//region Unit tests
  describe('Increase price N steps, decrease price N steps', function () {
    describe("Use liquidator", () => {
      describe('Move prices up, down', function () {
        interface IMovePricesInLoop {
          states: IStateNum[];
        }

        async function movePricesInLoop(): Promise<IMovePricesInLoop> {
          const pathOut = "./tmp/move-prices-in-loop.csv";
          const {states} = await movePriceUpDown({
            countRebalances: 7,
            pathOut,
            movePricesUp: true
          });
          return {states};
        }

        it("should reduce locked amount to zero", async () => {
          const ret = await movePricesInLoop();
        });
      });
    });
  });

//endregion Unit tests
});