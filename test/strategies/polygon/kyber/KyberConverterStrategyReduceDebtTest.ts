/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  IERC20,
  IERC20__factory, IStrategyV2,
  ISwapper,
  ISwapper__factory, KyberConverterStrategy, KyberConverterStrategy__factory, KyberLib, TetuVaultV2,
} from "../../../../typechain";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {UniversalUtils} from "../../../UniversalUtils";
import {KyberLiquidityUtils} from "./utils/KyberLiquidityUtils";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: 'boolean',
      default: false,
    },
    hardhatChainId: {
      type: 'number',
      default: 137,
    },
  }).argv;

describe('KyberConverterStrategy reduce debt by agg test', function() {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let swapper: ISwapper;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: KyberConverterStrategy;
  let lib: KyberLib;

  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();

    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: undefined,
          },
        },
      ],
    });

    [signer] = await ethers.getSigners();
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    const core = Addresses.getCore();
    const controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    const converterAddress = getConverterAddress();
    swapper = ISwapper__factory.connect(MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, signer);

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_Kyber_USDC_USDT',
      async(_splitterAddress: string) => {
        const _strategy = KyberConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'KyberConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          converterAddress,
          MaticAddresses.KYBER_USDC_USDT,
          0,
          0,
          true,
          21
        );

        return _strategy as unknown as IStrategyV2;
      },
      controller,
      gov,
      1_000,
      300,
      300,
      false,
    );
    strategy = data.strategy as KyberConverterStrategy
    vault = data.vault.connect(signer)

    await ConverterUtils.whitelist([strategy.address]);
    await vault.connect(gov).setWithdrawRequestBlocks(0)

    await ConverterUtils.disableAaveV2(signer)

    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
    await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, parseUnits('0.001', 6));

    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN, MaticAddresses.KNC_TOKEN,])
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)

    lib = await DeployerUtils.deployContract(signer, 'KyberLib') as KyberLib
  })

  after(async function() {
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
            blockNumber: parseInt(process.env.TETU_MATIC_FORK_BLOCK || '', 10) || undefined,
          },
        },
      ],
    });
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  it('Reduce debt after rebalanceNoSwaps', async() => {
    const s = strategy

    console.log('deposit...');
    await asset.approve(vault.address, Misc.MAX_UINT);
    await TokenUtils.getToken(asset.address, signer.address, parseUnits('1000', 6));
    await vault.deposit(parseUnits('1000', 6), signer.address);

    const state = await strategy.getState()
    for (let i = 0; i < 3; i++) {
      console.log(`Swap and rebalance. Step ${i}`)
      const amounts = await KyberLiquidityUtils.getLiquidityAmountsInCurrentTick(signer, lib, MaticAddresses.KYBER_USDC_USDT)

      const priceB = await lib.getPrice(MaticAddresses.KYBER_USDC_USDT, MaticAddresses.USDT_TOKEN)
      let swapAmount = amounts[1].mul(priceB).div(parseUnits('1', 6))
      swapAmount = swapAmount.add(swapAmount.div(100))

      await UniversalUtils.movePoolPriceUp(signer, state.pool, state.tokenA, state.tokenB, MaticAddresses.TETU_LIQUIDATOR_KYBER_SWAPPER, swapAmount);

      if (!(await strategy.needRebalance())) {
        console.log('Not need rebalance. Something wrong')
        process.exit(-1)
      }

      await strategy.rebalanceNoSwaps(true)
    }

    expect(await s.needRebalance()).eq(false)

    const planEntryData = defaultAbiCoder.encode(
      ["uint256"],
      [1]
    );
    const quote = await strategy.callStatic.quoteWithdrawByAgg(planEntryData);

    console.log('Quote', quote)

    const params = {
      fromTokenAddress: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
      toTokenAddress: quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
      amount: quote.amountToSwap.toString(),
      fromAddress: s.address,
      slippage: 1,
      disableEstimate: true,
      allowPartialFill: false,
      protocols: 'POLYGON_CURVE', // 'POLYGON_BALANCER_V2',
    };

    const swapTransaction = await buildTxForSwap(JSON.stringify(params));
    console.log('Transaction for swap: ', swapTransaction);

    await strategy.withdrawByAggStep(
      [quote.tokenToSwap, MaticAddresses.AGG_ONEINCH_V5],
      quote.amountToSwap,
      swapTransaction.data,
      planEntryData,
      1
    );

    expect(await s.needRebalance()).eq(false)
  })
})

function apiRequestUrl(methodName: string, queryParams: string) {
  const chainId = hre.network.config.chainId;
  const apiBaseUrl = 'https://api.1inch.io/v5.0/' + chainId;
  const r = (new URLSearchParams(JSON.parse(queryParams))).toString();
  return apiBaseUrl + methodName + '?' + r;
}

async function buildTxForSwap(params: string, tries: number = 2) {
  const url = apiRequestUrl('/swap', params);
  console.log('url', url)
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r && r.status === 200) {
        return (await r.json()).tx
      }
    } catch (e) {
      console.error('Err', e)
    }
  }
}