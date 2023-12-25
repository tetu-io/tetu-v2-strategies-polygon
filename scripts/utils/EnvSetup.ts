import { config as dotEnvConfig } from 'dotenv';

dotEnvConfig();

export class EnvSetup {

  // tslint:disable-next-line:no-any
  public static getEnv(): any {
    // tslint:disable-next-line:no-var-requires
    return require('yargs/yargs')()
      .env('TETU')
      .options({
        hardhatChainId: {
          type: 'number',
          default: 137,
        },
        privateKey: {
          type: 'string',
          default: '85bb5fa78d5c4ed1fde856e9d0d1fe19973d7a79ce9ed6c0358ee06a4550504e', // random account
        },
        hardhatLogsEnabled: {
          type: 'boolean',
          default: false,
        },
        localSolc: {
          type: 'boolean',
          default: false,
        },
        disableBacktesting: {
          type: 'boolean',
          default: true,
        },
        oneInchApiKey: {
          type: 'string',
          default: '',
        },

        /////// RPC

        maticRpcUrl: {
          type: 'string',
        },

        baseRpcUrl: {
          type: 'string',
        },

        zkevmRpcUrl: {
          type: 'string',
        },

        /////// BLOCKS

        maticForkBlock: {
          type: 'number',
          default: 51411258, // 50771769, // 50237305, // 49480727, // 48617049, // 48265751, // 46320827,
        },

        baseForkBlock: {
          type: 'number',
          default: 7496637, // 6917558, // 5939287,
        },

        zkevmForkBlock: {
          type: 'number',
          default: 8762027, // 8587141,
        },

        /////// NETWORK EXPLORERS

        networkScanKey: {
          type: 'string',
        },

        networkScanKeyBase: {
          type: 'string',
        },

        ////// TELEGRAM

        tgChatKey: {
          type: 'string',
        },
        tgChatId: {
          type: 'string',
          default: '-1001897996203',
        },

        ////// DB

        dbHost: {
          type: 'string',
        },
        dbPort: {
          type: 'number',
        },
        dbUser: {
          type: 'string',
        },
        dbPassword: {
          type: 'string',
        },
        dbDatabase: {
          type: 'string',
        },

        /////// REBALANCE

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
  }

}
