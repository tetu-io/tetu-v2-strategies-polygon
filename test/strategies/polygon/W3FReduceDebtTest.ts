/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {
  PairBasedStrategyReader__factory, RebalanceDebtConfig__factory,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
} from "../../../typechain";
import {Web3FunctionHardhat} from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import {Web3FunctionResultV2, Web3FunctionUserArgs} from "@gelatonetwork/web3-functions-sdk";
import {BigNumber} from "ethers";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
const { w3f } = hre;

// How to:

// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForUniswapV3ReduceDebtW3F.ts
// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForUniswapV3ReduceDebtOnFuseW3F.ts
// TEST_STRATEGY=<address> READER=<address> CONFIG=<address> npx hardhat test test/strategies/polygon/W3FReduceDebtTest.ts --network localhost

// NODE_OPTIONS=--max_old_space_size=4096 hardhat run scripts/special/prepareTestEnvForKyberReduceDebtW3F.ts
// TEST_STRATEGY=<address> READER=<address> CONFIG=<address> npx hardhat test test/strategies/polygon/W3FReduceDebtTest.ts --network localhost

describe('Strategy reduce debt by Web3 Function tests', function() {
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

    let defaultState = await strategy.getDefaultState()
    const isFuseTriggered =
      defaultState[2][1].toString() === '2'
      || defaultState[2][1].toString() === '3'
      || defaultState[2][2].toString() === '2'
      || defaultState[2][2].toString() === '3'

    const reader = PairBasedStrategyReader__factory.connect(process.env.READER, signer)

    const config = await RebalanceDebtConfig__factory.connect(process.env.CONFIG, signer).strategyConfig(strategy.address)
    console.log("Config", config)

    for (let i = 0; i < 10; i++) {
      const r = await reader.getLockedUnderlyingAmount(strategy.address) as [BigNumber, BigNumber]
      expect(r[1]).gt(0)
      const percent = r[0].mul(100).div(r[1]).toNumber()

      console.log("Locked percent", percent)
      console.log('isFuseTriggered', isFuseTriggered)
      const balanceUSDC = await TokenUtils.balanceOf(MaticAddresses.USDC_TOKEN, strategy.address)
      const balanceUSDT = await TokenUtils.balanceOf(MaticAddresses.USDT_TOKEN, strategy.address)
      console.log('strategy balanceUSDC', balanceUSDC)
      console.log('strategy balanceUSDT', balanceUSDT)

      let { result } = await rebalanceW3f.run({ userArgs });
      result = result as Web3FunctionResultV2;
      console.log('w3f result', result)

      if (!isFuseTriggered && percent < config.lockedPercentForDelayedRebalance.toNumber()) {
        expect(result.message).eq(`Not need to reduce debt. Current locked: ${percent}%. Max allowed locked: ${config.lockedPercentForDelayedRebalance.toNumber()}%`)

        break
      }

      defaultState = await strategy.getDefaultState()
      if (isFuseTriggered && percent === 0 && defaultState[2][3].toString() === '1') {
        expect(result.message).eq('Not need to reduce debt. Fuse triggered. Withdraw done. Current locked: 0%.')
        console.log('balanceUSDT', balanceUSDT.toString())
        expect(balanceUSDT).lt(parseUnits('1', 6))
        break
      }

      expect(result.canExec).eq(true)

      console.log('Send reduce debt tx..')
      // tslint:disable-next-line:ban-ts-ignore
      // @ts-ignore
      await signer.sendTransaction({ to: result.callData[0].to, data: result.callData[0].data, gasLimit: 19_000_000 });
    }
  })
})
