import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {
  IERC20__factory,
  StrategySplitterV2,
  TetuVaultV2,
  IERC20,
  IGauge,
  IController,
  StrategySplitterV2__factory,
  DystopiaConverterStrategy__factory,
  DystopiaConverterStrategy, IStrategyV2, IPair, DystopiaDepositor, IPair__factory, IRouter__factory, IRouter,
} from "../../../../typechain";
import { getConverterAddress, Misc } from '../../../../scripts/utils/Misc';
import {parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {BigNumber, constants} from "ethers";
import {ConverterUtils} from "../../ConverterUtils";
import * as fs from 'fs';
import * as csv from 'csv-stringify';

// const {expect} = chai;
chai.use(chaiAsPromised);

const balanceOf = TokenUtils.balanceOf;

describe("Dystopia Converter Strategy tests", function () {
  let snapshotBefore: string;
  let snapshot: string;
  let gov: SignerWithAddress;
  let signer: SignerWithAddress;
  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;
  let controller: IController;
  let asset: IERC20;
  let vaultToken1: IERC20;
  let vaultToken2: IERC20;
  let tetu: IERC20;
  let token0Decimals: number;
  let token1Decimals: number;
  let assetDecimals: number;
  let token2Decimals: number;
  let vault: TetuVaultV2;
  let splitter: StrategySplitterV2;
  let splitterAddress: string;
  // let converter: ITetuConverter;
  let strategy: DystopiaConverterStrategy;
  let gauge: IGauge;
  let insuranceAddress: string;
  let _1: BigNumber;
  let _1T: BigNumber;
  let _100_000: BigNumber;
  let _10_000_000: BigNumber;
  let _10_000_000T: BigNumber;
  let feeDenominator: BigNumber;
  // tslint:disable-next-line:no-any
  let initialBalances: any;
  let deposit: BigNumber;
  let pool: IPair;
  let router: IRouter;
  let stable: boolean;

  const BUFFER_RATE = 0; // 1_000; // n_%
  // const bufferDenominator = 100_000;
  const DEPOSIT_FEE = 100;
  const WITHDRAW_FEE = 100;
  const assetBalance = async (holder: string) => {
    return balanceOf(asset.address, holder);
  }

  const getBalances = async () => {
    const [reserves0, reserves1] = await pool.getReserves();

    return {
      depositFee: await vault.depositFee(),
      withdrawFee: await vault.withdrawFee(),
      deposit,
      reserves0, reserves1,
      reserves: reserves1.mul(10**(18-token1Decimals))
           .add(reserves0.mul(10**(18-token0Decimals))),
      price1: await pool.getAmountOut(_1, vaultToken1.address),
      price2: await pool.getAmountOut(_1T, vaultToken2.address),
      vault: await assetBalance(vault.address),
      insurance: await assetBalance(insuranceAddress),
      // splitter: await assetBalance(splitterAddress),
      strategy: await assetBalance(strategy.address),
      strategyT1: await balanceOf(vaultToken1.address, strategy.address),
      strategyT2: await balanceOf(vaultToken2.address, strategy.address),
      vaultTotal: await vault.totalAssets(),
      strategyTotal: await strategy.totalAssets(),
    }
  }

  const getDeviation = async () => {
    const balances = await getBalances();
    const result = {}
    for (const key of Object.keys(initialBalances))  {
      // tslint:disable-next-line:ban-ts-ignore
      // @ts-ignore
      if (initialBalances[key].eq(balances[key])) continue;
      // tslint:disable-next-line:ban-ts-ignore
      // @ts-ignore
      // result[key+'_delta'] = (balances[key]).sub(initialBalances[key]).toString();
      // tslint:disable-next-line:ban-ts-ignore
      // @ts-ignore
      result[key+'_rate'] = initialBalances[key].eq(0)
        ? '0'
        // tslint:disable-next-line:ban-ts-ignore
        // @ts-ignore
        : (balances[key].mul(100000).div(initialBalances[key]).toNumber() / 1000).toFixed(3);
    }
    return result
  }

  // tslint:disable-next-line:no-any
  const saveToFile = (filename:string, obj:any) => {
    csv.stringify(obj, {
      header: true,
    }, function(err, records){
      if (err) {
        console.warn('err', err);
      } else {
        fs.writeFileSync(filename, records);
      }
    })
  }


  before(async function () {
    [signer, signer1, signer2] = await ethers.getSigners()
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();

    const core = Addresses.getCore();
    controller =  DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    vaultToken1 = asset;
    vaultToken2 = IERC20__factory.connect(PolygonAddresses.DAI_TOKEN, signer);
    tetu = IERC20__factory.connect(PolygonAddresses.TETU_TOKEN, signer);

    assetDecimals = await TokenUtils.decimals(asset.address);
    token2Decimals = await TokenUtils.decimals(vaultToken2.address);
    _1 = parseUnits('1', assetDecimals);
    _1T = parseUnits('1', token2Decimals);
    _100_000 = parseUnits('100000', assetDecimals);
    _10_000_000 = parseUnits('10000000', assetDecimals);
    _10_000_000T = parseUnits('10000000', token2Decimals);

    const vaultName = 'tetu' + 'USDC';
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);
    const coreContracts = await DeployerUtilsLocal.getCoreAddressesWrapper(gov);
    gauge = coreContracts.gauge;

    const strategyDeployer = async (_splitterAddress: string) => {
      const _strategy = DystopiaConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'DystopiaConverterStrategy'), gov);

      await _strategy.init(
        core.controller,
        _splitterAddress,
        [PolygonAddresses.TETU_TOKEN],
        getConverterAddress(),
        vaultToken1.address,
        vaultToken2.address,
        true
      );

      return _strategy as unknown as IStrategyV2;
    }

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address, vaultName, strategyDeployer, controller, gov,
      BUFFER_RATE, DEPOSIT_FEE, WITHDRAW_FEE, false
    );
    vault = data.vault.connect(signer);
    strategy = data.strategy as unknown as DystopiaConverterStrategy;
    const poolAddress = await (strategy as DystopiaDepositor).depositorPair();
    pool = IPair__factory.connect(poolAddress, signer);
    token0Decimals = await TokenUtils.decimals(await pool.token0());
    token1Decimals = await TokenUtils.decimals(await pool.token1());
    const routerAddress = await (strategy as DystopiaDepositor).depositorRouter();
    router = IRouter__factory.connect(routerAddress, signer);
    stable = await (strategy as DystopiaDepositor).depositorStable();

    insuranceAddress = await vault.insurance();
    feeDenominator = await vault.FEE_DENOMINATOR();
    splitterAddress = await vault.splitter();
    splitter = StrategySplitterV2__factory.connect(splitterAddress, signer);

    // GET TOKENS & APPROVE

    await TokenUtils.getToken(asset.address, signer.address, _100_000)
    await TokenUtils.getToken(asset.address, signer1.address, _100_000)
    await TokenUtils.getToken(asset.address, signer2.address, _10_000_000)
    await TokenUtils.getToken(vaultToken2.address, signer2.address, _10_000_000T)

    await asset.connect(signer1).approve(vault.address, Misc.MAX_UINT);
    // await asset.connect(signer2).approve(vault.address, Misc.MAX_UINT);
    await vaultToken1.connect(signer2).approve(router.address, Misc.MAX_UINT);
    await vaultToken2.connect(signer2).approve(router.address, Misc.MAX_UINT);
    await asset.approve(vault.address, Misc.MAX_UINT);

    // Disable DForce at TetuConverter
    await ConverterUtils.disableDForce(asset.address, vaultToken2.address, signer);

    // INITIAL DEPOSIT

    console.log('Initial deposit...');
    deposit = _100_000;
    await vault.deposit(deposit, signer.address);
    // Make small deposits to decrease asset/borrowed vaultToken2 imbalance
    for (let i = 0; i < 3; i++) {
      console.log('getBalances()', await getBalances());
      await vault.connect(signer1).deposit(_1, signer1.address);
    }

    initialBalances = await getBalances();
    console.log('initialBalances', initialBalances);
    console.log('+Preparation Complete\n');

  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });

  ////////////////////// TESTS ///////////////////////

  describe("Total Assets Deviation", function () {

    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    const trade = async (tokenIn: string, amountIn: BigNumber, tokenOut: string) => {
      const router2 = router.connect(signer2);
      await router2.swapExactTokensForTokensSimple(
        amountIn, 1, tokenIn, tokenOut, stable, signer2.address, constants.MaxUint256);
    }

    // tslint:disable-next-line:no-any


    it("deviation cycle asset price down", async () => {
      const d = [];
      const amount = parseUnits('1000', assetDecimals);
      for (let i = 0; i < 25; i++) {
        await trade(vaultToken1.address, amount, vaultToken2.address);
        // await strategy._updateInvestedAssets();
        const deviation = await getDeviation();
        console.log('deviation', deviation);
        d.push(deviation);
        await saveToFile('tmp/1-down_step-1000-res.csv', d);
      }
    });

    it("deviation cycle asset price up", async () => {
      const d = [];
      const amount = parseUnits('1000', token2Decimals);
      for (let i = 0; i < 25; i++) {
        await trade(vaultToken2.address, amount, vaultToken1.address);
        // await strategy._updateInvestedAssets();
        const deviation = await getDeviation();
        console.log('deviation', deviation);
        d.push(deviation);
        await saveToFile('tmp/1-up_step-1000-res.csv', d);
      }
    });

  });


});
