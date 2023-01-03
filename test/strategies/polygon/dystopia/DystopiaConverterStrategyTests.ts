import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre, { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  MockGauge,
  IERC20__factory,
  MockSplitter,
  ProxyControlled,
  StrategySplitterV2,
  TetuVaultV2,
  TetuVaultV2__factory,
  VaultInsurance,
  VaultInsurance__factory,
  IERC20,
  IGauge,
  IController,
  StrategySplitterV2__factory,
  DystopiaConverterStrategy__factory,
  DystopiaConverterStrategy, IStrategyV2, IRouter__factory, IPair__factory, ITetuLiquidator__factory,
} from '../../../../typechain';
import { getConverterAddress, Misc } from '../../../../scripts/utils/Misc';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { TokenUtils } from '../../../../scripts/utils/TokenUtils';
import { PolygonAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { BigNumber } from 'ethers';
import { ConverterUtils } from '../../ConverterUtils';
import { MaticAddresses } from '../../../../scripts/MaticAddresses';


const { expect } = chai;
chai.use(chaiAsPromised);

const balanceOf = TokenUtils.balanceOf;

describe('Dystopia Converter Strategy tests', function() {
  let snapshotBefore: string;
  let snapshot: string;
  let gov: SignerWithAddress;
  let signer: SignerWithAddress;
  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;
  let controller: IController;
  let asset: IERC20;
  let token1: IERC20;
  let token2: IERC20;
  let tetu: IERC20;
  let vault: TetuVaultV2;
  let splitter: StrategySplitterV2;
  let splitterAddress: string;
  // let converter: ITetuConverter;
  let strategy: DystopiaConverterStrategy;
  let gauge: IGauge;
  let insuranceAddress: string;
  let _1: BigNumber;
  let _100_000: BigNumber;
  let feeDenominator: BigNumber;
  const bufferRate = 1_000; // n_%
  // const bufferDenominator = 100_000;

  before(async function() {
    [signer, signer1, signer2] = await ethers.getSigners();
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();

    const core = Addresses.getCore();
    controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    token1 = asset;
    token2 = IERC20__factory.connect(PolygonAddresses.DAI_TOKEN, signer);
    tetu = IERC20__factory.connect(PolygonAddresses.TETU_TOKEN, signer);

    _1 = parseUnits('1', 6);
    _100_000 = parseUnits('100000', 6);

    const vaultName = 'tetu' + 'USDC';
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);
    const coreContracts = await DeployerUtilsLocal.getCoreAddressesWrapper(gov);
    gauge = coreContracts.gauge;

    const strategyDeployer = async(_splitterAddress: string) => {
      const _strategy = DystopiaConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'DystopiaConverterStrategy'), gov);

      await _strategy.init(
        core.controller,
        _splitterAddress,
        [PolygonAddresses.TETU_TOKEN],
        getConverterAddress(),
        token1.address,
        token2.address,
        true,
      );

      return _strategy as unknown as IStrategyV2;
    };

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address,
      vaultName,
      strategyDeployer,
      controller,
      gov,
      bufferRate,
      0,
      0,
      false,
    );
    vault = data.vault.connect(signer);
    strategy = data.strategy as unknown as DystopiaConverterStrategy;

    insuranceAddress = await vault.insurance();
    feeDenominator = await vault.FEE_DENOMINATOR();
    splitterAddress = await vault.splitter();
    splitter = StrategySplitterV2__factory.connect(splitterAddress, signer);

    // GET TOKENS & APPROVE

    await TokenUtils.getToken(asset.address, signer.address, _100_000);
    await TokenUtils.getToken(asset.address, signer1.address, _100_000);
    await TokenUtils.getToken(asset.address, signer2.address, _100_000);

    await asset.connect(signer1).approve(vault.address, Misc.MAX_UINT);
    await asset.connect(signer2).approve(vault.address, Misc.MAX_UINT);
    await asset.approve(vault.address, Misc.MAX_UINT);

    // Disable DForce at TetuConverter
    // await ConverterUtils.disableDForce(asset.address, token2.address, signer);

  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  ////////////////////// TESTS ///////////////////////
  describe("Invested Assets Calculation", function () {
    it("calc must be same as got by revert", async () => {
      await vault.deposit(_1, signer.address);
      const assetCalculated = await strategy.callStatic._calcInvestedAssets();
      console.log('assetCalculated', assetCalculated.toString());

      const assetsGet = await strategy.callStatic._getInvestedAssets();
      console.log('assetsGet      ', assetsGet.toString());

      expect(assetCalculated).eq(assetsGet);

    });
  });

  describe('Small Amounts', function() {
    it('fees check', async() => {
      expect(await vault.depositFee()).eq(0);
      expect(await vault.withdrawFee()).eq(0);
    });

    it('deposit / withdraw', async() => {
      console.log('deposit...');

      await strategy.setThreshold(asset.address, 100);

      const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);
      await vault.deposit('1', signer.address);

      const lpBalance = await TokenUtils.balanceOf(vault.address, signer.address);
      console.log('lpBalance', lpBalance.toString());
      expect(lpBalance).eq(1);

      await vault.connect(signer1).deposit('1', signer1.address);
      await vault.connect(signer2).deposit('2', signer2.address);
      await vault.connect(signer1).deposit('3', signer1.address);
      await vault.connect(signer2).deposit('4', signer2.address);

      console.log('withdrawAll...');
      await vault.connect(signer1).withdraw('1', signer1.address, signer1.address);
      await vault.connect(signer2).withdraw('2', signer2.address, signer2.address);
      await vault.connect(signer1).withdrawAll();
      await vault.connect(signer2).withdrawAll();
      await vault.withdrawAll();

      const balanceAfter = await TokenUtils.balanceOf(asset.address, signer.address);
      expect(balanceBefore).eq(balanceAfter);

    });

  });

  describe('Big Amounts', function() {
    const DEPOSIT_FEE = 300; // 1_000;
    const WITHDRAW_FEE = 300; // 1_000;
    const BIG_AMOUNT = parseUnits('100000', 6);

    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
      await vault.connect(gov).setFees(DEPOSIT_FEE, WITHDRAW_FEE);
      await TokenUtils.getToken(asset.address, signer.address, BIG_AMOUNT);
      expect(await vault.depositFee()).eq(DEPOSIT_FEE);
      expect(await vault.withdrawFee()).eq(WITHDRAW_FEE);
    });

    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    it('deposit / withdraw multiple', async() => {
      console.log('deposit...');
      await depositToVaultAndCheck(signer, vault, BIG_AMOUNT, strategy);
      const leftover = await TokenUtils.balanceOf(asset.address, signer.address);

      await depositToVaultAndCheck(signer1, vault, _100_000, strategy);
      await depositToVaultAndCheck(signer2, vault, _100_000, strategy);

      console.log('withdrawAll...');

      await withdrawAllVaultAndCheck(signer1, vault, strategy);
      await withdrawAllVaultAndCheck(signer2, vault, strategy);
      await withdrawAllVaultAndCheck(signer, vault, strategy);

      const balanceAfter = +formatUnits((await TokenUtils.balanceOf(asset.address, signer.address)).sub(leftover), 6);
      const depositedWithFee = BIG_AMOUNT.mul(feeDenominator.sub(DEPOSIT_FEE)).div(feeDenominator);
      const withdrawnWithFee = depositedWithFee.mul(feeDenominator.sub(WITHDRAW_FEE)).div(feeDenominator);
      const expectedBalance = +formatUnits(withdrawnWithFee, 6);

      expect(balanceAfter).approximately(expectedBalance, 0.1);
    });

    it('deposit / withdraw simple', async() => {
      // await setLiquidatorPath(strategy);

      // keep something inside for properly check
      await depositToVaultAndCheck(signer1, vault, BigNumber.from(1), strategy);

      const amount = parseUnits('10000', 6);
      await depositToVaultAndCheck(signer, vault, amount, strategy);
      const leftover = await TokenUtils.balanceOf(asset.address, signer.address);

      await withdrawAllVaultAndCheck(signer, vault, strategy);

      const balanceAfter = formatUnits((await TokenUtils.balanceOf(asset.address, signer.address)).sub(leftover), 6);
      const depositedWithFee = amount.mul(feeDenominator.sub(DEPOSIT_FEE)).div(feeDenominator);
      const withdrawnWithFee = depositedWithFee.mul(feeDenominator.sub(WITHDRAW_FEE)).div(feeDenominator);
      const expectedBalance = formatUnits(withdrawnWithFee, 6);

      expect(balanceAfter).eq(expectedBalance);
    });

  });

  describe('Profit distribution', function() {
    const DEPOSIT_FEE = 300; // 1_000;
    const WITHDRAW_FEE = 300; // 1_000;

    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
      await vault.connect(gov).setFees(DEPOSIT_FEE, WITHDRAW_FEE);
      // await TokenUtils.getToken(asset.address, signer.address, BIG_AMOUNT);
      expect(await vault.depositFee()).eq(DEPOSIT_FEE);
      expect(await vault.withdrawFee()).eq(WITHDRAW_FEE);
    });

    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

<<<<<<< HEAD
    it('deposit / withdraw', async() => {
      console.log('deposit...');

      const vault1 = await vault.connect(signer1);
      const vault2 = await vault.connect(signer2);

      await vault1.deposit(_100_000, signer1.address);
      await vault2.deposit(_100_000, signer2.address);

      console.log('withdrawAll...');

      await vault1.withdrawAll();
      await vault2.withdrawAll();

=======
    it("Profit distribution", async () => {
      // TODO
>>>>>>> slava

    });

  });


  describe('Tokens Movement', function() {
    const DEPOSIT_FEE = 300;
    const WITHDRAW_FEE = 300;

    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
      console.log('setFees...');
      await vault.connect(gov).setFees(DEPOSIT_FEE, WITHDRAW_FEE);
      expect(await vault.depositFee()).eq(DEPOSIT_FEE);
      expect(await vault.withdrawFee()).eq(WITHDRAW_FEE);
    });

    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

<<<<<<< HEAD
    it('deposit', async() => {
      console.log('deposit...');
=======
    it("deposit", async () => {
      /*console.log('deposit...');
>>>>>>> slava
      const deposit = _100_000;
      await vault.deposit(deposit, signer.address);

      const depositFee = deposit.mul(DEPOSIT_FEE).div(feeDenominator);
      expect((await balanceOf(asset.address, insuranceAddress)).toNumber()).approximately(depositFee.toNumber(), 10);
      // const depositWithFee = deposit.sub(depositFee);
      // const buffer = depositWithFee.mul(bufferRate).div(bufferDenominator);
      // expect(await balanceOf(asset.address, vault.address)).eq(buffer);
      expect(await balanceOf(asset.address, splitter.address)).eq(0);
      // expect(await balanceOf(asset.address, strategy.address)).eq(0);

      console.log('withdrawAll...');
      hre.tracer.enabled = true;
      await vault.withdrawAll();
*/
    });

  });
<<<<<<< HEAD
=======


>>>>>>> slava
});


async function depositToVaultAndCheck(
  signer: SignerWithAddress,
  vault: TetuVaultV2,
  amount: BigNumber,
  strategy: DystopiaConverterStrategy,
  movePriceBefore = false,
) {

  const pairAdr = await IRouter__factory.connect(MaticAddresses.DYSTOPIA_ROUTER, signer)
    .pairFor(PolygonAddresses.USDC_TOKEN, PolygonAddresses.DAI_TOKEN, true);
  const pair = IPair__factory.connect(pairAdr, signer);

  const daiOutBefore = +formatUnits(await pair.getAmountOut(parseUnits('1', 6), PolygonAddresses.USDC_TOKEN));

  if (movePriceBefore) {
    await swap(signer, PolygonAddresses.USDC_TOKEN, PolygonAddresses.DAI_TOKEN, parseUnits('10000', 6));
  }

  const sharePriceBefore = await vault.sharePrice();

  await vault.connect(signer).deposit(amount, signer.address);

  const sharePriceAfter = await vault.sharePrice();
  const daiOutAfter = +formatUnits(await pair.getAmountOut(parseUnits('1', 6), PolygonAddresses.USDC_TOKEN));

  console.log(`>>> /// DEPOSIT sharePrice before ${formatUnits(
    sharePriceBefore,
    6,
  )} after ${formatUnits(sharePriceAfter, 6)}`);

  console.log(`>>> /// DEPOSIT price before ${daiOutBefore} after ${daiOutAfter} diff: ${((daiOutAfter - daiOutBefore) /
    daiOutAfter).toFixed(6)}%`);
}

async function withdrawAllVaultAndCheck(
  signer: SignerWithAddress,
  vault: TetuVaultV2,
  strategy: DystopiaConverterStrategy,
  movePriceBefore = false,
) {

  const pairAdr = await IRouter__factory.connect(MaticAddresses.DYSTOPIA_ROUTER, signer)
    .pairFor(PolygonAddresses.USDC_TOKEN, PolygonAddresses.DAI_TOKEN, true);
  const pair = IPair__factory.connect(pairAdr, signer);

  const daiOutBefore = +formatUnits(await pair.getAmountOut(parseUnits('1', 6), PolygonAddresses.USDC_TOKEN));

  if (movePriceBefore) {
    await swap(signer, PolygonAddresses.DAI_TOKEN, PolygonAddresses.USDC_TOKEN, parseUnits('1000'));
  }


  const sharePriceBefore = await vault.sharePrice();

  await vault.connect(signer).withdrawAll();

  const sharePriceAfter = await vault.sharePrice();
  const totalAssets = formatUnits(await vault.totalAssets(), 6);
  const totalSupply = formatUnits(await vault.totalSupply(), 6);
  const daiOutAfter = +formatUnits(await pair.getAmountOut(parseUnits('1', 6), PolygonAddresses.USDC_TOKEN));


  console.log(`>>> /// WITHDRAW sharePrice before ${formatUnits(sharePriceBefore, 6)} after ${formatUnits(
    sharePriceAfter,
    6,
  )}`);
  console.log(`>>> /// WITHDRAW price before ${daiOutBefore} after ${daiOutAfter} diff: ${((daiOutAfter -
    daiOutBefore) / daiOutAfter).toFixed(6)}%`);
  console.log(`>>> /// WITHDRAW totalAssets ${totalAssets} totalSupply ${totalSupply}`);
}

async function swap(signer: SignerWithAddress, tokenIn: string, tokenOut: string, amount: BigNumber) {
  await TokenUtils.getToken(tokenIn, signer.address, amount.mul(2));
  await IERC20__factory.connect(tokenIn, signer)
    .approve(MaticAddresses.DYSTOPIA_ROUTER, Misc.MAX_UINT);
  await IRouter__factory.connect(MaticAddresses.DYSTOPIA_ROUTER, signer).swapExactTokensForTokensSimple(
    amount,
    0,
    tokenIn,
    tokenOut,
    true,
    signer.address,
    (Date.now() / 1000 + 100000).toFixed(0),
  );

  // await IERC20__factory.connect(tokenIn, signer)
  //   .approve(MaticAddresses.TETU_LIQUIDATOR, Misc.MAX_UINT);
  // await ITetuLiquidator__factory.connect(MaticAddresses.TETU_LIQUIDATOR, signer).liquidate(tokenIn, tokenOut, amount, 100_000)
}

async function setLiquidatorPath(strategy: DystopiaConverterStrategy) {
  const signer = await Misc.impersonate('0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94');
  const DYSTOPIA_SWAPPER = '0x867F88209074f4B7300e7593Cd50C05B2c02Ad01';
  const pair = await strategy.depositorPair();

  await ITetuLiquidator__factory.connect(MaticAddresses.TETU_LIQUIDATOR, signer).addLargestPools([
    {
      pool: pair,
      swapper: DYSTOPIA_SWAPPER,
      tokenIn: MaticAddresses.DAI_TOKEN,
      tokenOut: MaticAddresses.USDC_TOKEN,
    },
  ], true);

  await ITetuLiquidator__factory.connect(MaticAddresses.TETU_LIQUIDATOR, signer).addLargestPools([
    {
      pool: pair,
      swapper: DYSTOPIA_SWAPPER,
      tokenIn: MaticAddresses.USDC_TOKEN,
      tokenOut: MaticAddresses.DAI_TOKEN,
    },
  ], true);
}
