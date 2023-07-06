/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  ConverterStrategyBase, IBorrowManager__factory, IConverterController__factory,
  IERC20,
  IERC20__factory,
  IPriceOracle__factory,
  IStrategyV2,
  ITetuConverter__factory, IUniswapV3ConverterStrategyReaderAccess__factory,
  KyberConverterStrategy,
  KyberConverterStrategy__factory,
  TetuVaultV2,
  VaultFactory__factory,
} from "../../../../typechain";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {UniversalUtils} from "../../../UniversalUtils";
import {StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";

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

describe('KyberConverterStrategyDepegTest', function() {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let operator: SignerWithAddress;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: KyberConverterStrategy;
  const pId = 21

  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: 44479520,
          },
        },
      ],
    });

    [signer] = await ethers.getSigners();
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    const core = Addresses.getCore();
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    const controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    const converterAddress = getConverterAddress();

    // use the latest implementations
    const vaultLogic = await DeployerUtils.deployContract(signer, 'TetuVaultV2');
    const splitterLogic = await DeployerUtils.deployContract(signer, 'StrategySplitterV2');
    const vaultFactory = VaultFactory__factory.connect(core.vaultFactory, signer);
    await vaultFactory.connect(gov).setVaultImpl(vaultLogic.address);
    await vaultFactory.connect(gov).setSplitterImpl(splitterLogic.address);

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_Kyber_USDC_USDT',
      async(_splitterAddress: string) => {
        const _strategy = KyberConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'KyberConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          converterAddress,
          MaticAddresses.KYBER_USDC_USDT,
          0,
          0,
          true,
          pId
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
    strategy = data.strategy as KyberConverterStrategy
    vault = data.vault.connect(signer)

    await ConverterUtils.whitelist([strategy.address]);
    await vault.connect(gov).setWithdrawRequestBlocks(0)

    operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)
    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.KNC_TOKEN,])
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

    const platformVoter = await DeployerUtilsLocal.impersonate(await controller.platformVoter());
    await strategy.connect(platformVoter).setCompoundRatio(50000);

    const pools = [
      {
        pool: MaticAddresses.KYBER_KNC_USDC,
        swapper: MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER,
        tokenIn: MaticAddresses.KNC_TOKEN,
        tokenOut: MaticAddresses.USDC_TOKEN,
      },
    ]
    await tools.liquidator.connect(operator).addLargestPools(pools, true);

    // prevent 'TC-4 zero price' because real oracles have a limited price lifetime
    // await PriceOracleImitatorUtils.uniswapV3(signer, MaticAddresses.UNISWAPV3_USDC_USDT_100, MaticAddresses.USDC_TOKEN)
    await PriceOracleImitatorUtils.kyber(signer, MaticAddresses.KYBER_USDC_USDT, MaticAddresses.USDC_TOKEN)
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
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
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  it('Depeg USDT', async() => {
    // USDT (tokenB) start price 0.999896
    const swaps = [
      parseUnits('200000', 6), // 1 -0.021% 0.999678
      parseUnits('40000', 6), // 2 -0.014% 0.999534
      parseUnits('4000', 6), // 3 -0.055% 0.99898
      parseUnits('1000', 6), // 4 -0.049% 0.998482
      parseUnits('500', 6), // 5 -0.013% 0.998346
      parseUnits('500', 6), // 6 -0.145% 0.996896
      parseUnits('400', 6), // 7 -0.049% 0.996407
      parseUnits('400', 6), // 8
      parseUnits('280', 6), // 9
      parseUnits('190', 6), // 10 -0.091% 0.994254
      // parseUnits('170', 6), // todo fix 'SS: Loss too high'
    ]

    const s = strategy
    const state = await s.getState()

    console.log('deposit...');
    await asset.approve(vault.address, Misc.MAX_UINT);
    await TokenUtils.getToken(asset.address, signer.address, parseUnits('2000', 6));
    await vault.deposit(parseUnits('1000', 6), signer.address);

    expect(await s.needRebalance()).eq(false)

    console.log('After deposit')
    await getBorrowInfo(s as unknown as ConverterStrategyBase, signer)

    let i = 1
    for (const swapAmount of swaps) {
      console.log(`Price down ${i}`)
      await UniversalUtils.movePoolPriceDown(signer, state.pool, state.tokenA, state.tokenB, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, swapAmount);

      console.log(`Rebalance ${i}`)
      expect(await s.needRebalance()).eq(true)
      await s.rebalanceNoSwaps(true, {gasLimit: 19_000_000,})
      expect(await s.needRebalance()).eq(false)

      await getBorrowInfo(s as unknown as ConverterStrategyBase, signer)

      i++
    }
  })
})

async function getBorrowInfo(
  strategy: ConverterStrategyBase,
  signer: SignerWithAddress
) {
  const converter = await ITetuConverter__factory.connect(await strategy.converter(), signer);
  const priceOracle = IPriceOracle__factory.connect(
    await IConverterController__factory.connect(await converter.controller(), signer).priceOracle(),
    signer
  );
  const borrowManager = await IBorrowManager__factory.connect(
    await IConverterController__factory.connect(await converter.controller(), signer).borrowManager(),
    signer
  );

  const strategyReaderReaderAccess = IUniswapV3ConverterStrategyReaderAccess__factory.connect(strategy.address, signer)
  const [tokenA, tokenB] = await strategyReaderReaderAccess.getPoolTokens()
  console.log('tokenA', tokenA)
  console.log('tokenB', tokenB)

  const directBorrows = await StateUtilsNum.getBorrowInfo(signer, converter, borrowManager, strategy, [tokenA], [tokenB], priceOracle, true);
  const reverseBorrows = await StateUtilsNum.getBorrowInfo(signer, converter, borrowManager, strategy, [tokenB], [tokenA], priceOracle, false);

  console.log('directBorrows', directBorrows)
  console.log('reverseBorrows', reverseBorrows)
}