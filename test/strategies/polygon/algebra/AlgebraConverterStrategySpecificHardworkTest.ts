/* tslint:disable:no-trailing-whitespace */
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  AlgebraConverterStrategy, AlgebraConverterStrategy__factory,
  IERC20,
  IERC20__factory, ProxyControlled__factory,
} from "../../../../typechain";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';

const block = 44151797

describe.skip(`AlgebraConverterStrategyHardworkOnSpecifiedBlockTest`, function() {
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let asset: IERC20;
  let strategy: AlgebraConverterStrategy;

  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();

    await HardhatUtils.switchToMostCurrentBlock();

    [signer] = await ethers.getSigners();

    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);

    const strategyAddress = '0x3019e52aCb4717cDF79323592f1F897d243278F4'
    strategy = AlgebraConverterStrategy__factory.connect(strategyAddress, signer)

    // upgrade strategy to last version
    const newImpl = await DeployerUtils.deployContract(signer, 'AlgebraConverterStrategy') as AlgebraConverterStrategy
    console.log('Current strategy version', await strategy.STRATEGY_VERSION())
    const controllerSigner = await DeployerUtilsLocal.impersonate(await strategy.controller())
    const strategyProxy = ProxyControlled__factory.connect(strategyAddress, controllerSigner)
    await strategyProxy.upgrade(newImpl.address)
    console.log('Upgraded strategy version', await strategy.STRATEGY_VERSION())

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
    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)
    const tools = await DeployerUtilsLocal.getToolsAddressesWrapper(signer);
    await tools.liquidator.connect(operator).addLargestPools(pools, true);
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

  describe(`Algebra deployed strategy hardwork on block ${block}`, function() {
    it('Hardwork', async() => {
      const s = strategy
      const splitterSigner = await Misc.impersonate(await s.splitter())
      await s.connect(splitterSigner).doHardWork()
    })
  })
})
