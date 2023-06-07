/* tslint:disable:no-trailing-whitespace */
import chai, {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  AlgebraConverterStrategy,
  AlgebraConverterStrategy__factory,
  IERC20,
  IERC20__factory, IStrategyV2,
  ISwapper,
  ISwapper__factory, TetuVaultV2, VaultFactory__factory,
} from "../../../../typechain";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {UniswapV3StrategyUtils} from "../../../UniswapV3StrategyUtils";
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";

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

describe('AlgebraConverterStrategyTest', function() {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let swapper: ISwapper;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: AlgebraConverterStrategy;

  before(async function() {
    [signer] = await ethers.getSigners();
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);
    snapshotBefore = await TimeUtils.snapshot();

    const core = Addresses.getCore();
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    const controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    const converterAddress = getConverterAddress();
    swapper = ISwapper__factory.connect(MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, signer);

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
            rewardToken: '0x958d208Cdf087843e9AD98d23823d32E17d723A1', // dQuick
            bonusRewardToken: MaticAddresses.WMATIC_TOKEN,
            pool: MaticAddresses.ALGEBRA_USDC_USDT,
            startTime: 1663631794,
            endTime: 4104559500
          }
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
    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN])
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
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  describe('Algebra strategy tests', function() {
    it('Deposit, hardwork, withdraw', async() => {
      const s = strategy

      console.log('deposit 1...');
      await asset.approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, signer.address, parseUnits('2000', 6));
      await vault.deposit(parseUnits('1000', 6), signer.address);

      console.log('deposit 2...');
      await vault.deposit(parseUnits('1000', 6), signer.address);

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400); // 1 day

      console.log('Make pool volume')
      await UniswapV3StrategyUtils.makeVolume(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('10000', 6));

      console.log('Hardwork')
      expect(await s.isReadyToHardWork()).eq(true)
      const splitterSigner = await DeployerUtilsLocal.impersonate(await vault.splitter());
      const hwResult = await s.connect(splitterSigner).callStatic.doHardWork({gasLimit: 19_000_000})
      await s.connect(splitterSigner).doHardWork()

      expect(hwResult.earned).gt(0)

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400); // 1 day

      console.log('Make pool volume')
      await UniswapV3StrategyUtils.makeVolume(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('10000', 6));

      console.log('withdraw')
      await vault.withdraw(parseUnits('500', 6), signer.address, signer.address)

      console.log('after 1 day')
      await TimeUtils.advanceBlocksOnTs(86400); // 1 day

      console.log('Make pool volume')
      await UniswapV3StrategyUtils.makeVolume(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('10000', 6));

      console.log('withdrawAll')
      await vault.withdrawAll()

    })
  })
})