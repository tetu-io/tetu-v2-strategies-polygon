import {config as dotEnvConfig} from "dotenv";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-web3";
import "@nomiclabs/hardhat-solhint";
import "@typechain/hardhat";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "hardhat-tracer";
import "solidity-coverage"
import "hardhat-abi-exporter"
import {task} from "hardhat/config";
import {deployContract} from "./scripts/deploy/DeployContract";
import "hardhat-deploy";
import { MaticAddresses } from "./scripts/MaticAddresses"

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    hardhatChainId: {
      type: "number",
      default: 137
    },
    maticRpcUrl: {
      type: "string",
    },
    networkScanKey: {
      type: "string",
    },
    privateKey: {
      type: "string",
      default: "85bb5fa78d5c4ed1fde856e9d0d1fe19973d7a79ce9ed6c0358ee06a4550504e" // random account
    },
    maticForkBlock: {
      type: "number",
      default: 0
    },
  }).argv;

// task("deploy", "Deploy contract", async function (args, hre, runSuper) {
//   const [signer] = await hre.ethers.getSigners();
//   // tslint:disable-next-line:ban-ts-ignore
//   // @ts-ignore
//   await deployContract(hre, signer, args.name)
// }).addPositionalParam("name", "Name of the smart contract to deploy");

export default {
  defaultNetwork: "hardhat",
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
                undefined
      } : undefined,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        path: "m/44'/60'/0'/0",
        accountsBalance: "100000000000000000000000000000"
      },
      // loggingEnabled: true,
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
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 150,
          }
        }
      },
    ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 9999999999
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: false,
    disambiguatePaths: false,
  },
  gasReporter: {
    enabled: false,
    currency: 'USD',
    gasPrice: 21
  },
  typechain: {
    outDir: "typechain",
  },
  abiExporter: {
    path: './artifacts/abi',
    runOnCompile: false,
    spacing: 2,
    pretty: true,
  },
  namedAccounts: {
    deployer: 0,
    USDC_ADDRESS: {
      "hardhat": MaticAddresses.USDC_TOKEN,
      "matic": MaticAddresses.USDC_TOKEN
    },
    DAI_ADDRESS: {
      "hardhat": MaticAddresses.DAI_TOKEN,
      "matic": MaticAddresses.DAI_TOKEN
    },
    USDT_ADDRESS: {
      "hardhat": MaticAddresses.USDT_TOKEN,
      "matic": MaticAddresses.USDT_TOKEN
    },
    X_USDC_VAULT_ADDRESS: {
      "hardhat": "0xeE3B4Ce32A6229ae15903CDa0A5Da92E739685f7",
      "matic": "0xeE3B4Ce32A6229ae15903CDa0A5Da92E739685f7"
    },
    X_DAI_VAULT_ADDRESS: {
      "hardhat": "0xb4607D4B8EcFafd063b3A3563C02801c4C7366B2",
      "matic": "0xb4607D4B8EcFafd063b3A3563C02801c4C7366B2"
    },
    X_USDT_VAULT_ADDRESS: {
      "hardhat": "0xE680e0317402ad3CB37D5ed9fc642702658Ef57F",
      "matic": "0xE680e0317402ad3CB37D5ed9fc642702658Ef57F"
    },
    LIQUIDATOR_ADDRESS: {
      "hardhat": "0xC737eaB847Ae6A92028862fE38b828db41314772",
      "matic": "0xC737eaB847Ae6A92028862fE38b828db41314772"
    },
    X_TETU_ADDRESS: {
      "hardhat": "0x225084D30cc297F3b177d9f93f5C3Ab8fb6a1454",
      "matic": "0x225084D30cc297F3b177d9f93f5C3Ab8fb6a1454"
    },
    ERC4626_LINEAR_POOL_FACTORY_ADDRESS: {
      "hardhat": "0xa3B9515A9c557455BC53F7a535A85219b59e8B2E",
      "matic": "0xa3B9515A9c557455BC53F7a535A85219b59e8B2E"
    },
    COMPOSABLE_STABLE_POOL_FACTORY_ADDRESS: {
      "hardhat": "0x7bc6C0E73EDAa66eF3F6E2f27b0EE8661834c6C9",
      "matic": "0x7bc6C0E73EDAa66eF3F6E2f27b0EE8661834c6C9"
    }
  }
};
