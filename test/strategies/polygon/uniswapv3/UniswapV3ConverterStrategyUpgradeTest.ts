import chai from "chai";
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {
  ProxyControlled__factory, StrategyProfitHolder, StrategySplitterV2, StrategySplitterV2__factory,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory
} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {parseUnits} from "ethers/lib/utils";
import {UniswapV3StrategyUtils} from "../../../UniswapV3StrategyUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";

const { expect } = chai;

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

describe('UniswapV3ConverterStrategyUpgradeTests', function() {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  let snapshotBefore: string;
  const strategyAddress = '0x05C7D307632a36D31D7eECbE4cC5Aa46D15fA752' // USDC-USDT-100
  let signer: SignerWithAddress
  let strategy: UniswapV3ConverterStrategy
  let splitter: StrategySplitterV2
  let newImpl: UniswapV3ConverterStrategy
  let profitHolder: StrategyProfitHolder
  let splitterNewImpl: StrategySplitterV2

  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    [signer] = await ethers.getSigners();

    newImpl = await DeployerUtils.deployContract(signer, 'UniswapV3ConverterStrategy') as UniswapV3ConverterStrategy
    splitterNewImpl = await DeployerUtils.deployContract(signer, 'StrategySplitterV2') as StrategySplitterV2

    strategy = UniswapV3ConverterStrategy__factory.connect(strategyAddress, signer)
    splitter = StrategySplitterV2__factory.connect(await strategy.splitter(), signer)

    profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN]) as StrategyProfitHolder
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  })

  it('Upgrade splitter and strategy', async() => {
    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
    console.log('Current splitter version', await splitter.SPLITTER_VERSION())
    console.log('Current strategy version', await strategy.STRATEGY_VERSION())
    const controllerSigner = await DeployerUtilsLocal.impersonate(await strategy.controller())
    const splitterProxy = ProxyControlled__factory.connect(splitter.address, controllerSigner)
    await splitterProxy.upgrade(splitterNewImpl.address)
    console.log('Upgraded splitter version', await splitter.SPLITTER_VERSION())
    const strategyProxy = ProxyControlled__factory.connect(strategyAddress, controllerSigner)
    await strategyProxy.upgrade(newImpl.address)
    console.log('Upgraded strategy version', await strategy.STRATEGY_VERSION())

    await splitter.connect(operator).refreshValidStrategies()
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

    const swapAssetValue = parseUnits('300000', 6);
    await UniswapV3StrategyUtils.movePriceUp(signer, strategyAddress, MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAssetValue);
    expect(await strategy.needRebalance()).eq(true)
    console.log('Rebalance..')
    await strategy.connect(operator).rebalance()
    expect(await strategy.needRebalance()).eq(false)
  })
})