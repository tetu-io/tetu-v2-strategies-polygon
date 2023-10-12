/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {UniswapV3ConverterStrategy, UniswapV3ConverterStrategy__factory,} from "../../../../typechain";
import {Web3FunctionHardhat} from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import {Web3FunctionResultV2, Web3FunctionUserArgs} from "@gelatonetwork/web3-functions-sdk";
import { HardhatUtils, POLYGON_NETWORK_ID } from '../../../baseUT/utils/HardhatUtils';
import {InjectUtils} from "../../../baseUT/strategies/InjectUtils";
const { w3f } = hre;

// How to:
// npx hardhat run scripts/special/prepareTestEnvForUniswapV3RebalanceW3FEmpty.ts
// npx hardhat test test/strategies/polygon/uniswapv3/UniswapV3ConverterStrategyAggRebalanceW3FEmptyTest.ts --network localhost

describe('UniswapV3ConverterStrategyAggRebalanceW3FTest', function() {

  let signer: SignerWithAddress;
  let strategy: UniswapV3ConverterStrategy;

  let rebalanceW3f: Web3FunctionHardhat;
  let userArgs: Web3FunctionUserArgs;

  before(async function() {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    [signer] = await ethers.getSigners();

    strategy = UniswapV3ConverterStrategy__factory.connect('0x29ce0ca8d0A625Ebe1d0A2F94a2aC9Cc0f9948F1', signer)
    await InjectUtils.injectTetuConverter(signer);

    rebalanceW3f = w3f.get("uniswapv3-rebalance");
    userArgs = {
      strategy: strategy.address,
      agg: "", // 'openocean' | '1inch' | ''
      oneInchProtocols: "", // 'POLYGON_BALANCER_V2'
    };
  })

  describe('UniswapV3 strategy rebalance by Web3 Function tests', function() {
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
