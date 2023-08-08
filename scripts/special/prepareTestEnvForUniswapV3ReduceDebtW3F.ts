/* tslint:disable:no-trailing-whitespace */
// tslint:disable-next-line:ban-ts-ignore
// @ts-ignore
import hre, {ethers, run} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {
  ControllerV2__factory,
  IERC20__factory,
  IStrategyV2, RebalanceDebtConfig,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
  UniswapV3Lib,
} from "../../typechain";
import {DeployerUtilsLocal} from "../utils/DeployerUtilsLocal";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../utils/Misc";
import {ConverterUtils} from "../../test/baseUT/utils/ConverterUtils";
import {UniversalTestUtils} from "../../test/baseUT/utils/UniversalTestUtils";
import {TokenUtils} from "../utils/TokenUtils";
import {UniversalUtils} from "../../test/baseUT/strategies/UniversalUtils";
import {MockHelper} from "../../test/baseUT/helpers/MockHelper";
import {UniswapV3LiquidityUtils} from "../../test/strategies/polygon/uniswapv3/utils/UniswapV3LiquidityUtils";
import {TimeUtils} from "../utils/TimeUtils";

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId
  if (chainId !== 137) {
    console.error(`Incorrect hardhat chainId ${chainId}. Need 137.`)
    process.exit(-1)
  }

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

  const signer = (await ethers.getSigners())[0];

  const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

  const core = Addresses.getCore();
  const controller = DeployerUtilsLocal.getController(signer);
  const asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
  const converterAddress = getConverterAddress();

  const reader = await MockHelper.createPairBasedStrategyReader(signer);
  const lib = await DeployerUtils.deployContract(signer, 'UniswapV3Lib') as UniswapV3Lib

  const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
    asset.address,
    'TetuV2_Univ3_USDC_USDT',
    async(_splitterAddress: string) => {
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
  const strategy = data.strategy as UniswapV3ConverterStrategy
  const vault = data.vault.connect(signer)

  await ConverterUtils.whitelist([strategy.address]);
  await vault.connect(gov).setWithdrawRequestBlocks(0)

  await ConverterUtils.disableAaveV2(signer)

  const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
  await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, parseUnits('0.001', 6));

  const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN,])
  await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

  const config = await DeployerUtils.deployContract(signer, 'RebalanceDebtConfig', controller.address) as RebalanceDebtConfig
  await config.connect(operator).setConfig(strategy.address, 25, 70, 3600)

  console.log('deposit...');
  await asset.approve(vault.address, Misc.MAX_UINT);
  await TokenUtils.getToken(asset.address, signer.address, parseUnits('1000', 6));
  await vault.deposit(parseUnits('1000', 6), signer.address);

  const state = await strategy.getDefaultState()
  for (let i = 0; i < 3; i++) {
    console.log(`Swap and rebalance. Step ${i}`)
    const amounts = await UniswapV3LiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib, MaticAddresses.UNISWAPV3_USDC_USDT_100)
    const priceB = await lib.getPrice(MaticAddresses.UNISWAPV3_USDC_USDT_100, MaticAddresses.USDT_TOKEN)
    let swapAmount = amounts[1].mul(priceB).div(parseUnits('1', 6))
    swapAmount = swapAmount.add(swapAmount.div(100))

    await UniversalUtils.movePoolPriceUp(signer, state.addr[2], state.addr[0], state.addr[1], MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, swapAmount);

    if (!(await strategy.needRebalance())) {
      console.log('Not need rebalance. Something wrong')
      process.exit(-1)
    }

    await strategy.connect(operator).rebalanceNoSwaps(true, {gasLimit: 19_000_000,})
  }

  // signer must be operator for rebalancing
  const controllerV2 = ControllerV2__factory.connect(controller.address, signer)
  const governanceAsSigner = await DeployerUtilsLocal.impersonate(await controllerV2.governance())
  await controllerV2.connect(governanceAsSigner).registerOperator(signer.address)

  await TimeUtils.advanceBlocksOnTs(3600)

  console.log('')
  console.log('Run:')
  console.log(`TEST_STRATEGY=${strategy.address} READER=${reader.address} CONFIG=${config.address} npx hardhat test test/strategies/polygon/W3FReduceDebtTest.ts --network localhost`)
  console.log('')

  // start localhost hardhat node
  await run("node", {'noDeploy': true});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
