/* tslint:disable:no-trailing-whitespace */
import {expect} from 'chai';
import {config as dotEnvConfig} from "dotenv";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {
  AlgebraConverterStrategy,
  AlgebraConverterStrategy__factory,
  IERC20,
  IERC20__factory, IStrategyV2,
  TetuVaultV2,
} from "../../../../typechain";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {UniswapV3StrategyUtils} from "../../../UniswapV3StrategyUtils";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";

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

describe('AlgebraConverterStrategyAggRebalanceTest', function() {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let asset: IERC20;
  let vault: TetuVaultV2;
  let strategy: AlgebraConverterStrategy;

  before(async function() {
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

    snapshotBefore = await TimeUtils.snapshot();

    [signer] = await ethers.getSigners();
    const gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    const core = Addresses.getCore();
    const controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    const converterAddress = getConverterAddress();

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      'TetuV2_Algebra_USDC_USDT',
      async(_splitterAddress: string) => {
        const _strategy = AlgebraConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'AlgebraConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          converterAddress,
          MaticAddresses.ALGEBRA_USDC_USDT,
          0,
          0,
          true,
          {
            rewardToken: MaticAddresses.dQUICK_TOKEN,
            bonusRewardToken: MaticAddresses.WMATIC_TOKEN,
            pool: MaticAddresses.ALGEBRA_USDC_USDT,
            startTime: 1663631794,
            endTime: 4104559500
          }
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
    strategy = data.strategy as AlgebraConverterStrategy
    vault = data.vault.connect(signer)

    await ConverterUtils.whitelist([strategy.address]);
    await vault.connect(gov).setWithdrawRequestBlocks(0)

    await ConverterUtils.disableAaveV2(signer)

    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer);
    await strategy.connect(operator).setLiquidationThreshold(MaticAddresses.USDT_TOKEN, parseUnits('0.001', 6));

    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN])
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address)
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
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
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  describe('Algebra strategy rebalance by agg tests', function() {
    it('Rebalance', async() => {
      const s = strategy
      const state = await s.getState()

      console.log('deposit...');
      await asset.approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, signer.address, parseUnits('1000', 6));
      await vault.deposit(parseUnits('1000', 6), signer.address);

      await UniswapV3StrategyUtils.movePriceDown(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('1400000', 6), 100001);

      expect(await s.needRebalance()).eq(true)

      const quote = await s.callStatic.quoteRebalanceSwap()
      console.log('Quote', quote)

      const params = {
        fromTokenAddress: quote[0] ? state.tokenA : state.tokenB,
        toTokenAddress: quote[0] ? state.tokenB : state.tokenA,
        amount: quote[1].toString(),
        fromAddress: s.address,
        slippage: 1,
        disableEstimate: true,
        allowPartialFill: false,
        protocols: 'POLYGON_BALANCER_V2',
      };

      const swapTransaction = await buildTxForSwap(JSON.stringify(params));
      console.log('Transaction for swap: ', swapTransaction);

      await s.rebalanceSwapByAgg(quote[0], quote[1], MaticAddresses.AGG_ONEINCH_V5, swapTransaction.data)

      expect(await s.needRebalance()).eq(false)
    })

    it('Rebalance empty strategy', async() => {
      const s = strategy

      await UniswapV3StrategyUtils.movePriceDown(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, parseUnits('1400000', 6), 100001);

      expect(await s.needRebalance()).eq(true)

      const quote = await s.callStatic.quoteRebalanceSwap()
      console.log('Quote', quote)

      expect(quote[1]).eq(0)

      await s.rebalanceSwapByAgg(quote[0], 0, MaticAddresses.AGG_ONEINCH_V5, '0x')

      expect(await s.needRebalance()).eq(false)
    })

    it('Rebalance empty strategy after emergencyExit()', async() => {
      const s = strategy

      const swapAssetValue = parseUnits('1400000', 6);

      console.log('deposit...');
      await asset.approve(vault.address, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, signer.address, parseUnits('1000', 6));
      await vault.deposit(parseUnits('1000', 6), signer.address);

      await UniswapV3StrategyUtils.makeVolume(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, swapAssetValue);

      console.log('emergency exit');
      const operator = await UniversalTestUtils.getAnOperator(s.address, signer)
      await s.connect(operator).emergencyExit()

      await UniswapV3StrategyUtils.movePriceUp(signer, s.address, MaticAddresses.TETU_LIQUIDATOR_ALGEBRA_SWAPPER, swapAssetValue);

      expect(await s.needRebalance()).eq(true)

      const quote = await s.callStatic.quoteRebalanceSwap()
      console.log('Quote', quote)

      expect(quote[1]).eq(0)

      await s.rebalanceSwapByAgg(quote[0], 0, MaticAddresses.AGG_ONEINCH_V5, '0x')

      expect(await s.needRebalance()).eq(false)
    })
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