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
  let _10_000_000: BigNumber;
  let feeDenominator: BigNumber;
  const bufferRate = 1_000; // n_%
  // const bufferDenominator = 100_000;
  const assetBalance = async (holder: string) => {
    return balanceOf(asset.address, holder);
  }


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
    _10_000_000 = parseUnits('10000000', 6);

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
    // await TokenUtils.getToken(asset.address, signer1.address, _10_000_000)
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

  describe("Total Assets Deviation", function () {
    const DEPOSIT_FEE = 300;
    const WITHDRAW_FEE = 300;

    const getBalances = async () => {
      return {
        depositFee: await vault.depositFee(),
        withdrawFee: await vault.withdrawFee(),
        vault: await assetBalance(vault.address),
        insurance: await assetBalance(insuranceAddress),
        // splitter: await assetBalance(splitterAddress),
        strategy: await assetBalance(strategy.address),
        strategyT1: await balanceOf(token1.address, strategy.address),
        strategyT2: await balanceOf(token2.address, strategy.address),
        vaultTotal: await vault.totalAssets(),
        strategyTotal: await strategy.totalAssets(),
      }
    }

    beforeEach(async function () {
      snapshot = await TimeUtils.snapshot();
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshot);
    });

    it("deposit", async () => {
      console.log('deposit...');
      const deposit = _100_000;
      await vault.deposit(deposit, signer.address);
      const initialBalances = await getBalances();
      console.log('initialBalances', initialBalances);

      console.log('withdrawAll...');
      await vault.withdrawAll();
      console.log('withdrawAll complete.');

    });

  });


});
