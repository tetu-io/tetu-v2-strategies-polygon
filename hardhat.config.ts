import { config as dotEnvConfig } from 'dotenv';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-web3';
import '@nomiclabs/hardhat-solhint';
import '@openzeppelin/hardhat-upgrades';
import '@typechain/hardhat';
import 'hardhat-contract-sizer';
import 'hardhat-gas-reporter';
import 'hardhat-tracer';
import 'solidity-coverage';
import 'hardhat-abi-exporter';
import { task } from 'hardhat/config';
import { deployContract } from './scripts/deploy/DeployContract';
import 'hardhat-deploy';
import { deployAddresses } from './scripts/addresses/deploy-addresses';
import '@gelatonetwork/web3-functions-sdk/hardhat-plugin';

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    hardhatChainId: {
      type: 'number',
      default: 137,
    },
    maticRpcUrl: {
      type: 'string',
    },
    networkScanKey: {
      type: 'string',
    },
    privateKey: {
      type: 'string',
      default: '85bb5fa78d5c4ed1fde856e9d0d1fe19973d7a79ce9ed6c0358ee06a4550504e', // random account
    },
    maticForkBlock: {
      type: 'number',
      default: 43620959,
    },
    hardhatLogsEnabled: {
      type: 'boolean',
      default: false,
    },
  }).argv;

task('deploy1', 'Deploy contract', async function(args, hre, runSuper) {
  const [signer] = await hre.ethers.getSigners();
  // tslint:disable-next-line:ban-ts-ignore
  // @ts-ignore
  await deployContract(hre, signer, args.name);
}).addPositionalParam('name', 'Name of the smart contract to deploy');

export default {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: argv.hardhatChainId,
      timeout: 99999999,
      blockGasLimit: 0x1fffffffffffff,
      gas: argv.hardhatChainId === 1 ? 19_000_000 :
        argv.hardhatChainId === 137 ? 19_000_000 :
          9_000_000,
      forking: argv.hardhatChainId !== 31337 ? {
        url:
          argv.hardhatChainId === 1 ? argv.ethRpcUrl :
            argv.hardhatChainId === 137 ? argv.maticRpcUrl :
              undefined,
        blockNumber:
          argv.hardhatChainId === 1 ? argv.ethForkBlock !== 0 ? argv.ethForkBlock : undefined :
            argv.hardhatChainId === 137 ? argv.maticForkBlock !== 0 ? argv.maticForkBlock : undefined :
              undefined,
      } : undefined,
      accounts: {
        mnemonic: 'test test test test test test test test test test test junk',
        path: 'm/44\'/60\'/0\'/0',
        accountsBalance: '100000000000000000000000000000',
      },
      loggingEnabled: argv.hardhatLogsEnabled,
    },
    matic: {
      url: argv.maticRpcUrl || '',
      timeout: 99999,
      chainId: 137,
      gas: 12_000_000,
      // gasPrice: 50_000_000_000,
      // gasMultiplier: 1.3,
      accounts: [argv.privateKey],
    },
    w3fmatic: {
      chainId: 137,
      accounts: [argv.privateKey],
      url: 'http://127.0.0.1:8545',
    },
    localhost: {
      timeout: 9999999999,
    },
    eth: {
      url: argv.ethRpcUrl || '',
      chainId: 1,
      accounts: [argv.privateKey],
    },
    sepolia: {
      url: argv.sepoliaRpcUrl || '',
      chainId: 11155111,
      // gas: 50_000_000_000,
      accounts: [argv.privateKey],
    },
  },
  etherscan: {
    //  https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html#multiple-api-keys-and-alternative-block-explorers
    apiKey: {
      mainnet: argv.networkScanKey,
      goerli: argv.networkScanKey,
      sepolia: argv.networkScanKey,
      polygon: argv.networkScanKeyMatic || argv.networkScanKey,
    },
  },
  verify: {
    etherscan: {
      apiKey: argv.networkScanKey,
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
    path: './artifacts/abi',
    runOnCompile: false,
    spacing: 2,
    pretty: true,
  },
  namedAccounts: deployAddresses,
  w3f: {
    rootDir: './web3-functions',
    debug: true,
    networks: ['w3fmatic'],
  },
};
