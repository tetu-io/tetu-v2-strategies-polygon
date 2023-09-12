/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  AlgebraConverterStrategy,
  AlgebraConverterStrategy__factory,
  IERC20,
  IERC20__factory, IStrategyV2,
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
import {UniswapV3StrategyUtils} from "../../../baseUT/strategies/UniswapV3StrategyUtils";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {StrategyTestUtils} from "../../../baseUT/utils/StrategyTestUtils";
import {BigNumber} from "ethers";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';

describe('AlgebraConverterStrategyTest', function() {

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: AlgebraConverterStrategy;

  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.switchToMostCurrentBlock();

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
      'TetuV2_Algebra_USDC_USDT',
      async(_splitterAddress: string) => {
        const _strategy = AlgebraConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'AlgebraConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          converterAddress,
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
          [0, 0, Misc.MAX_UINT, 0],
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
    strategy = data.strategy as AlgebraConverterStrategy
    vault = data.vault.connect(signer)

    await ConverterUtils.whitelist([strategy.address]);
    await vault.connect(gov).setWithdrawRequestBlocks(0)

    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)
    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.dQUICK_TOKEN, MaticAddresses.WMATIC_TOKEN,])
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

    /*const platformVoter = await DeployerUtilsLocal.impersonate(await controller.platformVoter());
    await strategy.connect(platformVoter).setCompoundRatio(50000);*/

    const pools = [
      {
        pool: MaticAddresses.ALGEBRA_dQUICK_QUICK,
        swapper: MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
        tokenIn: MaticAddresses.dQUICK_TOKEN,
        tokenOut: MaticAddresses.QUICK_TOKEN,
      },
      {
        pool: MaticAddresses.ALGEBRA_USDC_QUICK,
        swapper: MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER,
        tokenIn: MaticAddresses.QUICK_TOKEN,
        tokenOut: MaticAddresses.USDC_TOKEN,
      },
    ]
    await tools.liquidator.connect(operator).addLargestPools(pools, true);

    // prevent 'TC-4 zero price' because real oracles have a limited price lifetime
    await PriceOracleImitatorUtils.uniswapV3(signer, MaticAddresses.UNISWAPV3_USDC_USDT_100, MaticAddresses.USDC_TOKEN)

    await StrategyTestUtils.setThresholds(
      strategy as unknown as IStrategyV2,
      signer,
      { rewardLiquidationThresholds: [
          {
            asset: MaticAddresses.dQUICK_TOKEN,
            threshold: BigNumber.from('1000'),
          },
          {
            asset: MaticAddresses.USDT_TOKEN,
            threshold: BigNumber.from('1000'),
          },
        ] },
    );
  })

  after(async function() {
    await HardhatUtils.restoreBlockFromEnv();
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  describe('Algebra strategy tests', function() {
    it('Rebalance, hardwork', async() => {
      const s = strategy

      console.log('deposit...')
      await asset.approve(vault.address, Misc.MAX_UINT)
      await TokenUtils.getToken(asset.address, signer.address, parseUnits('2000', 6))
      await vault.deposit(parseUnits('1000', 6), signer.address)

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400) // 1 day

      expect(await s.needRebalance()).eq(false)

      await UniswapV3StrategyUtils.movePriceUp(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('1100000', 6))

      console.log('Rebalance')
      expect(await s.needRebalance()).eq(true)
      await s.rebalanceNoSwaps(true, {gasLimit: 19_000_000});
      expect(await s.needRebalance()).eq(false)

      console.log('Hardwork')
      expect(await s.isReadyToHardWork()).eq(true)
      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter())
      const hwResult = await s.connect(splitterSigner).callStatic.doHardWork({gasLimit: 19_000_000})
      await s.connect(splitterSigner).doHardWork({gasLimit: 19_000_000})
      expect(hwResult.earned).gt(0)
      // console.log('APR', UniversalUtils.getApr(hwResult.earned, parseUnits('2000', 6), 0, 86400))
    })
    it('Deposit, hardwork, withdraw', async() => {
      const s = strategy

      console.log('deposit 1...');
      await asset.approve(vault.address, Misc.MAX_UINT)
      await TokenUtils.getToken(asset.address, signer.address, parseUnits('2000', 6))
      await vault.deposit(parseUnits('1000', 6), signer.address)

      console.log('deposit 2...')
      await vault.deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000})

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400) // 1 day

      console.log('Make pool volume')
      await UniswapV3StrategyUtils.makeVolume(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('10000', 6))

      console.log('Hardwork')
      expect(await s.isReadyToHardWork()).eq(true)
      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter())
      const hwResult = await s.connect(splitterSigner).callStatic.doHardWork({gasLimit: 19_000_000})
      await s.connect(splitterSigner).doHardWork()

      expect(hwResult.earned).gt(0)
      console.log('APR', UniversalUtils.getApr(hwResult.earned, parseUnits('2000', 6), 0, 86400))

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400) // 1 day

      console.log('Make pool volume')
      await UniswapV3StrategyUtils.makeVolume(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('10000', 6))

      console.log('withdraw')
      await vault.withdraw(parseUnits('500', 6), signer.address, signer.address)

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400) // 1 day

      console.log('Make pool volume')
      await UniswapV3StrategyUtils.makeVolume(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('10000', 6));

      console.log('withdrawAll')
      await vault.withdrawAll()
    })
    it('Second deposit have rewards', async() => {
      const s = strategy

      console.log('deposit 1...')
      await asset.approve(vault.address, Misc.MAX_UINT)
      await TokenUtils.getToken(asset.address, signer.address, parseUnits('2000', 6))
      await vault.deposit(parseUnits('1000', 6), signer.address)

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400) // 1 day

      console.log('Make pool volume')
      await UniswapV3StrategyUtils.makeVolume(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('10000', 6))

      console.log('Hardwork')
      expect(await s.isReadyToHardWork()).eq(true)
      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter())
      const hwResult = await s.connect(splitterSigner).callStatic.doHardWork({gasLimit: 19_000_000})
      await s.connect(splitterSigner).doHardWork()

      expect(hwResult.earned).gt(0)
      console.log('Eearned from 1000 USDC deposit', hwResult.earned.toString())
      console.log('APR', UniversalUtils.getApr(hwResult.earned, parseUnits('1000', 6), 0, 86400))

      console.log('deposit 2...')
      await vault.deposit(parseUnits('1000', 6), signer.address, {gasLimit: 19_000_000})

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400) // 1 day

      console.log('Make pool volume')
      await UniswapV3StrategyUtils.makeVolume(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('10000', 6))

      console.log('Hardwork')
      expect(await s.isReadyToHardWork()).eq(true)
      const hwResult2 = await s.connect(splitterSigner).callStatic.doHardWork({gasLimit: 19_000_000})
      await s.connect(splitterSigner).doHardWork()

      expect(hwResult2.earned).gt(hwResult.earned.mul(2).sub(hwResult.earned.div(10)))
      console.log('Eearned from 2000 USDC deposit', hwResult2.earned.toString())
      console.log('APR', UniversalUtils.getApr(hwResult2.earned, parseUnits('2000', 6), 0, 86400))
    })
  })
})
