import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers} from 'hardhat';
import {TimeUtils} from '../../../scripts/utils/TimeUtils';
import {DeployerUtils} from '../../../scripts/utils/DeployerUtils';
import {defaultAbiCoder, formatUnits, parseUnits} from 'ethers/lib/utils';
import {AppLibFacade, ConverterStrategyBaseLibFacade, MockToken, PriceOracleMock} from '../../../typechain';
import {expect} from 'chai';
import {MockHelper} from '../../baseUT/helpers/MockHelper';
import {Misc} from "../../../scripts/utils/Misc";
import {BigNumber} from "ethers";
import {
  IBorrowParamsNum, IConversionValidationParams,
  ILiquidationParams,
  IQuoteRepayParams,
  IRepayParams,
  ITokenAmountNum
} from "../../baseUT/mocks/TestDataTypes";
import {
  setupIsConversionValid,
  setupIsConversionValidDetailed,
  setupMockedLiquidation
} from "../../baseUT/mocks/MockLiquidationUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {setupMockedBorrow, setupMockedQuoteRepay, setupMockedRepay} from "../../baseUT/mocks/MockRepayUtils";
import {controlGasLimitsEx} from "../../../scripts/utils/GasLimitUtils";
import {
  GAS_CONVERTER_STRATEGY_BASE_CONVERT_AFTER_WITHDRAW,
  GAS_OPEN_POSITION,
  GET_GET_COLLATERALS,
  GET_INTERNAL_SWAP_TO_GIVEN_AMOUNT
} from "../../baseUT/GasLimits";
import {IERC20Metadata__factory} from "../../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {areAlmostEqual} from "../../baseUT/utils/MathUtils";
import { HARDHAT_NETWORK_ID, HardhatUtils } from '../../baseUT/utils/HardhatUtils';

describe('AppLibTest', () => {
  //region Variables
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let usdc: MockToken;
  let dai: MockToken;
  let tetu: MockToken;
  let usdt: MockToken;
  let weth: MockToken;
  let bal: MockToken;
  let unknown: MockToken;
  let facade: AppLibFacade;
  let mapTokenByAddress: Map<string, MockToken>;
  //endregion Variables

  //region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    facade = await MockHelper.createAppLibFacade(signer);
    usdc = await DeployerUtils.deployMockToken(signer, 'USDC', 6);
    tetu = await DeployerUtils.deployMockToken(signer, 'TETU');
    dai = await DeployerUtils.deployMockToken(signer, 'DAI');
    weth = await DeployerUtils.deployMockToken(signer, 'WETH', 18);
    usdt = await DeployerUtils.deployMockToken(signer, 'USDT', 6);
    bal = await DeployerUtils.deployMockToken(signer, 'BAL');
    unknown = await DeployerUtils.deployMockToken(signer, 'unknown');
    console.log("usdc", usdc.address);
    console.log("dai", dai.address);
    console.log("tetu", tetu.address);
    console.log("weth", weth.address);
    console.log("usdt", usdt.address);
    console.log("bal", bal.address);
    mapTokenByAddress = new Map<string, MockToken>();
    mapTokenByAddress.set(usdc.address, usdc);
    mapTokenByAddress.set(tetu.address, tetu);
    mapTokenByAddress.set(dai.address, dai);
    mapTokenByAddress.set(weth.address, weth);
    mapTokenByAddress.set(usdt.address, usdt);
    mapTokenByAddress.set(bal.address, bal);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });
  //endregion before, after

  //region Unit tests
  describe('getAssetIndex', () => {
    let snapshot: string;
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    describe('Good paths', () => {
      it('should return expected index', async() => {
        const assets = [usdc.address, tetu.address, usdt.address];
        for (let i = 0; i < assets.length; ++i) {
          await expect(await facade.getAssetIndex(assets, assets[i])).eq(i);
        }
      });
    });
    describe('Bad paths', () => {
      it('should type(uint).max if the asset is not found', async() => {
        const assets = [usdc.address, tetu.address, usdt.address];
        const ret = await facade.getAssetIndex(assets, weth.address);
        expect(ret.eq(Misc.MAX_UINT)).eq(true);
      });
    });
  });

  describe('_getLiquidationThreshold', () => {
    let snapshot: string;
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    it('should return custom value', async() => {
      const ret = (await facade._getLiquidationThreshold(1)).toNumber();
      expect(ret).eq(1);
    });
    it('should return default value', async() => {
      const ret = (await facade._getLiquidationThreshold(0)).toNumber();
      const defaultValue = (await facade.getDefaultLiquidationThresholdConstant()).toNumber();
      expect(ret).eq(defaultValue);
    });
  });

//endregion Unit tests
});
