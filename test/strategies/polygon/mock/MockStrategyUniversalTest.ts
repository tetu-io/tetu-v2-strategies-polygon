import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { config as dotEnvConfig } from 'dotenv';
import { DeployInfo } from '../../../baseUT/utils/DeployInfo';
import { StrategyTestUtils } from '../../../baseUT/utils/StrategyTestUtils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { IStrategyV2, MockStrategySimple__factory } from '../../../../typechain';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import { PolygonAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';

// const {expect} = chai;
chai.use(chaiAsPromised);

// todo fix
describe.skip('Universal tests', async() => {

  const deployInfo: DeployInfo = new DeployInfo();
  before(async function() {
    await StrategyTestUtils.deployCoreAndInit(deployInfo);
  });

  const strategyName = 'MockStrategySimple';
  const asset = PolygonAddresses.USDC_TOKEN;
  const assetName = 'USDC';
  const vaultName = 'mock' + assetName;
  const core = Addresses.getCore();

  const deployer = async(signer: SignerWithAddress) => {

    const controller = DeployerUtilsLocal.getController(signer);
    const strategyDeployer = async(splitterAddress: string) => {
      const strategy = MockStrategySimple__factory.connect(
        await DeployerUtils.deployProxy(signer, strategyName), signer);

      await strategy.init(
        core.controller,
        splitterAddress,
        asset,
      );

      return strategy as unknown as IStrategyV2;
    };

    console.log('getControllerGovernance...');
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    console.log('deployAndInitVaultAndStrategy...');
    return DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset, vaultName, strategyDeployer, controller, gov,
      100, 250, 500, false,
    );

  };

  /* tslint:disable:no-floating-promises */
  // await startDefaultStrategyTest(
  //   strategyName,
  //   asset,
  //   assetName,
  //   deployInfo,
  //   deployer,
  // );


});
