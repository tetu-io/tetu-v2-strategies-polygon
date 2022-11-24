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
  IGauge__factory,
  IGauge,
  ITetuConverter__factory,
  ITetuConverter,
  IController__factory,
  IController,
  StrategySplitterV2__factory,
  VaultFactory__factory,
  StrategyDystopiaConverter__factory,
  StrategyDystopiaConverter,
  DystopiaConverterStrategy,
  IConverterController__factory, IBorrowManager__factory
} from "../../../../typechain";
import {Misc} from "../../../../scripts/utils/Misc";
import {parseUnits} from "ethers/lib/utils";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {RunHelper} from "../../../../scripts/utils/RunHelper";
import {BigNumber} from "ethers";


const {expect} = chai;
chai.use(chaiAsPromised);

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
  // let splitter: StrategySplitterV2;
  // let converter: ITetuConverter;
  let strategy: StrategyDystopiaConverter;
  let gauge: IGauge;
  let _1: BigNumber;

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

    const vaultName = 'tetu' + 'USDC';
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);
    const coreContracts = await DeployerUtilsLocal.getCoreAddressesWrapper(gov);
    gauge = coreContracts.gauge;

    const strategyDeployer = async (splitterAddress: string) => {
      const _strategy = StrategyDystopiaConverter__factory.connect(
        await DeployerUtils.deployProxy(signer, 'StrategyDystopiaConverter'), gov);

      await _strategy.initialize(
        core.controller,
        splitterAddress,
        tools.converter,
        token1.address,
        token2.address,
        true
      );

      return _strategy;
    }

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset.address, vaultName, strategyDeployer, controller, gov,
      100, 0, 0, false
    );
    vault = data.vault.connect(signer);
    strategy = data.strategy as StrategyDystopiaConverter;

    // GET TOKENS & APPROVE

    await TokenUtils.getToken(asset.address, signer.address, parseUnits('10000', 6))
    await TokenUtils.getToken(asset.address, signer1.address, parseUnits('10000', 6))
    await TokenUtils.getToken(asset.address, signer2.address, parseUnits('10000', 6))

    await asset.connect(signer1).approve(vault.address, Misc.MAX_UINT);
    await asset.connect(signer2).approve(vault.address, Misc.MAX_UINT);
    await asset.approve(vault.address, Misc.MAX_UINT);

    // Disable DForce at TetuConverter
    {
      const converter = ITetuConverter__factory.connect(tools.converter, signer);
      const converterControllerAddr = await converter.controller();
      const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
      const converterGovAddr = await converterController.governance();
      const converterGov = await DeployerUtilsLocal.impersonate(converterGovAddr);
      const borrowManagerAddr = await converterController.borrowManager();
      console.log('borrowManagerAddr', borrowManagerAddr);
      const borrowManager = IBorrowManager__factory.connect(borrowManagerAddr, converterGov);
      const DFORCE_POOL_ADAPTER = '0x782b232a8C98aa14c8D48144845ccdf1fD3eeCBA';
      console.log('removeAssetPairs...');
      await borrowManager.removeAssetPairs(DFORCE_POOL_ADAPTER, [asset.address], [token2.address]);
      console.log('done...\n\n');
    }
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

  describe("Tokens Movement", function () {

/*
    interface ISnapshotItem {
      value?: BigNumber,
      prev?: BigNumber,
      delta?: BigNumber,

    }

    type

    const makeValuesSnapshot = async function(s: ISnapshotItem[] )
*/



    it("deposit", async () => {
      await vault.connect(gov).setFees(300, 300);
      console.log('deposit...');
      await vault.deposit(_1, signer.address);
      console.log('withdrawAll...');
      hre.tracer.enabled = true;
      await vault.withdrawAll();

    });

  });

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
