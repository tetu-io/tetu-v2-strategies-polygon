import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {
  IGauge,
  DystopiaDepositorTest,
  IGauge__factory,
  IERC20Extended__factory,
  IERC20Extended, IPair__factory, IRouter__factory,
} from "../../../../typechain";
import {parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {BigNumber, constants} from "ethers";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";

const {expect} = chai;
chai.use(chaiAsPromised);

const _balanceOf = TokenUtils.balanceOf;
const _addr = ethers.utils.getAddress;

describe("Dystopia Depositor tests", function () {
  const routerAddress = '0xbE75Dd16D029c6B32B7aD57A0FD9C1c20Dd2862e';
  const voterAddress = '0x649BdF58B09A0Cd4Ac848b42c4B5e1390A72A49A';
  const tokenBAddress = PolygonAddresses.USDC_TOKEN;
  const tokenAAddress = PolygonAddresses.DAI_TOKEN;

  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let tokenA: IERC20Extended;
  let tokenB: IERC20Extended;
  let tokenADecimals: number;
  let tokenBDecimals: number;
  let a1: BigNumber;
  let a1000: BigNumber;
  let a100000: BigNumber;
  let b1: BigNumber;
  let b1000: BigNumber;
  let b100000: BigNumber;
  let depositor: DystopiaDepositorTest;
  // let depositor2: DystopiaDepositorTest;
  let gauge: IGauge;

  before(async function () {
    [signer] = await ethers.getSigners();

    snapshotBefore = await TimeUtils.snapshot();

    tokenA = IERC20Extended__factory.connect(tokenAAddress, signer);
    tokenB = IERC20Extended__factory.connect(tokenBAddress, signer);
    tokenADecimals = await tokenA.decimals();
    tokenBDecimals = await tokenB.decimals();

    a1 = parseUnits('1', tokenADecimals);
    a1000 = parseUnits('1000', tokenADecimals);
    a100000 = parseUnits('100000', tokenADecimals);
    b1 = parseUnits('1', tokenBDecimals);
    b1000 = parseUnits('1000', tokenBDecimals);
    b100000 = parseUnits('100000', tokenBDecimals);

    depositor = await DeployerUtils.deployContract(signer, 'DystopiaDepositorTest',
      routerAddress, tokenA.address, tokenB.address, true, voterAddress) as DystopiaDepositorTest;

    // Second depositor with swapped tokens
    // depositor2 = await DeployerUtils.deployContract(signer, 'DystopiaDepositorTest',
    //   routerAddress, tokenB.address, tokenA.address, true, voterAddress) as DystopiaDepositorTest;

    gauge = IGauge__factory.connect(await depositor.depositorGauge(), signer);

    // GET TOKENS & APPROVE

    await TokenUtils.getToken(tokenA.address, depositor.address, a100000);
    await TokenUtils.getToken(tokenB.address, depositor.address, b100000);

    await TokenUtils.getToken(tokenA.address, signer.address, a100000);

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

  ////////////////// TESTS ///////////////////

  describe("deposit", function () {

    it("deposit should consume one of tokens", async () => {
      expect(await depositor._depositorLiquidity()).eq(0);

      await depositor.depositorEnter([a100000, b100000]);
      expect(await depositor._depositorLiquidity()).gt(1);

      const balanceA = await _balanceOf(tokenA.address, depositor.address);
      const balanceB = await _balanceOf(tokenB.address, depositor.address);
      expect(balanceA.eq(0) || balanceB.eq(0)).eq(true);

    });

    it("deposit should consume both tokens proportionally", async () => {
      expect(await depositor._depositorLiquidity()).eq(0);

      const reserves = await depositor._depositorPoolReserves();
      const amountA = a1000;
      const amountB = reserves[1].mul(amountA).div(reserves[0]);

      await depositor.depositorEnter([amountA, amountB]);
      expect(await depositor._depositorLiquidity()).gt(1);

      const balanceA = await _balanceOf(tokenA.address, depositor.address);
      const balanceB = await _balanceOf(tokenB.address, depositor.address);

      const consumedA = a100000.sub(balanceA);
      const consumedB = b100000.sub(balanceB);

      expect(consumedA).eq(amountA);
      expect(consumedB).eq(amountB);

    });

  });

  describe("withdraw", function () {

    it("withdraw all should return all", async () => {
      expect(await depositor._depositorLiquidity()).eq(0);

      await depositor.depositorEnter([a100000, b100000]);
      expect(await depositor._depositorLiquidity()).gt(1);
      await depositor.depositorEmergencyExit();
      expect(await depositor._depositorLiquidity()).eq(0);

      const balanceA = await _balanceOf(tokenA.address, depositor.address);
      const balanceB = await _balanceOf(tokenB.address, depositor.address);

      expect(balanceA).gte(a100000.sub(a1.div(1000000))); // 1/1000000  for rounding errors
      expect(balanceB).gte(b100000.sub(b1.div(1000000)));

    });


    it("withdraw 50% should return 50%", async () => {
      expect(await depositor._depositorLiquidity()).eq(0);

      const reserves = await depositor._depositorPoolReserves();
      const amountA = a1000;
      const amountB = reserves[1].mul(amountA).div(reserves[0]);

      await depositor.depositorEnter([amountA, amountB]);
      const liquidity = await depositor._depositorLiquidity();
      expect(liquidity).gt(1);
      await depositor.depositorExit(liquidity.div(2));

      const balanceA = await _balanceOf(tokenA.address, depositor.address);
      const balanceB = await _balanceOf(tokenB.address, depositor.address);

      const consumedA = a100000.sub(balanceA);
      const consumedB = b100000.sub(balanceB);

      expect(consumedA).gte(amountA.div(2));
      expect(consumedB).gte(amountB.div(2));

    });

  });

  describe("views", function () {

    it("_depositorPoolAssets", async () => {
      const assets = await depositor._depositorPoolAssets();
      expect(assets.length).eq(2);
      expect(assets[0]).eq(_addr(tokenAAddress));
      expect(assets[1]).eq(_addr(tokenBAddress));
    });

    it("_depositorLiquidity", async () => {
      const liq = await depositor._depositorLiquidity();
      const gaugeBalance = await TokenUtils.balanceOf(gauge.address, depositor.address);
      expect(liq).eq(gaugeBalance);
    });

    it("_depositorPoolReserves", async () => {
      const weights = await depositor._depositorPoolReserves();
      const pair = IPair__factory.connect(await depositor.depositorPair(), signer);
      const reserves = await pair.getReserves();
      const token1 = await pair.token1();
      const swap = _addr(tokenA.address) === token1.toString();
      console.log('swap', swap);
      if (swap) {
        expect(weights[0]).eq(reserves[1]);
        expect(weights[1]).eq(reserves[0]);
      } else {
        expect(weights[0]).eq(reserves[0]);
        expect(weights[1]).eq(reserves[1]);
      }
    });

    it("_depositorPoolWeights", async () => {
      let weights;
      let totalWeight;
      [weights, totalWeight] = await depositor._depositorPoolWeights();
      expect(weights.length).eq(2);
      expect(weights[0]).eq(1);
      expect(weights[1]).eq(1);
      expect(totalWeight).eq(2);
    });

  });

  describe("claim", function () {

    it("claim w/o deposit returns no rewards", async () => {
      await depositor.depositorClaimRewards();
      const tokens = await depositor.claimedRewardTokens();
      const amounts = await depositor.claimedRewardAmounts();
      expect(tokens.length).eq(0);
      expect(amounts.length).eq(0);
    });

    it("claim after deposit should return DYST rewards", async () => {
      await depositor.depositorEnter([a100000, b100000]);
      await TimeUtils.advanceBlocksOnTs(10000);
      await depositor.depositorClaimRewards();
      const tokens = await depositor.claimedRewardTokens();
      const amounts = await depositor.claimedRewardAmounts();
      expect(tokens.length).eq(1);
      expect(amounts.length).eq(1);
      expect(tokens[0]).eq(_addr(MaticAddresses.DYST_TOKEN));
      expect(amounts[0]).gt(1);

    });

    it("claim after deposit & swaps should return pair fees", async () => {
      await depositor.depositorEnter([a100000, b100000]);
      await TimeUtils.advanceBlocksOnTs(100000);

      const router = IRouter__factory.connect(routerAddress, signer);

      await TokenUtils.approve(tokenAAddress, signer, routerAddress, constants.MaxUint256.toString());
      await TokenUtils.approve(tokenBAddress, signer, routerAddress, constants.MaxUint256.toString());

      {
        await depositor.depositorClaimRewards();
        const tokens = await depositor.claimedRewardTokens();
        const amounts = await depositor.claimedRewardAmounts();
        expect(tokens.length).eq(1);
        expect(amounts.length).eq(1);
        expect(tokens[0]).eq(_addr(MaticAddresses.DYST_TOKEN));
        expect(amounts[0]).gt(1);
        const dystBalance = await TokenUtils.balanceOf(MaticAddresses.DYST_TOKEN, depositor.address);
        console.log('dystBalance', dystBalance.toString());
      }


      // make few swaps at pool to generate fee
      const balanceA = await TokenUtils.balanceOf(tokenAAddress, signer.address);
      console.log('balanceA     ', balanceA);
      await router.swapExactTokensForTokensSimple(
        balanceA.div(2), 1, tokenAAddress, tokenBAddress, true, signer.address, constants.MaxUint256.toString())
      const balanceB = await TokenUtils.balanceOf(tokenBAddress, signer.address);
      await router.swapExactTokensForTokensSimple(
        balanceB, 1, tokenBAddress, tokenAAddress, true, signer.address, constants.MaxUint256.toString())
      const balanceAAfter = await TokenUtils.balanceOf(tokenAAddress, signer.address);
      console.log('balanceAAfter', balanceAAfter);
      // await gauge.claimFees();

      {
        await depositor.depositorClaimRewards();
        const tokens = await depositor.claimedRewardTokens();
        const amounts = await depositor.claimedRewardAmounts();
        expect(tokens.length).eq(1);
        expect(amounts.length).eq(1);
        // expect(tokens[0]).eq(_addr(MaticAddresses.DYST_TOKEN));
        expect(amounts[0]).gt(1);
      }

    });

  });

});
