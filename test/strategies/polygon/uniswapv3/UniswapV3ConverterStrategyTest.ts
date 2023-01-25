import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  IController,
  IERC20,
  IERC20__factory, IStrategyV2,
  StrategySplitterV2, StrategySplitterV2__factory,
  TetuVaultV2,
  UniswapV3ConverterStrategy, UniswapV3ConverterStrategy__factory
} from "../../../../typechain";
import {BigNumber} from "ethers";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {parseUnits} from "ethers/lib/utils";
import {getConverterAddress, Misc} from "../../../../scripts/utils/Misc";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {ConverterUtils} from "../../../baseUT/utils/ConverterUtils";

const { expect } = chai;

describe('UniswapV3ConverterStrategyTests', function() {
  let snapshotBefore: string;
  let snapshot: string;
  let gov: SignerWithAddress;
  let signer: SignerWithAddress;
  let controller: IController;
  let asset: IERC20;
  let token1: IERC20;
  let token2: IERC20;

  let vault: TetuVaultV2;
  let splitter: StrategySplitterV2;
  let splitterAddress: string;
  let strategy: UniswapV3ConverterStrategy;
  let insuranceAddress: string;
  let _1: BigNumber;
  let _100_000: BigNumber;
  let feeDenominator: BigNumber;
  const bufferRate = 1_000; // n_%

  before(async function() {
    [signer] = await ethers.getSigners();
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    snapshotBefore = await TimeUtils.snapshot();

    const core = Addresses.getCore();
    controller = DeployerUtilsLocal.getController(signer);
    asset = IERC20__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    token1 = asset;
    token2 = IERC20__factory.connect(PolygonAddresses.WETH_TOKEN, signer);

    _1 = parseUnits('1', 6);
    _100_000 = parseUnits('100000', 6);

    const vaultName = 'tetu' + 'USDC';
    gov = await DeployerUtilsLocal.getControllerGovernance(signer);

    const strategyDeployer = async(_splitterAddress: string) => {
      const _strategy = UniswapV3ConverterStrategy__factory.connect(
        await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
        gov
      );

      // USDC / WETH 0.05% [1,301.20 - 1,800.87]
      const poolAddress = '0x45dDa9cb7c25131DF268515131f647d726f50608';
      const tickLower = 201360;
      const tickUpper = 204610;

      await _strategy.init(
        core.controller,
        _splitterAddress,
        getConverterAddress(),
        poolAddress,
        tickLower,
        tickUpper,
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
    strategy = data.strategy as unknown as UniswapV3ConverterStrategy;

    insuranceAddress = await vault.insurance();
    feeDenominator = await vault.FEE_DENOMINATOR();
    splitterAddress = await vault.splitter();
    splitter = StrategySplitterV2__factory.connect(splitterAddress, signer);

    await TokenUtils.getToken(asset.address, signer.address, _100_000);
    await asset.approve(vault.address, Misc.MAX_UINT);

    // Disable DForce at TetuConverter
    await ConverterUtils.disableDForce(signer);
  })

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  describe('UniswapV3 strategy tests', function() {
    it('deposit / withdraw', async() => {
      console.log('deposit...');

      const balanceBefore = await TokenUtils.balanceOf(asset.address, signer.address);

      await vault.deposit(_1, signer.address);

      console.log('withdrawAll...');

      await vault.withdrawAll();

      const balanceAfter = await TokenUtils.balanceOf(asset.address, signer.address);
    })
  })
})