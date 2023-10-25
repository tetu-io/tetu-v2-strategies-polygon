/* tslint:disable:interface-name */
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-web3';
import '@nomiclabs/hardhat-solhint';
import '@typechain/hardhat';
import 'hardhat-contract-sizer';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
import 'hardhat-abi-exporter';
import { subtask, task, types } from 'hardhat/config';
import { deployContract } from './scripts/deploy/DeployContract';
import 'hardhat-deploy';
import { deployAddresses } from './scripts/addresses/deploy-addresses';
import '@gelatonetwork/web3-functions-sdk/hardhat-plugin';
import path from 'path';
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from 'hardhat/builtin-tasks/task-names';
import './hardhat-verify/verify1-task';
import "hardhat-change-network";
import { EnvSetup } from './scripts/utils/EnvSetup';
import "hardhat-deal";

task('deploy1', 'Deploy contract', async function(args, hre, runSuper) {
  const [signer] = await hre.ethers.getSigners();
  // tslint:disable-next-line:ban-ts-ignore
  // @ts-ignore
  await deployContract(hre, signer, args.name);
}).addPositionalParam('name', 'Name of the smart contract to deploy');

// https://binaries.soliditylang.org/linux-amd64/list.json
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async(args, hre, runSuper) => {
  if (EnvSetup.getEnv().localSolc) {
    const compilerPath = path.join(__dirname, 'solc-0-8-17');
    return {
      compilerPath,
      isSolcJs: false,
      version: '0.8.17',
      longVersion: '0.8.17+commit.8df45f5f',
    };
  }
  return runSuper();
});

export default {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: EnvSetup.getEnv().hardhatChainId,
      timeout: 99999999,
      blockGasLimit: 0x1fffffffffffff,
      gas: EnvSetup.getEnv().hardhatChainId === 1 ? 19_000_000 :
        EnvSetup.getEnv().hardhatChainId === 137 ? 19_000_000 :
          9_000_000,
      forking: EnvSetup.getEnv().hardhatChainId !== 31337 ? {
        url:
          EnvSetup.getEnv().hardhatChainId === 1 ? EnvSetup.getEnv().ethRpcUrl :
            EnvSetup.getEnv().hardhatChainId === 137 ? EnvSetup.getEnv().maticRpcUrl :
                EnvSetup.getEnv().hardhatChainId === 8453 ? EnvSetup.getEnv().baseRpcUrl :
                    undefined,
        blockNumber:
          EnvSetup.getEnv().hardhatChainId === 1 ? EnvSetup.getEnv().ethForkBlock !== 0 ? EnvSetup.getEnv().ethForkBlock : undefined :
            EnvSetup.getEnv().hardhatChainId === 137 ? EnvSetup.getEnv().maticForkBlock !== 0 ? EnvSetup.getEnv().maticForkBlock : undefined :
                EnvSetup.getEnv().hardhatChainId === 8453 ? EnvSetup.getEnv().baseForkBlock !== 0 ? EnvSetup.getEnv().baseForkBlock : undefined :
                    undefined,
      } : undefined,
      accounts: {
        mnemonic: 'test test test test test test test test test test test junk',
        path: 'm/44\'/60\'/0\'/0',
        accountsBalance: '100000000000000000000000000000',
      },
      loggingEnabled: EnvSetup.getEnv().hardhatLogsEnabled,
    },
    matic: {
      url: EnvSetup.getEnv().maticRpcUrl || '',
      timeout: 99999,
      chainId: 137,
      gas: 12_000_000,
      // gasPrice: 50_000_000_000,
      // gasMultiplier: 1.3,
      accounts: [EnvSetup.getEnv().privateKey],
    },
    base: {
      url: EnvSetup.getEnv().baseRpcUrl || '',
      timeout: 99999,
      chainId: 8453,
      gas: 12_000_000,
      accounts: [EnvSetup.getEnv().privateKey],
    },
    w3fmatic: {
      chainId: 137,
      accounts: [EnvSetup.getEnv().privateKey],
      url: 'http://127.0.0.1:8545',
    },
    foundry: {
      chainId: 31337,
      url: 'http://127.0.0.1:8545',
      // accounts: [EnvSetup.getEnv().privateKey], do not use it, impersonate will be broken
    },
    eth: {
      url: EnvSetup.getEnv().ethRpcUrl || '',
      chainId: 1,
      accounts: [EnvSetup.getEnv().privateKey],
    },
    sepolia: {
      url: EnvSetup.getEnv().sepoliaRpcUrl || '',
      chainId: 11155111,
      // gas: 50_000_000_000,
      accounts: [EnvSetup.getEnv().privateKey],
    },
  },
  etherscan: {
    //  https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html#multiple-api-keys-and-alternative-block-explorers
    apiKey: {
      mainnet: EnvSetup.getEnv().networkScanKey,
      goerli: EnvSetup.getEnv().networkScanKey,
      sepolia: EnvSetup.getEnv().networkScanKey,
      polygon: EnvSetup.getEnv().networkScanKeyMatic || EnvSetup.getEnv().networkScanKey,
      base: EnvSetup.getEnv().networkScanKeyBase || EnvSetup.getEnv().networkScanKey,
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org"
        }
      }
    ]
  },
  verify: {
    etherscan: {
      apiKey: EnvSetup.getEnv().networkScanKey,
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.17',
        settings: {
          optimizer: {
            enabled: true,
            runs: 150,
          },
          // "viaIR": true,
          outputSelection: { '*': { '*': ['*'], '': ['*'] } },
        },
      },
    ],
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: {
    timeout: 9999999999,
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: false,
    disambiguatePaths: false,
  },
  gasReporter: {
    enabled: false,
    currency: 'USD',
    gasPrice: 21,
  },
  typechain: {
    outDir: 'typechain',
  },
  abiExporter: {
    path: './abis',
    runOnCompile: false,
    spacing: 2,
    pretty: false,
  },
  namedAccounts: deployAddresses,
  w3f: {
    rootDir: './web3-functions',
    debug: true,
    networks: ['w3fmatic'],
  },
};
