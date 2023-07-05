/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  IERC20,
  IERC20__factory, IKyberSwapElasticLM__factory, IStrategyV2, KyberConverterStrategy, KyberConverterStrategy__factory,
  TetuVaultV2, VaultFactory__factory,
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

describe('KyberConverterStrategyTest', function() {
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
    await PriceOracleImitatorUtils.uniswapV3(signer, MaticAddresses.UNISWAPV3_USDC_USDT_100, MaticAddresses.USDC_TOKEN)
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

  describe('Kyber strategy tests', function() {
    it('Farm end', async () => {
      const s = strategy

      let state = await s.getState()
      expect(state.flags[1]).eq(false)
      expect(state.flags[2]).eq(false)
      expect(state.flags[3]).eq(false)

      console.log('deposit...');
      await asset.approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, signer.address, parseUnits('2000', 6));
      await vault.deposit(parseUnits('1000', 6), signer.address);

      state = await s.getState()
      expect(state.flags[1]).eq(true)
      expect(state.flags[2]).eq(false)
      expect(state.flags[3]).eq(false)

      console.log('Make pool volume')
      await UniversalUtils.makePoolVolume(signer, state.pool, state.tokenA, state.tokenB, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, parseUnits('10000', 6));

      const farmingContract = IKyberSwapElasticLM__factory.connect('0x7D5ba536ab244aAA1EA42aB88428847F25E3E676', signer)
      const poolInfo = await farmingContract.getPoolInfo(pId)
      console.log('Farm ends', poolInfo.endTime)
      let now = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

      expect(await s.needRebalance()).eq(false)
      await TimeUtils.advanceBlocksOnTs(1 + poolInfo.endTime - now)

      console.log('Rebalance for unstake')
      expect(await s.needRebalance()).eq(true)

      state = await s.getState()
      expect(state.flags[1]).eq(true)
      expect(state.flags[2]).eq(false)
      expect(state.flags[3]).eq(true)

      await s.rebalanceNoSwaps(true)
      expect(await s.needRebalance()).eq(false)
      state = await s.getState()
      expect(state.flags[1]).eq(false)
      expect(state.flags[2]).eq(false)
      expect(state.flags[3]).eq(false)
      expect(state.totalLiquidity).gt(0)

      await UniversalUtils.movePoolPriceUp(signer, state.pool, state.tokenA, state.tokenB, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, parseUnits('100000', 6));

      console.log('Rebalance without stake')
      expect(await s.needRebalance()).eq(true)
      await s.rebalanceNoSwaps(true, {gasLimit: 19_000_000,})
      expect(await s.needRebalance()).eq(false)
      state = await s.getState()
      expect(state.flags[1]).eq(false)
      expect(state.flags[2]).eq(false)
      expect(state.flags[3]).eq(false)
      expect(state.totalLiquidity).gt(0)

      const admin = await Misc.impersonate(await farmingContract.admin())

      // addPool
      now = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
      await farmingContract.connect(admin).addPool(MaticAddresses.KYBER_USDC_USDT, now + 10, now + 86400 * 30, [MaticAddresses.KNC_TOKEN], [parseUnits('1000')], 8)
      const newPid = (await farmingContract.poolLength()).toNumber() - 1
      await s.connect(operator).changePId(newPid)

      state = await s.getState()
      expect(state.flags[1]).eq(false)
      expect(state.flags[2]).eq(true)
      expect(state.flags[3]).eq(false)

      await TimeUtils.advanceBlocksOnTs(10)

      console.log('Rebalance for stake')
      expect(await s.needRebalance()).eq(true)
      await s.rebalanceNoSwaps(true, {gasLimit: 19_000_000,})
      expect(await s.needRebalance()).eq(false)
      state = await s.getState()
      expect(state.flags[1]).eq(true)
      expect(state.flags[2]).eq(false)
      expect(state.flags[3]).eq(false)
      expect(state.totalLiquidity).gt(0)
    })


    it('Rebalance, hardwork', async() => {
      const s = strategy
      const state = await s.getState()

      console.log('deposit...');
      await asset.approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, signer.address, parseUnits('2000', 6));
      await vault.deposit(parseUnits('1000', 6), signer.address);

      expect(await s.needRebalance()).eq(false)

      await UniversalUtils.movePoolPriceUp(signer, state.pool, state.tokenA, state.tokenB, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, parseUnits('100000', 6));

      console.log('Rebalance')
      expect(await s.needRebalance()).eq(true)
      await s.rebalanceNoSwaps(true)
      expect(await s.needRebalance()).eq(false)

      console.log('Hardwork')
      expect(await s.isReadyToHardWork()).eq(true)
      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter());
      const hwResult = await s.connect(splitterSigner).callStatic.doHardWork({gasLimit: 19_000_000})
      await s.connect(splitterSigner).doHardWork({gasLimit: 19_000_000})
      expect(hwResult.earned).gt(0)
      // console.log('APR', UniversalUtils.getApr(hwResult.earned, parseUnits('2000', 6), 0, 86400))
    })
    it('Deposit, hardwork, withdraw', async() => {
      const s = strategy
      const state = await s.getState()

      console.log('deposit 1...');
      await asset.approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, signer.address, parseUnits('2000', 6));
      await vault.deposit(parseUnits('1000', 6), signer.address);

      console.log('deposit 2...');
      await vault.deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000});

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400); // 1 day

      console.log('Make pool volume')
      await UniversalUtils.makePoolVolume(signer, state.pool, state.tokenA, state.tokenB, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, parseUnits('10000', 6));

      console.log('Hardwork')
      expect(await s.isReadyToHardWork()).eq(true)
      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter());
      const hwResult = await s.connect(splitterSigner).callStatic.doHardWork({gasLimit: 19_000_000})
      await s.connect(splitterSigner).doHardWork()

      expect(hwResult.earned).gt(0)
      console.log('APR', UniversalUtils.getApr(hwResult.earned, parseUnits('2000', 6), 0, 86400))

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400); // 1 day

      console.log('Make pool volume')
      await UniversalUtils.makePoolVolume(signer, state.pool, state.tokenA, state.tokenB, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, parseUnits('10000', 6));

      console.log('withdraw')
      await vault.withdraw(parseUnits('500', 6), signer.address, signer.address)

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400); // 1 day

      console.log('Make pool volume')
      await UniversalUtils.makePoolVolume(signer, state.pool, state.tokenA, state.tokenB, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, parseUnits('10000', 6));

      if (await s.needRebalance()) {
        await s.rebalanceNoSwaps(true)
      }

      console.log('withdrawAll')
      await vault.withdrawAll()
    })
  })
})