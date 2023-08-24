/* tslint:disable */
import hre, { ethers } from 'hardhat';
import { runResolver } from '../web3-functions/w3f-utils';
import axios from 'axios';
import { RunHelper } from './utils/RunHelper';
import { getDeployedContractByName, txParams2 } from '../deploy_constants/deploy-helpers';
import { Web3FunctionResultCallData } from '@gelatonetwork/web3-functions-sdk';
import { sendMessageToTelegram } from './telegram/tg-sender';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import {
  ControllerV2__factory,
  IStrategyV2__factory,
  StrategySplitterV2__factory,
  TetuVaultV2__factory,
} from '../typechain';
import { config as dotEnvConfig } from 'dotenv';
import { subscribeTgBot } from './telegram/tg-subscribe';

// test rebalance debt
// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForUniswapV3ReduceDebtW3F.ts
// TETU_REBALANCE_DEBT_STRATEGIES=<address> TETU_PAIR_BASED_STRATEGY_READER=<address> TETU_REBALANCE_DEBT_CONFIG=<address> hardhat run scripts/rebalanceDebt.ts --network localhost

// test fuse
// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForUniswapV3ReduceDebtFuseW3F.ts
// TETU_REBALANCE_DEBT_STRATEGIES=<address> TETU_PAIR_BASED_STRATEGY_READER=<address> TETU_REBALANCE_DEBT_CONFIG=<address> hardhat run scripts/rebalanceDebt.ts --network localhost


dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    rebalanceDebtAgg: {
      type: 'string',
      default: '',
    },
    rebalanceDebt1InchProtocols: {
      type: 'string',
      default: '',
    },
    rebalanceDebtMsgSuccess: {
      type: 'boolean',
      default: false,
    },
    rebalanceDebtLoopDelay: {
      type: 'number',
      default: 60_000,
    },
  }).argv;

async function main() {
  console.log('Strategies debt rebalancer');

  if (!['localhost', 'matic'].includes(hre.network.name)) {
    console.log('Unsupported network', hre.network.name);
    console.log('Only localhost and matic networks supported');
    process.exit(-1);
  }

  await subscribeTgBot();
  await sendMessageToTelegram('Tetu rebalance debts started');

  const core = Addresses.getCore();
  const configAddress = await getDeployedContractByName('RebalanceDebtConfig');
  const readerAddress = await getDeployedContractByName('PairBasedStrategyReader');
  console.log('Config: ', configAddress);


  const agg = argv.rebalanceDebtAgg;
  const oneInchProtocols = argv.rebalanceDebt1InchProtocols;

  const provider = ethers.provider;
  const signer = (await ethers.getSigners())[0];

  // noinspection InfiniteLoopJS
  while (true) {

    try {
      const vaults = await ControllerV2__factory.connect(core.controller, ethers.provider).vaultsList();
      console.log('vaults', vaults.length);

      for (const vault of vaults) {
        const splitter = await TetuVaultV2__factory.connect(vault, ethers.provider).splitter();
        const strategies = await StrategySplitterV2__factory.connect(splitter, ethers.provider).allStrategies();
        console.log('strategies', strategies.length);

        for (const strategyAddress of strategies) {

          try {

            if (!(await isStrategyEligibleForNSR(strategyAddress))) {
              continue;
            }
            const strategyName = await IStrategyV2__factory.connect(strategyAddress, ethers.provider).NAME();
            console.log('Processing strategy', strategyName, strategyAddress);

            const result = await runResolver(
              provider,
              strategyAddress,
              readerAddress,
              configAddress,
              agg,
              oneInchProtocols,
              fetchFuncAxios,
            );

            if (result) {
              if (result.canExec) {
                console.log('Rebalance call', strategyName, result);
                if (typeof result.callData === 'string') {
                  throw Error('wrong callData for ' + strategyName);
                }
                const tp = await txParams2();
                const callData = result.callData as unknown as Web3FunctionResultCallData[];
                await RunHelper.runAndWaitAndSpeedUp(provider, () =>
                    signer.sendTransaction({
                      to: callData[0].to,
                      data: callData[0].data,
                      ...tp,
                    }),
                  true, true,
                );

                console.log('Rebalance success!', strategyName, strategyAddress);
                if (argv.rebalanceDebtMsgSuccess) {
                  await sendMessageToTelegram(`Rebalance success! ${strategyName} ${strategyAddress}`);
                }

              } else {
                console.log('Result can not be executed:', strategyName, result.message);
              }
            } else {
              console.log('Empty result!', strategyName);
              await sendMessageToTelegram('Empty result! ' + strategyName);
            }
          } catch (e) {
            console.log('Error inside strategy processing', strategyAddress, e);
            await sendMessageToTelegram(`Error inside strategy processing ${strategyAddress} ${e}`);
          }
        }
      }
    } catch (e) {
      console.log('error in debt rebalance loop', e);
      await sendMessageToTelegram(`error in debt rebalance loop ${e}`);
    }

    await sleep(argv.rebalanceDebtLoopDelay);
  }
}

const fetchFuncAxios = async(url: string) => {
  try {
    const r = await axios.get(url);
    if (r.status === 200) {
      return r.data;
    } else {
      console.log((`wrong response for fetch ${url} ${r.data}`));
      await sendMessageToTelegram(`wrong response for fetch ${url} ${r.data}`);
    }
  } catch (e) {
    await sendMessageToTelegram(`error fetch ${url}`);
    throw e;
  }
};

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function isStrategyEligibleForNSR(strategyAdr: string) {
  const version = await IStrategyV2__factory.connect(strategyAdr, ethers.provider).STRATEGY_VERSION();
  const name = await IStrategyV2__factory.connect(strategyAdr, ethers.provider).NAME();

  const names = new Set<string>([
    'UniswapV3 Converter Strategy',
    'Kyber Converter Strategy',
    'Algebra Converter Strategy',
  ]);

  return Number(version.charAt(0)) > 1 && names.has(name);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
