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
  IRebalancingV2Strategy__factory,
  IStrategyV2__factory,
  StrategySplitterV2__factory,
  TetuVaultV2__factory,
} from '../typechain';
import { config as dotEnvConfig } from 'dotenv';
import { subscribeTgBot } from './telegram/tg-subscribe';
import { Misc } from './utils/Misc';
import { NSRUtils } from './utils/NSRUtils';
import { formatUnits } from 'ethers/lib/utils';

// test rebalance debt
// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForUniswapV3ReduceDebtW3F.ts
// TETU_REBALANCE_DEBT_STRATEGIES=<address> TETU_PAIR_BASED_STRATEGY_READER=<address> TETU_REBALANCE_DEBT_CONFIG=<address> hardhat run scripts/rebalanceDebt.ts --network localhost

// test fuse
// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForUniswapV3ReduceDebtFuseW3F.ts
// TETU_REBALANCE_DEBT_STRATEGIES=<address> TETU_PAIR_BASED_STRATEGY_READER=<address> TETU_REBALANCE_DEBT_CONFIG=<address> hardhat run scripts/rebalanceDebt.ts --network localhost

const MAX_ERROR_LENGTH = 1000;
const DELAY_BETWEEN_NSRS = 60;
const DELAY_AFTER_NSR = 10;
const DELAY_NEED_NSR_CONFIRM = 300;

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    nsrMsgSuccess: { //
      type: 'boolean',
      default: false,
    },
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
  console.log('Strategies NSR and debt rebalancer');

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
  console.log('Reader: ', readerAddress);

  const agg = argv.rebalanceDebtAgg;
  const oneInchProtocols = argv.rebalanceDebt1InchProtocols;

  const provider = ethers.provider;
  const signer = (await ethers.getSigners())[0];

  let lastNSR: number = 0;
  const needNSRTimestamp: { [addr: string]: number } = {};

  // noinspection InfiniteLoopJS
  while (true) {

    try {
      const vaults = await ControllerV2__factory.connect(core.controller, ethers.provider).vaultsList();
      console.log('vaults', vaults.length);

      for (const vault of vaults) {
        const splitter = await TetuVaultV2__factory.connect(vault, ethers.provider).splitter();
        const splitterContract = StrategySplitterV2__factory.connect(splitter, ethers.provider);
        const strategies = await splitterContract.allStrategies();
        console.log('strategies', strategies.length);

        for (const strategyAddress of strategies) {

          try {

            if (!(await NSRUtils.isStrategyEligibleForNSR(strategyAddress))) {
              continue;
            }

            const strategy = IRebalancingV2Strategy__factory.connect(strategyAddress, signer);
            const strategyName = await IStrategyV2__factory.connect(strategyAddress, ethers.provider)
              .strategySpecificName();
            console.log('Processing strategy', strategyName, strategyAddress);

            let now = await Misc.getBlockTsFromChain();

            // NSR
            const isPausedStrategy = await splitterContract.pausedStrategies(strategyAddress);
            const delayPassed = lastNSR + DELAY_BETWEEN_NSRS < now;
            const needNSR = await strategy.needRebalance();
            if (needNSR && !needNSRTimestamp[strategyAddress]) {
              console.log('update needNSRTimestamp for', strategyName);
              needNSRTimestamp[strategyAddress] = now;
            }
            if (!needNSR) {
              if (!needNSRTimestamp[strategyAddress]) {
                console.log('NO needNSR, remove needNSRTimestamp for', strategyName);
              }
              needNSRTimestamp[strategyAddress] = 0;
            }
            if (!isPausedStrategy
              && delayPassed
              && needNSR
              && now - needNSRTimestamp[strategyAddress] > DELAY_NEED_NSR_CONFIRM
            ) {
              console.log(strategyName, ' ----- PASSED needNSR, call NSR for');
              const tp = await txParams2();
              try {

                const gas = await strategy.estimateGas.rebalanceNoSwaps(true, { ...tp, gasLimit: 15_000_000 });
                console.log('estimated gas', formatUnits(gas, 9));

                await RunHelper.runAndWaitAndSpeedUp(
                  provider,
                  () => strategy.rebalanceNoSwaps(true, { ...tp, gasLimit: 15_000_000 }),
                  true,
                  true,
                );
                console.log('NSR success!', strategyName, strategyAddress);
                if (argv.nsrMsgSuccess) {
                  await sendMessageToTelegram(`NSR success! ${strategyName} ${strategyAddress}`);
                }

                now = await Misc.getBlockTsFromChain();
                lastNSR = now;
                await sleep(DELAY_AFTER_NSR * 1000);
              } catch (e) {
                console.log('Error NSR', strategyName, strategyAddress, e);
                await sendMessageToTelegram(`Error NSR ${strategyName} ${strategyAddress} ${(e as string).toString()
                  .substring(0, MAX_ERROR_LENGTH)}`);
              }
            } else {
              if (needNSRTimestamp[strategyAddress] !== 0) {
                console.log(
                  strategyName,
                  ' ---- Not yet, Until NSR seconds:',
                  DELAY_NEED_NSR_CONFIRM - (now - needNSRTimestamp[strategyAddress]),
                );
              }
            }

            // Rebalance debt
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

                try {
                  const gas = await signer.estimateGas({
                    to: callData[0].to,
                    data: callData[0].data,
                    ...tp,
                    gasLimit: 15_000_000,
                  });

                  console.log('estimated gas', formatUnits(gas, 9));

                  await RunHelper.runAndWaitAndSpeedUp(provider, () =>
                      signer.sendTransaction({
                        to: callData[0].to,
                        data: callData[0].data,
                        ...tp,
                        gasLimit: 15_000_000,
                      }),
                    true, true,
                  );
                  console.log('Rebalance success!', strategyName, strategyAddress);
                  if (argv.rebalanceDebtMsgSuccess) {
                    await sendMessageToTelegram(`Rebalance success! ${strategyName} ${strategyAddress}`);
                  }
                } catch (e) {
                  console.log('Error EXECUTE', strategyName, strategyAddress, e);
                  await sendMessageToTelegram(`Error EXECUTE ${strategyName} ${strategyAddress} ${(e as string).toString()
                    .substring(0, MAX_ERROR_LENGTH)}`);
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
            await sendMessageToTelegram(`Error inside strategy processing ${strategyAddress} ${(e as string).toString()
              .substring(0, MAX_ERROR_LENGTH)}`);
          }
        }
      }
    } catch (e) {
      console.log('error in debt rebalance loop', e);
      await sendMessageToTelegram(`error in debt rebalance loop ${(e as string).toString()
        .substring(0, MAX_ERROR_LENGTH)}`);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
