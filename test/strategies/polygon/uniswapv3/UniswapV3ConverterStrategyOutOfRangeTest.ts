/* tslint:disable:no-trailing-whitespace */
import chai, {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  IERC20,
  IERC20__factory, IStrategyV2,
  ISwapper,
  ISwapper__factory, TetuVaultV2, UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
  UniswapV3Pool__factory
} from "../../../../typechain";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniswapV3StrategyUtils} from "../../../UniswapV3StrategyUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";

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

describe('UniswapV3ConverterStrategyOutOfRangeTest', function() {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let swapper: ISwapper;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: UniswapV3ConverterStrategy;

  before(async function() {
    [signer] = await ethers.getSigners();
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);
    snapshotBefore = await TimeUtils.snapshot();

    const core = Addresses.getCore();
    const controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.WMATIC_TOKEN, signer);
    const converterAddress = getConverterAddress();
    swapper = ISwapper__factory.connect(MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, signer);

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_UniswapV3_WMATIC_MaticX-0.01%',
      async(_splitterAddress: string) => {
        const _strategy = UniswapV3ConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          converterAddress,
          MaticAddresses.UNISWAPV3_WMATIC_MaticX_100,
          0,
          0,
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
    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.WMATIC_TOKEN, MaticAddresses.MaticX_TOKEN])
    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)
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

  describe('UniswapV3 strategy out of range tests', function() {
    it('Rebalance', async() => {
      const s = strategy

      console.log('deposit...');
      await asset.approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, signer.address, parseUnits('1000'));
      await vault.deposit(parseUnits('1000'), signer.address);

      await UniswapV3StrategyUtils.movePriceDown(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('600'), 100001);

      const price = await swapper.getPrice(MaticAddresses.UNISWAPV3_WMATIC_MaticX_100, MaticAddresses.MaticX_TOKEN, MaticAddresses.WMATIC_TOKEN, parseUnits('1'))

      expect(price).eq(0)
      expect(await s.needRebalance()).eq(true)
      await expect(s.rebalance()).to.be.revertedWith('TC-56 zero not allowed')
      expect(await s.needRebalance()).eq(true)

      await UniswapV3StrategyUtils.movePriceUp(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('1'), 100000);

      await s.rebalance()
    })
  })
})