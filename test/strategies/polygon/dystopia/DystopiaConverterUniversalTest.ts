import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {startDefaultStrategyTest} from "../../DefaultSingleTokenStrategyTest";
import {config as dotEnvConfig} from "dotenv";
import {DeployInfo} from "../../DeployInfo";
import {StrategyTestUtils} from "../../StrategyTestUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {
  DystopiaConverterStrategy__factory, IStrategyV2
} from "../../../../typechain";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../ConverterUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import { getConverterAddress } from '../../../../scripts/utils/Misc';

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: "boolean",
      default: false,
    },
    hardhatChainId: {
      type: "number",
      default: 137
    },
  }).argv;

// const {expect} = chai;
chai.use(chaiAsPromised);

//todo broken
describe.skip('DystopiaConverterUniversalTest', async () => {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }


  const deployInfo: DeployInfo = new DeployInfo();
  before(async function () {
    await StrategyTestUtils.deployCoreAndInit(deployInfo, argv.deployCoreContracts);
  });

  const strategyName = 'DystopiaConverterStrategy';
  const assetName = 'USDC';
  const asset = PolygonAddresses.USDC_TOKEN;
  const token1 = asset;
  // const token2 = PolygonAddresses.USDPlus_TOKEN;
  // const token2 = PolygonAddresses.USDT_TOKEN;
  const token2 = PolygonAddresses.DAI_TOKEN;
  const vaultName = 'tetu' + assetName;
  const core = Addresses.getCore();

  const deployer = async (signer: SignerWithAddress) => {

    const controller = DeployerUtilsLocal.getController(signer);
    const strategyDeployer = async (splitterAddress: string) => {
      const strategy = DystopiaConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, strategyName), signer);

      await strategy.init(
        core.controller,
        splitterAddress,
        [PolygonAddresses.TETU_TOKEN],
        getConverterAddress(),
        token1,
        token2,
        true
      );

      // Disable DForce (as it reverts on repay after block advance)
      await ConverterUtils.disableDForce(token1, token2, signer);

      return strategy as unknown as IStrategyV2;
    }

    console.log('getControllerGovernance...');
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

/*    { // Set Liquidator address // TODO remove after address updated onchain
      const controllerGov = ControllerV2__factory.connect(core.controller, gov);
      const _LIQUIDATOR = 4;
      const liquidatorAddr = '0xC737eaB847Ae6A92028862fE38b828db41314772'; // tools.liquidator;
      await controllerGov.announceAddressChange(_LIQUIDATOR, liquidatorAddr);
      await TimeUtils.advanceBlocksOnTs(86400 /!*1day*!/);
      await controllerGov.changeAddress(_LIQUIDATOR);
      const liqAddress = await controllerGov.liquidator();
      console.log('liqAddress', liqAddress);
    }*/

    console.log('deployAndInitVaultAndStrategy...');
    return DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset, vaultName, strategyDeployer, controller, gov,
      100, 250, 500, false
    );

  }

  /* tslint:disable:no-floating-promises */
  await startDefaultStrategyTest(
    strategyName,
    asset,
    assetName,
    deployInfo,
    deployer
  );


});
