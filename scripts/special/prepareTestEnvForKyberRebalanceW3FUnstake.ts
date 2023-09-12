/* tslint:disable:no-trailing-whitespace */
// tslint:disable-next-line:ban-ts-ignore
// @ts-ignore
import hre, {ethers, run} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {
  ControllerV2__factory, IERC20__factory, IStrategyV2, KyberConverterStrategy, KyberConverterStrategy__factory,
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
import {TimeUtils} from "../utils/TimeUtils";
import { reset } from '@nomicfoundation/hardhat-network-helpers';
import { EnvSetup } from '../utils/EnvSetup';

async function main() {
  const chainId = Misc.getChainId()
  if (chainId !== 137) {
    console.error(`Incorrect hardhat chainId ${chainId}. Need 137.`)
    process.exit(-1)
  }
  await reset(EnvSetup.getEnv().maticRpcUrl)

  const signer = (await ethers.getSigners())[0];

  const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

  const core = Addresses.getCore();
  const controller = DeployerUtilsLocal.getController(signer);
  const asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
  const converterAddress = getConverterAddress();

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
        21,
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
  const strategy = data.strategy as KyberConverterStrategy
  const vault = data.vault.connect(signer)

  await ConverterUtils.whitelist([strategy.address]);
  await vault.connect(gov).setWithdrawRequestBlocks(0)

  await ConverterUtils.disableAaveV2(signer)

  const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
  await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, parseUnits('0.001', 6));

  const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.KNC_TOKEN])
  await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

  console.log('deposit...');
  await asset.approve(vault.address, Misc.MAX_UINT);
  await TokenUtils.getToken(asset.address, signer.address, parseUnits('1000', 6));
  await vault.deposit(parseUnits('1000', 6), signer.address);

  // prepare to rebalance
  await TimeUtils.advanceBlocksOnTs(31 * 86400);

  const needRebalance = await strategy.needRebalance()
  if (!needRebalance) {
    console.log('Not need rebalance. Increase timestamp.')
    process.exit(-1)
  }

  // signer must be operator for rebalancing
  const controllerV2 = ControllerV2__factory.connect(controller.address, signer)
  const governanceAsSigner = await DeployerUtilsLocal.impersonate(await controllerV2.governance())
  await controllerV2.connect(governanceAsSigner).registerOperator(signer.address)

  console.log('')
  console.log('Run:')
  console.log(`TEST_STRATEGY=${strategy.address} npx hardhat test test/strategies/polygon/kyber/KyberConverterStrategyAggRebalanceW3FTest.ts --network localhost`)
  console.log('')

  // start localhost hardhat node
  await run("node", {'noDeploy': true});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
