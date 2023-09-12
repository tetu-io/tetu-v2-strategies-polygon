import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Result } from '../entity/Result';
import { Task } from '../entity/Task';
import { EnvSetup } from '../../utils/EnvSetup';


const argv = EnvSetup.getEnv();

export const AppDataSource = new DataSource({
  type: 'postgres',
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
});
