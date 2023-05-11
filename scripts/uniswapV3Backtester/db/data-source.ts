import "reflect-metadata"
import {DataSource} from "typeorm"
import {Result} from '../entity/Result'
import {Task} from "../entity/Task";
import {config as dotEnvConfig} from "dotenv";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('UNISWAP_V3_BACKTESTER_POLYGON')
  .options({
    dbHost: {
      type: "string",
    },
    dbPort: {
      type: "number",
    },
    dbUser: {
      type: "string",
    },
    dbPassword: {
      type: "string",
    },
    dbDatabase: {
      type: "string",
    },
  }).argv;

export const AppDataSource = new DataSource({
  type: "postgres",
  host: argv.dbHost,
  port: argv.dbPort,
  username: argv.dbUser,
  password: argv.dbPassword,
  database: argv.dbDatabase,
  synchronize: true,
  logging: false,
  entities: [Task, Result],
  ssl: {
    rejectUnauthorized: false,
  },
})