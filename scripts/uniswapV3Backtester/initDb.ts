import {AppDataSource} from "./db/data-source";

AppDataSource.initialize()
  .then(() => {
    process.exit()
  })
  .catch((error) => console.log(error))
