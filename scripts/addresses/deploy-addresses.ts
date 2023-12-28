import { MaticAddresses } from './MaticAddresses';
import { BaseAddresses } from "./BaseAddresses";
import {ZkevmAddresses} from "./ZkevmAddresses";

export const deployAddresses = {
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
  WMATIC_ADDRESS: {
    "hardhat": MaticAddresses.WMATIC_TOKEN,
    "matic": MaticAddresses.WMATIC_TOKEN
  },
  STMATIC_ADDRESS: {
    "hardhat": MaticAddresses.STMATIC_TOKEN,
    "matic": MaticAddresses.STMATIC_TOKEN
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
  X_MATIC_VAULT_ADDRESS: {
    "hardhat": "0xBd2E7f163D7605fa140D873Fea3e28a031370363",
    "matic": "0xBd2E7f163D7605fa140D873Fea3e28a031370363"
  },
  X_ST_MATIC_VAULT_ADDRESS: {
    "hardhat": "0xa0a88Eaf9b0c4f09dE183F5ba3ba4Bd967a92093",
    "matic": "0xa0a88Eaf9b0c4f09dE183F5ba3ba4Bd967a92093"
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
  },
  CONVERTER_ADDRESS: {
    "hardhat": MaticAddresses.TETU_CONVERTER,
    "matic": MaticAddresses.TETU_CONVERTER,
    "base": BaseAddresses.TETU_CONVERTER,
    "zkevm": ZkevmAddresses.TETU_CONVERTER,
  },
  UNISWAPV3_USDC_USDT_100: {
    "hardhat": MaticAddresses.UNISWAPV3_USDC_USDT_100,
    "matic": MaticAddresses.UNISWAPV3_USDC_USDT_100
  },
  UNISWAPV3_BASE_USDC_USDbC_100: {
    "hardhat": BaseAddresses.UNISWAPV3_USDC_USDbC_100,
    "base": BaseAddresses.UNISWAPV3_USDC_USDbC_100
  },
  UNISWAPV3_BASE_DAI_USDbC_100: {
    "hardhat": BaseAddresses.UNISWAPV3_DAI_USDbC_100,
    "base": BaseAddresses.UNISWAPV3_DAI_USDbC_100
  },
  UNISWAPV3_USDC_MIMATIC_100: {
    "hardhat": MaticAddresses.UNISWAPV3_USDC_miMATIC_100,
    "matic": MaticAddresses.UNISWAPV3_USDC_miMATIC_100
  },
  UNISWAPV3_USDC_DAI_100: {
    "hardhat": MaticAddresses.UNISWAPV3_USDC_DAI_100,
    "matic": MaticAddresses.UNISWAPV3_USDC_DAI_100
  },
  UNISWAPV3_WSTETH_WETH_100: {
    "hardhat": MaticAddresses.UNISWAPV3_wstETH_WETH_100,
    "matic": MaticAddresses.UNISWAPV3_wstETH_WETH_100
  },
  UNISWAPV3_WMATIC_MATICX_100: {
    "hardhat": MaticAddresses.UNISWAPV3_WMATIC_MaticX_100,
    "matic": MaticAddresses.UNISWAPV3_WMATIC_MaticX_100
  },
  SPLITTER_USDC_ADDRESS: {
    "hardhat": "0xA31cE671A0069020F7c87ce23F9cAAA7274C794c",
    "matic": "0xA31cE671A0069020F7c87ce23F9cAAA7274C794c",
  },
  SPLITTER_USDC_ADDRESS_ZKEVM: {
    "hardhat": "0x05836f1D0372b4f6c13B2c20f315Be81ffBEA671",
    "zkevm": "0x05836f1D0372b4f6c13B2c20f315Be81ffBEA671", // vault 0x3650823873F34a019533db164f492e09365cfa7E
  },
  SPLITTER_USDbC_ADDRESS: {
    "hardhat": "0xA01ac87f8Fc03FA2c497beFB24C74D538958DAbA",
    "base": "0xA01ac87f8Fc03FA2c497beFB24C74D538958DAbA"
  },
  SPLITTER_WMATIC_ADDRESS: {
    "hardhat": "0x645C823F09AA9aD886CfaA551BB2a29c5973804c",
    "matic": "0x645C823F09AA9aD886CfaA551BB2a29c5973804c"
  },
  SPLITTER_WETH_ADDRESS: {
    "hardhat": "0xb4e9CD554F14d3CB2d45300ed6464d462c017894",
    "matic": "0xb4e9CD554F14d3CB2d45300ed6464d462c017894"
  },
  SPLITTER_WBTC_ADDRESS: {
    "hardhat": "0x217dB66Dc9300AaCE215beEdc1Aa26741e58CC67",
    "matic": "0x217dB66Dc9300AaCE215beEdc1Aa26741e58CC67"
  },
  ST_MATIC_RATE_PROVIDER_ADDRESS: {
    "hardhat": "0xdEd6C522d803E35f65318a9a4d7333a22d582199",
    "matic": "0xdEd6C522d803E35f65318a9a4d7333a22d582199"
  },
  BALANCER_POOL_T_USD: {
    "hardhat": MaticAddresses.BALANCER_POOL_T_USD,
    "matic": MaticAddresses.BALANCER_POOL_T_USD
  },
  ALGEBRA_USDC_USDT: {
    "hardhat": MaticAddresses.ALGEBRA_USDC_USDT,
    "matic": MaticAddresses.ALGEBRA_USDC_USDT
  },
  DQUICK_ADDRESS: {
    "hardhat": MaticAddresses.dQUICK_TOKEN,
    "matic": MaticAddresses.dQUICK_TOKEN
  },
  KYBER_USDC_USDT: {
    "hardhat": MaticAddresses.KYBER_USDC_USDT,
    "matic": MaticAddresses.KYBER_USDC_USDT
  },
  KYBER_USDC_DAI: {
    "hardhat": MaticAddresses.KYBER_USDC_DAI,
    "matic": MaticAddresses.KYBER_USDC_DAI
  },
  KNC_ADDRESS: {
    "hardhat": MaticAddresses.KNC_TOKEN,
    "matic": MaticAddresses.KNC_TOKEN
  },
  PANCAKE_USDC_USDT_ZKEVM: {
    "hardhat": ZkevmAddresses.PANCAKE_POOL_USDT_USDC_LP,
    "zkevm": ZkevmAddresses.PANCAKE_POOL_USDT_USDC_LP
  },
  PANCAKE_SWAP_TOKEN: {
    "hardhat": ZkevmAddresses.PANCAKE_SWAP_TOKEN,
    "zkevm": ZkevmAddresses.PANCAKE_SWAP_TOKEN
  },
  PANCAKE_MASTERCHEF: {
    "hardhat": ZkevmAddresses.PANCAKE_MASTER_CHEF_V3,
    "zkevm": ZkevmAddresses.PANCAKE_MASTER_CHEF_V3
  }
}
