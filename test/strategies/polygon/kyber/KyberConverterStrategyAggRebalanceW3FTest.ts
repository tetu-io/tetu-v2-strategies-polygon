/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {
  KyberConverterStrategy, KyberConverterStrategy__factory,
} from "../../../../typechain";
import {Web3FunctionHardhat} from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import {Web3FunctionResultV2, Web3FunctionUserArgs} from "@gelatonetwork/web3-functions-sdk";
const { w3f } = hre;

// How to:
// npx hardhat run scripts/special/prepareTestEnvForKyberRebalanceW3F.ts
// TEST_STRATEGY=<enter_deployed_strategy_address> npx hardhat test test/strategies/polygon/kyber/KyberConverterStrategyAggRebalanceW3FTest.ts --network localhost

// npx hardhat run scripts/special/prepareTestEnvForKyberRebalanceW3FUnstake.ts
// TEST_STRATEGY=<enter_deployed_strategy_address> npx hardhat test test/strategies/polygon/kyber/KyberConverterStrategyAggRebalanceW3FTest.ts --network localhost

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

describe('KyberConverterStrategyAggRebalanceW3FTest', function() {
  if (argv.hardhatChainId !== 137) {
    return;
  }

  let signer: SignerWithAddress;
  let strategy: KyberConverterStrategy;

  let rebalanceW3f: Web3FunctionHardhat;
  let userArgs: Web3FunctionUserArgs;

  before(async function() {
    [signer] = await ethers.getSigners();
    if (!process.env.TEST_STRATEGY) {
      console.error('Put strategy address to TEST_STRATEGY env variable')
      return
    }

    strategy = KyberConverterStrategy__factory.connect(process.env.TEST_STRATEGY, signer)

    rebalanceW3f = w3f.get("kyber-rebalance");
    userArgs = {
      strategy: strategy.address,
      agg: "", // 'openocean' | '1inch' | ''
      oneInchProtocols: "", // 'POLYGON_BALANCER_V2'
    };
  })

  describe('Kyber strategy rebalance by Web3 Function tests', function() {
    it('Rebalance', async() => {
      if (hre.network.name !== 'localhost') {
        console.log('This specific test can be run only on localhost network')
        return
      }

      const s = strategy

      expect(await s.needRebalance()).eq(true)

      let { result } = await rebalanceW3f.run({ userArgs });
      result = result as Web3FunctionResultV2;
      console.log('w3f result', result)

      expect(result.canExec).eq(true)

      console.log('Send rebalance tx..')
      // tslint:disable-next-line:ban-ts-ignore
      // @ts-ignore
      await signer.sendTransaction({ to: result.callData[0].to, data: result.callData[0].data });

      expect(await s.needRebalance()).eq(false)
    })
  })
})
