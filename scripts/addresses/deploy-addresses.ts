import { MaticAddresses } from './MaticAddresses';
import {Misc} from "../utils/Misc";

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
  },
  CONVERTER_ADDRESS: {
    "hardhat": MaticAddresses.TETU_CONVERTER,
    "matic": MaticAddresses.TETU_CONVERTER
  },
  UNISWAPV3_USDC_USDT_100: {
    "hardhat": MaticAddresses.UNISWAPV3_USDC_USDT_100,
    "matic": MaticAddresses.UNISWAPV3_USDC_USDT_100
  },
}
