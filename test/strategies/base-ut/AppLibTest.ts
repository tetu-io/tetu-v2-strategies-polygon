import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers} from 'hardhat';
import {TimeUtils} from '../../../scripts/utils/TimeUtils';
import {DeployerUtils} from '../../../scripts/utils/DeployerUtils';
import {AppLibFacade, MockToken} from '../../../typechain';
import {expect} from 'chai';
import {MockHelper} from '../../baseUT/helpers/MockHelper';
import {Misc} from "../../../scripts/utils/Misc";
import { HARDHAT_NETWORK_ID, HardhatUtils } from '../../baseUT/utils/HardhatUtils';
import {BigNumber} from "ethers";
import { parseUnits } from 'ethers/lib/utils';

describe('AppLibTest', () => {
  const INFINITE_APPROVE = BigNumber.from(2).pow(255);

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

  describe("approveForced", () => {
    let snapshot: string;
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    const SPENDER = ethers.Wallet.createRandom().address;
    it("should set initial approve", async () => {
      await facade.approveForced(usdc.address, parseUnits("1.2", 6), SPENDER);
      const allowance = await usdc.allowance(facade.address, SPENDER);
      expect(allowance).eq(parseUnits("1.2", 6));
    });
    it("should increase approve", async () => {
      await facade.approveForced(usdc.address, parseUnits("1.2", 6), SPENDER);
      await facade.approveForced(usdc.address, parseUnits("2.3", 6), SPENDER);
      const allowance = await usdc.allowance(facade.address, SPENDER);
      expect(allowance).eq(parseUnits("2.3", 6));
    });
    it("should decrease approve", async () => {
      await facade.approveForced(usdc.address, parseUnits("1.2", 6), SPENDER);
      await facade.approveForced(usdc.address, parseUnits("0.1", 6), SPENDER);
      const allowance = await usdc.allowance(facade.address, SPENDER);
      expect(allowance).eq(parseUnits("0.1", 6));
    });
  });

  describe("approveIfNeeded", () => {
    let snapshot: string;
    beforeEach(async function() {
      snapshot = await TimeUtils.snapshot();
    });
    afterEach(async function() {
      await TimeUtils.rollback(snapshot);
    });

    const SPENDER = ethers.Wallet.createRandom().address;
    it("should set initial approve", async () => {
      await facade.approveIfNeeded(usdc.address, parseUnits("1.2", 6), SPENDER);
      const allowance = await usdc.allowance(facade.address, SPENDER);
      expect(allowance).eq(INFINITE_APPROVE);
    });
    it("should increase approve", async () => {
      await facade.approveIfNeeded(usdc.address, parseUnits("1.2", 6), SPENDER);
      await facade.approveIfNeeded(usdc.address, parseUnits("2.3", 6), SPENDER);
      const allowance = await usdc.allowance(facade.address, SPENDER);
      expect(allowance).eq(INFINITE_APPROVE);
    });
    it("should decrease approve", async () => {
      await facade.approveIfNeeded(usdc.address, parseUnits("1.2", 6), SPENDER);
      await facade.approveIfNeeded(usdc.address, parseUnits("0.1", 6), SPENDER);
      const allowance = await usdc.allowance(facade.address, SPENDER);
      expect(allowance).eq(INFINITE_APPROVE);
    });
  });

//endregion Unit tests
});
