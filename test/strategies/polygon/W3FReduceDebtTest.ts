/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
} from "../../../typechain";
import {Web3FunctionHardhat} from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import {Web3FunctionResultV2, Web3FunctionUserArgs} from "@gelatonetwork/web3-functions-sdk";
const { w3f } = hre;

// How to:

// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForUniswapV3ReduceDebtW3F.ts
// TEST_STRATEGY=<address> READER=<address> npx hardhat test test/strategies/polygon/W3FReduceDebtTest.ts --network localhost

// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForKyberReduceDebtW3F.ts
// TEST_STRATEGY=<address> READER=<address> npx hardhat test test/strategies/polygon/W3FReduceDebtTest.ts --network localhost

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    hardhatChainId: {
      type: 'number',
      default: 137,
    },
  }).argv;

describe('Strategy reduce debt by Web3 Function tests', function() {
  if (argv.hardhatChainId !== 137) {
    return;
  }

  let signer: SignerWithAddress;
  let strategy: UniswapV3ConverterStrategy;

  let rebalanceW3f: Web3FunctionHardhat;
  let userArgs: Web3FunctionUserArgs;

  before(async function() {
    [signer] = await ethers.getSigners();

    if (!process.env.TEST_STRATEGY) {
      console.error('Put strategy address to TEST_STRATEGY env variable')
      return
    }

    if (!process.env.READER) {
      console.error('Put reader address to READER env variable')
      return
    }

    strategy = UniswapV3ConverterStrategy__factory.connect(process.env.TEST_STRATEGY, signer)

    rebalanceW3f = w3f.get("reduce-debt");
    userArgs = {
      strategy: strategy.address,
      reader: process.env.READER,
      config: process.env.CONFIG,
      agg: "1inch", // 'openocean' | '1inch' | ''
      oneInchProtocols: "POLYGON_BALANCER_V2", // '' | 'POLYGON_BALANCER_V2'
    };
  })

  it('Run w3f', async() => {
    if (hre.network.name !== 'localhost') {
      console.log('This specific test can be run only on localhost network')
      return
    }

    let { result } = await rebalanceW3f.run({ userArgs });
    result = result as Web3FunctionResultV2;
    console.log('w3f result', result)

    expect(result.canExec).eq(true)

    console.log('Send reduce debt tx..')
    // tslint:disable-next-line:ban-ts-ignore
    // @ts-ignore
    await signer.sendTransaction({ to: result.callData[0].to, data: result.callData[0].data });
  })
})
