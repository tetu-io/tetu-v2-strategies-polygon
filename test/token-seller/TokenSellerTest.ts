import { TimeUtils } from "../../scripts/utils/TimeUtils";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {
  MockToken,
  UniswapV3Callee,
  UniswapV3Factory,
  UniswapV3LibFacade,
  UniswapV3Pool__factory
} from "../../typechain";

/**
 * There is uniswap v3 pool with two tokens:
 * - token A - the token to be sold
 * - token B - the token to be withdrawn
 * The pool has some liquidity, so the tokens have some price P.
 *
 * Contract TokenSeller is liquidity provider of token A.
 * It creates range [P0, P1], where P0 <= P < P1
 * The task is to keep P ~ P0, ideally P = P0.
 * P1 >> P, so user is always able to buy any required amount of A.
 * Token seller provides liquidity of A to buy A and doesn't provide liquidity of B to sell A.
 * Anyway, user is able to swap A to B using liquidity from the main pool.
 *
 * If a user buys A, following happens:
 * - amount of B is increased on delta B
 * - price of A is increased: P => P2
 *
 * Token seller does following:
 *  - withdraw liquidity from the pool
 *  - deposit liquidity to the pool with new range [P0', P1'], where P0' <= P2 < P1'
 *  - transfer delta B to specified contract.
 *
 * If a user swaps A to B, following happens:
 * - price of A is decreased, P => P3:
 *    - most probably, P3 moves out of range [P0, P1]
 *    - edge case: P3 is still in [P0, P1]
 *
 * Token seller does following:
 *  - withdraw liquidity from the pool
 *  - deposit liquidity to the pool with new range [P0', P1'], where P0' <= P3 < P1'
 *
 * Invariant:
 *    Token seller shouldn't change price of the tokens in the pool.
 *
 */
describe('TokenSellerTest', () => {
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let uniswapV3Factory: UniswapV3Factory;
  let uniswapV3Callee: UniswapV3Callee;
  let facadeUni: UniswapV3LibFacade;
  let facadeLib: FacadeUniv3TokenSellerLib;

  let tokenA: MockToken;
  let tokenB: MockToken;

  before(async function () {
    [signer] = await ethers.getSigners();
    snapshotBefore = await TimeUtils.snapshot();
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    facadeUni = (await DeployerUtils.deployContract(signer, "UniswapV3LibFacade")) as UniswapV3LibFacade;
    facadeLib = (await DeployerUtils.deployContract(signer, "FacadeUniv3TokenSellerLib")) as FacadeUniv3TokenSellerLib;

    // create uniswapV3-factory and helper classes
    uniswapV3Factory = (await DeployerUtils.deployContract(signer, "UniswapV3Factory")) as UniswapV3Factory;
    tokenA = (await DeployerUtils.deployContract(signer, "MockToken", "ToSell", 18)) as MockToken;
    tokenB = (await DeployerUtils.deployContract(signer, "MockToken", "USDC", 6)) as MockToken;

    uniswapV3Callee = (await DeployerUtils.deployContract(signer, "UniswapV3Callee")) as UniswapV3Callee;
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });

  interface IPoolParams {
    /** 1 fee unit is 0.0001% */
    fee: number;
    /** Initial amount of the token A in the pool */
    tokenAmountA: string;
    /** Initial amount of the token B in the pool */
    tokenAmountB: string;
  }

  describe("Create and initialize main uniswap-v3 pool", () => {
    let snapshot1: string;
    let pool: string;
    const poolParams: IPoolParams = {
      fee: 100,
      tokenAmountA: "1000",
      tokenAmountB: "1000"
    }
    before(async function () {
      snapshot1 = await TimeUtils.snapshot();
      pool = await uniswapV3Factory.callStatic.createPool(tokenA.address, tokenB.address, poolParams.fee);
      await uniswapV3Factory.callStatic.createPool(tokenA.address, tokenB.address, poolParams.fee);

      // todo initialize the pool
      const sqrtPriceX96 = 0; // todo
      await UniswapV3Pool__factory.connect(pool, signer).initialize(sqrtPriceX96);


      // provide liquidity in wide range
      const tickLower = 0; // todo
      const tickUpper = 0; // todo
      const liquidityAmount = 0; // todo

      await uniswapV3Callee.mint(pool, signer.address, tickLower, tickUpper, liquidityAmount);
    });

    after(async function () {
      await TimeUtils.rollback(snapshot1);
    });

    describe("Create token-seller contract", () => {


    });
  });
});