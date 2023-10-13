import { getDeployedContractByName, txParams2 } from '../deploy_constants/deploy-helpers';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import {
  ControllerV2__factory,
  IStrategyV2__factory,
  RebalanceDebtConfig__factory,
  StrategySplitterV2__factory,
  TetuVaultV2__factory,
} from '../typechain';
import { ethers } from 'hardhat';
import { NSRUtils } from './utils/NSRUtils';
import { RunHelper } from './utils/RunHelper';

interface IConfig {
  lockedPercentForDelayedRebalance: number;
  lockedPercentForForcedRebalance: number;
  rebalanceDebtDelay: number;
}

const strategyConfigs: { [addr: string]: IConfig } = {
  // Strategy UniV3 USDC/USDT-100 NSR
  '0xCdc5560AB926Dca3d4989bF814469Af3f989Ab2C': {
    lockedPercentForDelayedRebalance: 25,
    lockedPercentForForcedRebalance: 70,
    rebalanceDebtDelay: 600,
  },
  // Strategy Algebra USDC/USDT NSR
  '0xA8105284aA9C9A20A2081EEE1ceeF03d9719A5AD': {
    lockedPercentForDelayedRebalance: 25,
    lockedPercentForForcedRebalance: 70,
    rebalanceDebtDelay: 600,
  },
  // Strategy Kyber USDC/USDT NSR
  '0x792Bcc2f14FdCB9FAf7E12223a564e7459eA4201': {
    lockedPercentForDelayedRebalance: 25,
    lockedPercentForForcedRebalance: 70,
    rebalanceDebtDelay: 600,
  },
  // Strategy Kyber USDC/DAI NSR
  '0xd0Dff2a31516fEDb80824C9B9E2DDcbfeF2C41e2': {
    lockedPercentForDelayedRebalance: 25,
    lockedPercentForForcedRebalance: 70,
    rebalanceDebtDelay: 600,
  },
};

async function main() {
  const core = Addresses.getCore();
  const configAddress = await getDeployedContractByName('RebalanceDebtConfig');
  console.log('RebalanceDebtConfig', configAddress);
  const signer = (await ethers.getSigners())[0];
  const configContract = RebalanceDebtConfig__factory.connect(configAddress, signer);
  const vaults = await ControllerV2__factory.connect(core.controller, ethers.provider).vaultsList();
  console.log('vaults', vaults.length);

  for (const vault of vaults) {
    const splitter = await TetuVaultV2__factory.connect(vault, ethers.provider).splitter();
    const splitterContract = StrategySplitterV2__factory.connect(splitter, ethers.provider);
    const strategies = await splitterContract.allStrategies();
    // console.log('strategies', strategies.length);
    for (const strategyAddress of strategies) {
      if (await NSRUtils.isStrategyEligibleForNSR(strategyAddress)) {
        const strategyName = await IStrategyV2__factory.connect(strategyAddress, ethers.provider)
          .strategySpecificName();
        const config = await configContract.strategyConfig(strategyAddress);

        const localConfig = strategyConfigs[strategyAddress];

        if (!localConfig) {
          throw Error(`Strategy ${strategyName} ${strategyAddress} not found in local config.`);
        }

        if (
          localConfig.lockedPercentForDelayedRebalance !== config.lockedPercentForDelayedRebalance.toNumber()
          || localConfig.lockedPercentForForcedRebalance !== config.lockedPercentForForcedRebalance.toNumber()
          || localConfig.rebalanceDebtDelay !== config.rebalanceDebtDelay.toNumber()
        ) {
          console.log(`Strategy ${strategyName} ${strategyAddress}. Need change config: [${config.lockedPercentForDelayedRebalance.toNumber()}, ${config.lockedPercentForForcedRebalance.toNumber()}, ${config.rebalanceDebtDelay.toNumber()}] -> [${strategyConfigs[strategyAddress].lockedPercentForDelayedRebalance}, ${strategyConfigs[strategyAddress].lockedPercentForForcedRebalance}, ${strategyConfigs[strategyAddress].rebalanceDebtDelay}].`);
          const tp = await txParams2();
          await RunHelper.runAndWaitAndSpeedUp(
            ethers.provider,
            () => configContract.setConfig(
              strategyAddress,
              localConfig.lockedPercentForDelayedRebalance,
              localConfig.lockedPercentForForcedRebalance,
              localConfig.rebalanceDebtDelay,
              { ...tp },
            ),
            true,
            true,
          );
        } else {
          console.log(`Strategy ${strategyName} ${strategyAddress}. Config is ok.`);
        }
      }

    }

  }

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
