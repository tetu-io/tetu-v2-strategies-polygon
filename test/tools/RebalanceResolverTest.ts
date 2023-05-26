import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {
  ControllerV2,
  IERC20,
  IERC20__factory, IStrategyV2, RebalanceResolver, RebalanceResolver__factory,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory
} from "../../typechain";
import {config as dotEnvConfig} from "dotenv";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../../scripts/utils/Misc";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {TokenUtils} from "../../scripts/utils/TokenUtils";
import {parseUnits} from "ethers/lib/utils";
import {ConverterUtils} from "../baseUT/utils/ConverterUtils";
import {UniswapV3StrategyUtils} from "../UniswapV3StrategyUtils";

const {expect} = chai;
chai.use(chaiAsPromised);

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    hardhatChainId: {
      type: 'number',
      default: 137,
    },
  }).argv;

describe('RebalanceResolver tests', function () {
  if (argv.hardhatChainId !== 137) {
    return;
  }

  let signer: SignerWithAddress;
  let controller: ControllerV2;
  let gov: SignerWithAddress;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: UniswapV3ConverterStrategy;
  let snapshotBefore: string;
  let snapshot: string;
  let resolver: RebalanceResolver;

  before(async function () {
    [signer] = await ethers.getSigners();
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();

    const core = Addresses.getCore();
    controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    const converterAddress = getConverterAddress();
    const strategyUSDCWETH500Deployer = async (_splitterAddress: string) => {
      const _strategy = UniswapV3ConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
        gov,
      );

      // USDC / WETH 0.05%
      const poolAddress = MaticAddresses.UNISWAPV3_USDC_WETH_500;
      // +-10% price (1 tick == 0.01% price change)
      const range = 1000;
      // +-1% price - rebalance
      const rebalanceRange = 100;

      await _strategy.init(
        core.controller,
        _splitterAddress,
        converterAddress,
        poolAddress,
        range,
        rebalanceRange,
      );

      return _strategy as unknown as IStrategyV2;
    };
    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_UniswapV3_USDC-WETH-0.05%',
      strategyUSDCWETH500Deployer,
      controller,
      gov,
      0,
      0,
      0,
      false,
    );
    vault = data.vault.connect(signer);
    strategy = data.strategy as unknown as UniswapV3ConverterStrategy;

    await TokenUtils.getToken(asset.address, signer.address, parseUnits('100000', 6));
    await asset.approve(vault.address, Misc.MAX_UINT);
    await ConverterUtils.whitelist([strategy.address]);

    resolver = await DeployerUtils.deployContract(signer, 'RebalanceResolver', strategy.address) as RebalanceResolver
    await resolver.changeOperatorStatus(signer.address, true)
  })
  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });

  it('Checker and call', async function () {
    const investAmount = parseUnits('10000', 6);
    await vault.deposit(investAmount, signer.address);
    expect(await strategy.needRebalance()).eq(false)
    expect((await resolver.checker()).canExec).eq(false)

    await UniswapV3StrategyUtils.movePriceUp(signer, strategy.address, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('1000000', 6))
    expect(await strategy.needRebalance()).eq(true)

    const data = await resolver.checker();
    expect(data.canExec).eq(true)
    expect(data.execPayload).eq(RebalanceResolver__factory.createInterface().encodeFunctionData('call'))

    await expect(resolver.call()).to.be.revertedWith(`Strategy error: ${strategy.address.toLowerCase()} SB: Denied`)
    await controller.connect(gov).registerOperator(resolver.address)
    await resolver.call()
    expect(await strategy.needRebalance()).eq(false)
    expect((await resolver.checker()).canExec).eq(false)
  })
})

