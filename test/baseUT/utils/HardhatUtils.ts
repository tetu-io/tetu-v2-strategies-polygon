import hre from 'hardhat';
import { reset } from '@nomicfoundation/hardhat-network-helpers';
import { EnvSetup } from '../../../scripts/utils/EnvSetup';

export const HARDHAT_NETWORK_ID = 31337;
export const POLYGON_NETWORK_ID = 137;
export const BASE_NETWORK_ID = 8453;

interface IEnvData {
  rpcUrl: string;
  forkBlock: number;
}

export class HardhatUtils {

  static async switchToMostCurrentBlock() {
    await reset(EnvSetup.getEnv().maticRpcUrl);
  }

  static async switchToBlock(block: number, chain: number = POLYGON_NETWORK_ID) {
    const envData = this.getEnvData(chain);
    if (envData) {
      await reset(envData.rpcUrl, block);
    } else {
      await reset();
    }
  }

  static async restoreBlockFromEnv() {
    await reset(EnvSetup.getEnv().maticRpcUrl, EnvSetup.getEnv().maticForkBlock);
  }

  /**
   *
   * @param chainId
   * @param block
   *    Pass -1 to use most current block
   *    Pass "undefined" to use a block from env
   */
  public static async setupBeforeTest(chainId: number = HARDHAT_NETWORK_ID, block?: number) {
    const env = EnvSetup.getEnv();
    hre.config.networks.hardhat.chainId = chainId;
    // setup fresh hardhat fork with given chain id
    if (chainId === HARDHAT_NETWORK_ID) {
      await reset();
    } else if (chainId === POLYGON_NETWORK_ID) {
      await reset(
        env.maticRpcUrl,
        block
          ? block === -1
            ? undefined  // most current block
            : block
          : env.maticForkBlock
      );
    } else if (chainId === BASE_NETWORK_ID) {
      await reset(
          env.baseRpcUrl,
          block
              ? block === -1
                  ? undefined  // most current block
                  : block
              : env.baseForkBlock
      );
    } else {
      throw new Error('Unknown chain id ' + chainId);
    }
  }

  public static getEnvData(chainId: number) : IEnvData | undefined {
    const env = EnvSetup.getEnv();
    if (chainId === HARDHAT_NETWORK_ID) {
      return undefined;
    } else if (chainId === POLYGON_NETWORK_ID) {
      return {rpcUrl: env.maticRpcUrl, forkBlock: env.maticForkBlock};
    } else if (chainId === BASE_NETWORK_ID) {
      return {rpcUrl: env.baseRpcUrl, forkBlock: env.baseForkBlock};
    }
  }
}
