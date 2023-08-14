/* tslint:disable:no-trailing-whitespace */
// tslint:disable-next-line:ban-ts-ignore
// @ts-ignore
import hre, {ethers, run} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {
  AlgebraConverterStrategy,
  AlgebraConverterStrategy__factory,
  ControllerV2__factory, IERC20__factory, IStrategyV2,
} from "../../typechain";
import {DeployerUtilsLocal} from "../utils/DeployerUtilsLocal";
import {UniswapV3StrategyUtils} from "../../test/UniswapV3StrategyUtils";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../utils/Misc";
import {ConverterUtils} from "../../test/baseUT/utils/ConverterUtils";
import {UniversalTestUtils} from "../../test/baseUT/utils/UniversalTestUtils";
import {TokenUtils} from "../utils/TokenUtils";

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId
  if (chainId !== 137) {
    console.error(`Incorrect hardhat chainId ${chainId}. Need 137.`)
    process.exit(-1)
  }

  const signer = (await ethers.getSigners())[0];

  const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

  const core = Addresses.getCore();
  const controller = DeployerUtilsLocal.getController(signer);
  const asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
  const converterAddress = getConverterAddress();

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
  const strategy = data.strategy as AlgebraConverterStrategy
  const vault = data.vault.connect(signer)

  await ConverterUtils.whitelist([strategy.address]);
  await vault.connect(gov).setWithdrawRequestBlocks(0)

  await ConverterUtils.disableAaveV2(signer)

  const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
  await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, parseUnits('0.001', 6));

  const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN])
  await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

  // prepare to rebalance
  console.log('Swap..')
  await UniswapV3StrategyUtils.movePriceUp(signer, strategy.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('1200000', 6));

  const needRebalance = await strategy.needRebalance()
  if (!needRebalance) {
    console.log('Not need rebalance. Increase swap amount.')
    process.exit(-1)
  }

  // signer must be operator for rebalancing
  const controllerV2 = ControllerV2__factory.connect(controller.address, signer)
  const governanceAsSigner = await DeployerUtilsLocal.impersonate(await controllerV2.governance())
  await controllerV2.connect(governanceAsSigner).registerOperator(signer.address)

  console.log('')
  console.log('Run:')
  console.log(`TEST_STRATEGY=${strategy.address} npx hardhat test test/strategies/polygon/algebra/AlgebraConverterStrategyAggRebalanceW3FTest.ts --network localhost`)
  console.log('')

  // start localhost hardhat node
  await run("node", {'noDeploy': true});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
