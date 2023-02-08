import {ethers} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {utils} from "ethers";
import {Logger} from "tslog";
import logSettings from "../../log_settings";
import {formatUnits} from "ethers/lib/utils";
import {UniswapV3SimpleStrategy__factory} from "../../typechain";
// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");
const log: Logger = new Logger(logSettings);

async function main() {
  // WMATIC-USDC-0.05%
  const poolAddress = '0xA374094527e1673A86dE625aa59517c5dE346d32';
  const range = 500;
  const rebalanceRange = 50;

  const signer = (await ethers.getSigners())[0];
  log.info(`Signer ${signer.address}`)
  const name = 'UniswapV3SimpleStrategy'
  log.info(`Deploying ${name}`);

  log.info("Account balance: " + utils.formatUnits(await signer.getBalance(), 18));

  const gasPrice = await ethers.provider.getGasPrice();
  log.info("Gas price: " + formatUnits(gasPrice, 9));

  const _factory = (await ethers.getContractFactory(
    name,
    signer
  )) as UniswapV3SimpleStrategy__factory

  const instance = await _factory.deploy(poolAddress, range, rebalanceRange, {gasPrice: Math.floor(+gasPrice * 1.1)});
  log.info('Deploy tx:', instance.deployTransaction.hash);
  await instance.deployed();

  const receipt = await ethers.provider.getTransactionReceipt(instance.deployTransaction.hash);
  console.log('DEPLOYED: ', name, receipt.contractAddress);

  // 
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
