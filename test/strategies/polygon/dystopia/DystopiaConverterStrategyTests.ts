import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import hre, {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
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
  DystopiaConverterStrategy, IStrategyV2,
} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {BigNumber} from "ethers";
import {ConverterUtils} from "../../ConverterUtils";


const {expect} = chai;
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

  before(async function () {
    [signer, signer1, signer2] = await ethers.getSigners()
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();

    const core = Addresses.getCore();
    const tools = Addresses.getTools();
    controller =  DeployerUtilsLocal.getController(signer);
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

    const strategyDeployer = async (_splitterAddress: string) => {
      const _strategy = DystopiaConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'DystopiaConverterStrategy'), gov);

      await _strategy.init(
        core.controller,
        _splitterAddress,
        [PolygonAddresses.TETU_TOKEN],
        tools.converter,
        token1.address,
        token2.address,
        true
      );

      return _strategy as unknown as IStrategyV2;
    }

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address, vaultName, strategyDeployer, controller, gov,
      bufferRate, 0, 0, false
    );
    vault = data.vault.connect(signer);
    strategy = data.strategy as unknown as DystopiaConverterStrategy;

    insuranceAddress = await vault.insurance();
    feeDenominator = await vault.FEE_DENOMINATOR();
    splitterAddress = await vault.splitter();
    splitter = StrategySplitterV2__factory.connect(splitterAddress, signer);

    // GET TOKENS & APPROVE

    await TokenUtils.getToken(asset.address, signer.address, _100_000)
    await TokenUtils.getToken(asset.address, signer1.address, _100_000)
    await TokenUtils.getToken(asset.address, signer2.address, _100_000)

    await asset.connect(signer1).approve(vault.address, Misc.MAX_UINT);
    await asset.connect(signer2).approve(vault.address, Misc.MAX_UINT);
    await asset.approve(vault.address, Misc.MAX_UINT);

    // Disable DForce at TetuConverter
    await ConverterUtils.disableDForce(asset.address, token2.address, signer);

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

  describe("Small Amounts", function () {
    it("fees check", async () => {
      expect(await vault.depositFee()).eq(0);
      expect(await vault.withdrawFee()).eq(0);
    });

    it("deposit / withdraw", async () => {
      console.log('deposit...');
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

  describe("Big Amounts", function () {
    const DEPOSIT_FEE = 300; // 1_000;
    const WITHDRAW_FEE = 300; // 1_000;
    const BIG_AMOUNT = parseUnits('30000000', 6);

    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
      await vault.connect(gov).setFees(DEPOSIT_FEE, WITHDRAW_FEE);
      await TokenUtils.getToken(asset.address, signer.address, BIG_AMOUNT);
      expect(await vault.depositFee()).eq(DEPOSIT_FEE);
      expect(await vault.withdrawFee()).eq(WITHDRAW_FEE); });

    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    it("deposit / withdraw", async () => {
      console.log('deposit...');
      await vault.deposit(BIG_AMOUNT, signer.address);
      const leftover = await TokenUtils.balanceOf(asset.address, signer.address);

      await vault.connect(signer1).deposit(_100_000, signer1.address);
      await vault.connect(signer2).deposit(_100_000, signer2.address);

      console.log('withdrawAll...');

      await vault.connect(signer1).withdrawAll();
      await vault.connect(signer2).withdrawAll();

      await vault.withdrawAll();

      const balanceAfter = await TokenUtils.balanceOf(asset.address, signer.address);
      const depositedWithFee = BIG_AMOUNT.mul(feeDenominator.sub(DEPOSIT_FEE)).div(feeDenominator);
      const withdrawnWithFee = depositedWithFee.mul(feeDenominator.sub(WITHDRAW_FEE)).div(feeDenominator);

      expect(balanceAfter).eq(withdrawnWithFee.add(leftover));
    });

  });

  describe("Profit distribution", function () {
    const DEPOSIT_FEE = 300; // 1_000;
    const WITHDRAW_FEE = 300; // 1_000;

    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
      await vault.connect(gov).setFees(DEPOSIT_FEE, WITHDRAW_FEE);
      // await TokenUtils.getToken(asset.address, signer.address, BIG_AMOUNT);
      expect(await vault.depositFee()).eq(DEPOSIT_FEE);
      expect(await vault.withdrawFee()).eq(WITHDRAW_FEE); });

    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    it("deposit / withdraw", async () => {
      console.log('deposit...');

      const vault1 = await vault.connect(signer1);
      const vault2 = await vault.connect(signer2);

      await vault1.deposit(_100_000, signer1.address);
      await vault2.deposit(_100_000, signer2.address);

      console.log('withdrawAll...');

      await vault1.withdrawAll();
      await vault2.withdrawAll();



    });

  });


  describe("Tokens Movement", function () {
    const DEPOSIT_FEE = 300;
    const WITHDRAW_FEE = 300;

    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
      console.log('setFees...');
      await vault.connect(gov).setFees(DEPOSIT_FEE, WITHDRAW_FEE);
      expect(await vault.depositFee()).eq(DEPOSIT_FEE);
      expect(await vault.withdrawFee()).eq(WITHDRAW_FEE);});

    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    it("deposit", async () => {
      console.log('deposit...');
      const deposit = _100_000;
      await vault.deposit(deposit, signer.address);

      const depositFee = deposit.mul(DEPOSIT_FEE).div(feeDenominator);
      expect(await balanceOf(asset.address, insuranceAddress)).eq(depositFee);
      // const depositWithFee = deposit.sub(depositFee);
      // const buffer = depositWithFee.mul(bufferRate).div(bufferDenominator);
      // expect(await balanceOf(asset.address, vault.address)).eq(buffer);
      expect(await balanceOf(asset.address, splitter.address)).eq(0);
      // expect(await balanceOf(asset.address, strategy.address)).eq(0);

      console.log('withdrawAll...');
      hre.tracer.enabled = true;
      await vault.withdrawAll();

    });

  });

  // TODO remove .skip , update tests
  describe.skip("Base Vault tests", function () {

    it("decimals test", async () => {
      expect(await vault.decimals()).eq(6);
    });

    it("deposit revert on zero test", async () => {
      await expect(vault.deposit(0, signer.address)).revertedWith('ZERO_SHARES');
    });

    it("previewDeposit test", async () => {
      expect(await vault.previewDeposit(100)).eq(100);
    });

    it("previewMint test", async () => {
      expect(await vault.previewMint(100)).eq(100);
    });

    it("previewWithdraw test", async () => {
      expect(await vault.previewWithdraw(10000)).eq(10000);
    });

    it("previewRedeem test", async () => {
      expect(await vault.previewRedeem(100)).eq(100);
    });

    it("maxDeposit test", async () => {
      expect(await vault.maxDeposit(signer.address)).eq(Misc.MAX_UINT_MINUS_ONE);
    });

    it("maxMint test", async () => {
      expect(await vault.maxMint(signer.address)).eq(Misc.MAX_UINT_MINUS_ONE);
    });

    it("maxWithdraw test", async () => {
      expect(await vault.maxWithdraw(signer.address)).eq(0);
    });

    it("maxRedeem test", async () => {
      expect(await vault.maxRedeem(signer.address)).eq(0);
    });

    it("max withdraw revert", async () => {
      await expect(vault.withdraw(Misc.MAX_UINT, signer.address, signer.address)).revertedWith('MAX')
    });

    it("withdraw not owner revert", async () => {
      await expect(vault.withdraw(100, signer.address, signer1.address)).revertedWith('')
    });

    it("withdraw not owner test", async () => {
      await vault.deposit(parseUnits('1', 6), signer.address);
      await vault.approve(signer1.address, parseUnits('1', 6));
      await vault.connect(signer1).withdraw(parseUnits('0.1', 6), signer1.address, signer.address);
    });

    it("withdraw not owner with max approve test", async () => {
      await vault.deposit(parseUnits('1', 6), signer.address);
      await vault.approve(signer1.address, Misc.MAX_UINT);
      await vault.connect(signer1).withdraw(parseUnits('0.1', 6), signer1.address, signer.address);
    });

    it("max redeem revert", async () => {
      await expect(vault.redeem(Misc.MAX_UINT, signer.address, signer.address)).revertedWith('MAX')
    });

    it("redeem not owner revert", async () => {
      await expect(vault.redeem(100, signer.address, signer1.address)).revertedWith('')
    });

    it("redeem not owner test", async () => {
      await vault.deposit(parseUnits('1', 6), signer.address);
      await vault.approve(signer1.address, parseUnits('1', 6));
      await vault.connect(signer1).redeem(parseUnits('0.1', 6), signer1.address, signer.address);
    });

    it("redeem not owner with max approve test", async () => {
      await vault.deposit(parseUnits('1', 6), signer.address);
      await vault.approve(signer1.address, Misc.MAX_UINT);
      await vault.connect(signer1).redeem(parseUnits('0.1', 6), signer1.address, signer.address);
    });

    it("redeem zero revert", async () => {
      await vault.deposit(parseUnits('1', 6), signer.address);
      await expect(vault.redeem(0, signer.address, signer.address)).revertedWith('ZERO_ASSETS')
    });

    it("deposit with fee test", async () => {
      await vault.connect(gov).setFees(1_000, 1_000);

      const bal1 = await asset.balanceOf(signer.address);
      await vault.deposit(parseUnits('1', 6), signer1.address);
      expect(await vault.balanceOf(signer1.address)).eq(990_000);
      expect(bal1.sub(await asset.balanceOf(signer.address))).eq(parseUnits('1', 6));

      const bal2 = await asset.balanceOf(signer.address);
      await vault.deposit(parseUnits('1', 6), signer.address);
      expect(await vault.balanceOf(signer.address)).eq(990_000);
      expect(bal2.sub(await asset.balanceOf(signer.address))).eq(parseUnits('1', 6));

      const insurance = await vault.insurance();
      expect(await asset.balanceOf(insurance)).eq(20_000);
      expect(await vault.sharePrice()).eq(parseUnits('1', 6))
    });

    it("mint with fee test", async () => {
      await vault.connect(gov).setFees(1_000, 1_000);

      const bal1 = await asset.balanceOf(signer.address);
      await vault.mint(990_000, signer1.address);
      expect(await vault.balanceOf(signer1.address)).eq(990_000);
      expect(bal1.sub(await asset.balanceOf(signer.address))).eq(parseUnits('1', 6));

      const bal2 = await asset.balanceOf(signer.address);
      await vault.mint(990_000, signer.address);
      expect(await vault.balanceOf(signer.address)).eq(990_000);
      expect(bal2.sub(await asset.balanceOf(signer.address))).eq(parseUnits('1', 6));

      const insurance = await vault.insurance();
      expect(await asset.balanceOf(insurance)).eq(20_000);
      expect(await vault.sharePrice()).eq(parseUnits('1', 6))
    });

    it("withdraw with fee test", async () => {
      await vault.connect(gov).setFees(1_000, 1_000);

      await vault.deposit(parseUnits('1', 6), signer1.address);
      await vault.deposit(parseUnits('1', 6), signer.address);

      const shares = await vault.balanceOf(signer.address);
      expect(shares).eq(990_000);

      const assets = await vault.convertToAssets(shares);
      const assetsMinusTax = assets.mul(99).div(100);
      expect(assetsMinusTax).eq(980100);

      const bal1 = await asset.balanceOf(signer.address);
      const shares1 = await vault.balanceOf(signer.address);
      await vault.withdraw(assetsMinusTax, signer.address, signer.address);
      expect(shares1.sub(await vault.balanceOf(signer.address))).eq(shares);
      expect((await asset.balanceOf(signer.address)).sub(bal1)).eq(assetsMinusTax);

      const insurance = await vault.insurance();
      expect(await asset.balanceOf(insurance)).eq(29_900);
      expect(await vault.sharePrice()).eq(parseUnits('1', 6))
    });

    it("redeem with fee test", async () => {
      await vault.connect(gov).setFees(1_000, 1_000);

      await vault.deposit(parseUnits('1', 6), signer1.address);
      await vault.deposit(parseUnits('1', 6), signer.address);

      const shares = await vault.balanceOf(signer.address);
      expect(shares).eq(990_000);

      const assets = await vault.convertToAssets(shares);
      const assetsMinusTax = assets.mul(99).div(100);
      expect(assetsMinusTax).eq(980100);

      const bal1 = await asset.balanceOf(signer.address);
      const shares1 = await vault.balanceOf(signer.address);
      await vault.redeem(shares, signer.address, signer.address);
      expect(shares1.sub(await vault.balanceOf(signer.address))).eq(shares);
      expect((await asset.balanceOf(signer.address)).sub(bal1)).eq(assetsMinusTax);

      const insurance = await vault.insurance();
      expect(await asset.balanceOf(insurance)).eq(29_900);
      expect(await vault.sharePrice()).eq(parseUnits('1', 6))
    });

    it("init wrong buffer revert", async () => {
      const logic = await DeployerUtils.deployContract(signer, 'TetuVaultV2') as TetuVaultV2;
      const proxy = await DeployerUtils.deployContract(signer, 'ProxyControlled') as ProxyControlled;
      await proxy.initProxy(logic.address);
      const v = TetuVaultV2__factory.connect(proxy.address, signer);
      await expect(v.init(
        controller.address,
        asset.address,
        '1',
        '2',
        gauge.address,
        10000000,
      )).revertedWith("!BUFFER");
    });

    it("init wrong gauge revert", async () => {
      const logic = await DeployerUtils.deployContract(signer, 'TetuVaultV2') as TetuVaultV2;
      const proxy = await DeployerUtils.deployContract(signer, 'ProxyControlled') as ProxyControlled;
      await proxy.initProxy(logic.address);
      const v = TetuVaultV2__factory.connect(proxy.address, signer);
      await expect(v.init(
        controller.address,
        asset.address,
        '1',
        '2',
        Misc.ZERO_ADDRESS,
        10,
      )).revertedWith("!GAUGE");
    });

    it("init wrong gauge controller revert", async () => {
      const logic = await DeployerUtils.deployContract(signer, 'TetuVaultV2') as TetuVaultV2;
      const proxy = await DeployerUtils.deployContract(signer, 'ProxyControlled') as ProxyControlled;
      await proxy.initProxy(logic.address);
      const v = TetuVaultV2__factory.connect(proxy.address, signer);
      const c = await DeployerUtils.deployMockController(signer);
      const g = await DeployerUtils.deployContract(signer, 'MockGauge', c.address) as MockGauge;
      await expect(v.init(
        controller.address,
        asset.address,
        '1',
        '2',
        g.address,
        10,
      )).revertedWith("!GAUGE_CONTROLLER");
    });

    it("set too high buffer revert", async () => {
      await expect(vault.connect(gov).setBuffer(1000_000)).revertedWith("BUFFER");
    });

    it("set buffer from 3d party revert", async () => {
      await expect(vault.connect(signer2).setBuffer(10)).revertedWith("DENIED");
    });

    it("set buffer test", async () => {
      await vault.connect(gov).setBuffer(1_000);
      await vault.deposit(parseUnits('1', 6), signer.address)
      expect(await asset.balanceOf(vault.address)).eq(10_000);
      await vault.deposit(100, signer.address)
      expect(await asset.balanceOf(vault.address)).eq(10001);
    });

    it("set max withdraw from 3d party revert", async () => {
      await expect(vault.connect(signer2).setMaxWithdraw(1, 1)).revertedWith("DENIED");
    });

    it("set max deposit from 3d party revert", async () => {
      await expect(vault.connect(signer2).setMaxDeposit(1, 1)).revertedWith("DENIED");
    });

    it("set max deposit test", async () => {
      await vault.connect(gov).setMaxDeposit(10, 10);
      await expect(vault.deposit(11, signer.address)).revertedWith("MAX");
      await expect(vault.mint(11, signer.address)).revertedWith("MAX");
    });

    it("set buffer test", async () => {
      await vault.connect(gov).setMaxWithdraw(10, 10);
      await vault.deposit(parseUnits('1', 6), signer.address)
      await expect(vault.withdraw(11, signer.address, signer.address)).revertedWith("MAX");
      await expect(vault.redeem(11, signer.address, signer.address)).revertedWith("MAX");
      await vault.withdraw(10, signer.address, signer.address)
      await vault.redeem(10, signer.address, signer.address)
    });

    it("set fees from 3d party revert", async () => {
      await expect(vault.connect(signer2).setFees(1, 1)).revertedWith("DENIED");
    });

    it("set fees too high revert", async () => {
      await expect(vault.connect(gov).setFees(10_000, 1)).revertedWith("TOO_HIGH");
    });

    it("set DoHardWorkOnInvest from 3d party revert", async () => {
      await expect(vault.connect(signer2).setDoHardWorkOnInvest(false)).revertedWith("DENIED");
    });

    it("insurance transfer revert", async () => {
      const insurance = VaultInsurance__factory.connect(await vault.insurance(), signer);
      await expect(insurance.init(Misc.ZERO_ADDRESS, Misc.ZERO_ADDRESS)).revertedWith("INITED");
    });

    it("insurance transfer revert", async () => {
      const insurance = VaultInsurance__factory.connect(await vault.insurance(), signer);
      await expect(insurance.transferToVault(1)).revertedWith("!VAULT");
    });

    it("set DoHardWorkOnInvest test", async () => {
      await vault.connect(gov).setDoHardWorkOnInvest(false);
      expect(await vault.doHardWorkOnInvest()).eq(false);
      await vault.deposit(parseUnits('1', 6), signer.address)
    });

    /*  it("check buffer complex test", async () => {
        await vault.connect(gov).setBuffer(100_000);
        await vault.deposit(parseUnits('1', 6), signer.address)
        expect(await usdc.balanceOf(vault.address)).eq(1_000_000);
        await vault.connect(gov).setBuffer(10_000);
        await vault.deposit(parseUnits('1', 6), signer.address)
        expect(await usdc.balanceOf(vault.address)).eq(200_000);
        await vault.connect(gov).setBuffer(100_000);
        await vault.deposit(parseUnits('1', 6), signer.address)
        expect(await usdc.balanceOf(vault.address)).eq(1200_000);
        await vault.withdraw(parseUnits('1', 6), signer.address, signer.address)
        expect(await usdc.balanceOf(vault.address)).eq(200_000);
        await vault.withdraw(parseUnits('2', 6), signer.address, signer.address)
        expect(await usdc.balanceOf(vault.address)).eq(0);
      });*/

    it("not invest on deposit", async () => {
      await vault.connect(gov).setBuffer(10_000);
      await vault.deposit(parseUnits('1', 6), signer.address)
      expect(await asset.balanceOf(vault.address)).eq(100_000);
      await vault.connect(gov).setBuffer(20_000);
      await vault.deposit(parseUnits('0.01', 6), signer.address)
      expect(await asset.balanceOf(vault.address)).eq(110_000);
    });

    /*  it("withdraw when splitter have not enough balance", async () => {
        await vault.connect(gov).setBuffer(10_000);
        const bal = await usdc.balanceOf(signer.address);
        await vault.deposit(parseUnits('1', 6), signer.address)
        expect(await usdc.balanceOf(vault.address)).eq(100_000);
        // await splitter.connect(signer2).lost(parseUnits('0.1', 6))
        await vault.withdrawAll()
        expect(await usdc.balanceOf(vault.address)).eq(0);
        const balAfter = await usdc.balanceOf(signer.address);
        expect(bal.sub(balAfter)).eq(parseUnits('0.1', 6));
      });*/

    /*  it("withdraw with slippage should be fair for all users", async () => {
        await vault.connect(gov).setBuffer(0);
        const bal = await usdc.balanceOf(signer.address);
        const bal1 = await usdc.balanceOf(signer2.address);
        await vault.deposit(parseUnits('1', 6), signer.address)
        await vault.connect(signer2).deposit(parseUnits('1', 6), signer2.address)

        await splitter.setSlippage(10_0);
        await expect(vault.withdrawAll()).revertedWith('SLIPPAGE');

        await vault.connect(gov).setFees(0, 1_000);
        await splitter.setSlippage(1_0);
        await vault.withdrawAll();

        const balAfter = await usdc.balanceOf(signer.address);
        expect(bal.sub(balAfter)).eq(parseUnits('0.01', 6));

        await splitter.setSlippage(1);
        await vault.connect(signer2).withdrawAll()
        const balAfter1 = await usdc.balanceOf(signer2.address);
        expect(bal1.sub(balAfter1)).eq(parseUnits('0.01', 6));
      });*/

    it("splitter assets test", async () => {
      expect(await vault.splitterAssets()).eq(0);
    });

    /*  it("cover loss test", async () => {
        const bal = await usdc.balanceOf(signer.address);
        await vault.connect(gov).setFees(1_000, 0);
        await vault.deposit(parseUnits('1', 6), signer.address);
        await splitter.coverLoss(10_000);
        await vault.withdrawAll();
        const balAfter = await usdc.balanceOf(signer.address);
        expect(bal.sub(balAfter)).eq(0);
      });*/

    it("cover loss revert", async () => {
      await expect(vault.coverLoss(1)).revertedWith('!SPLITTER');
    });

    describe("splitter/insurance setup tests", function () {
      let v: TetuVaultV2;
      before(async function () {
        const logic = await DeployerUtils.deployContract(signer, 'TetuVaultV2') as TetuVaultV2;
        const proxy = await DeployerUtils.deployContract(signer, 'ProxyControlled') as ProxyControlled;
        await proxy.initProxy(logic.address);
        v = TetuVaultV2__factory.connect(proxy.address, signer);
        await v.init(
          controller.address,
          asset.address,
          '1',
          '2',
          gauge.address,
          10,
        )
      });

      it("init insurance already inited revert", async () => {
        await expect(vault.initInsurance(Misc.ZERO_ADDRESS)).revertedWith('INITED');
      });

      it("init insurance wrong vault revert", async () => {
        const insurance = await DeployerUtils.deployContract(signer, 'VaultInsurance') as VaultInsurance;
        await insurance.init(vault.address, asset.address);
        await expect(v.initInsurance(insurance.address)).revertedWith('!VAULT');
      });

      it("init insurance wrong asset revert", async () => {
        const insurance = await DeployerUtils.deployContract(signer, 'VaultInsurance') as VaultInsurance;
        await insurance.init(v.address, tetu.address);
        await expect(v.initInsurance(insurance.address)).revertedWith('!ASSET');
      });

      it("set splitter from 3d party revert", async () => {
        await expect(vault.connect(signer2).setSplitter(Misc.ZERO_ADDRESS)).revertedWith("DENIED");
      });

      it("wrong asset revert", async () => {
        const s = await DeployerUtils.deployContract(signer, 'MockSplitter') as MockSplitter;
        await s.init(controller.address, tetu.address, vault.address);
        await expect(v.setSplitter(s.address)).revertedWith("WRONG_UNDERLYING");
      });

      it("wrong vault revert", async () => {
        const s = await DeployerUtils.deployContract(signer, 'MockSplitter') as MockSplitter;
        await s.init(controller.address, asset.address, vault.address);
        await expect(v.setSplitter(s.address)).revertedWith("WRONG_VAULT");
      });

      it("wrong controller revert", async () => {
        const cc = await DeployerUtils.deployMockController(signer);
        const s = await DeployerUtils.deployContract(signer, 'MockSplitter') as MockSplitter;
        await s.init(cc.address, asset.address, v.address);
        await expect(v.setSplitter(s.address)).revertedWith("WRONG_CONTROLLER");
      });
    });
  });

});
