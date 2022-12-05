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
  IERC20Extended,
} from "../../../../typechain";
import {parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
import {BigNumber} from "ethers";

const {expect} = chai;
chai.use(chaiAsPromised);

const balanceOf = TokenUtils.balanceOf;

describe("Dystopia Depositor tests", function () {
  const routerAddress = '0xbE75Dd16D029c6B32B7aD57A0FD9C1c20Dd2862e';
  const voterAddress = '0x649BdF58B09A0Cd4Ac848b42c4B5e1390A72A49A';
  let snapshotBefore: string;
  let snapshot: string;
  let signer: SignerWithAddress;
  let tokenA: IERC20Extended;
  let tokenB: IERC20Extended;
  let tokenADecimals: number;
  let tokenBDecimals: number;
  let a1: BigNumber;
  let a100000: BigNumber;
  let b1: BigNumber;
  let b100000: BigNumber;
  let depositor: DystopiaDepositorTest;
  let depositor2: DystopiaDepositorTest;
  let gauge: IGauge;

  before(async function () {
    [signer] = await ethers.getSigners();

    snapshotBefore = await TimeUtils.snapshot();

    tokenA = IERC20Extended__factory.connect(PolygonAddresses.USDC_TOKEN, signer);
    tokenB = IERC20Extended__factory.connect(PolygonAddresses.DAI_TOKEN, signer);
    tokenADecimals = await tokenA.decimals();
    tokenBDecimals = await tokenB.decimals();

    a1 = parseUnits('1', tokenADecimals);
    a100000 = parseUnits('100000', tokenADecimals);
    b1 = parseUnits('1', tokenBDecimals);
    b100000 = parseUnits('100000', tokenBDecimals);

    depositor = await DeployerUtils.deployContract(signer, 'DystopiaDepositorTest',
      routerAddress, tokenA.address, tokenB.address, true, voterAddress) as DystopiaDepositorTest;

    // Second depositor with swapped tokens
    depositor2 = await DeployerUtils.deployContract(signer, 'DystopiaDepositorTest',
      routerAddress, tokenB.address, tokenA.address, true, voterAddress) as DystopiaDepositorTest;

    gauge = IGauge__factory.connect(await depositor.depositorGauge(), signer);

    // GET TOKENS & APPROVE

    await TokenUtils.getToken(tokenA.address, depositor.address, a100000);
    await TokenUtils.getToken(tokenB.address, depositor.address, b100000);

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

  describe("depositor", function () {

    it("deposit", async () => {
      expect(await depositor._depositorLiquidity()).eq(0);
      await depositor.depositorEnter([a100000, b100000]);
      expect(await depositor._depositorLiquidity()).gt(1);
      const balanceA = await balanceOf(tokenA.address, depositor.address);
      const balanceB = await balanceOf(tokenB.address, depositor.address);
      expect(balanceA).lt(a1);
      expect(balanceB).lt(b1);

    });

  });

});
