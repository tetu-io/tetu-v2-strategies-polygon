import {DeployerUtils} from "../utils/DeployerUtils";
import {MockToken, UniswapV3Callee, UniswapV3Factory, UniswapV3Pool__factory, Univ3TokenSeller} from "../../typechain";
import {ethers} from "hardhat";
import {parseUnits} from "ethers/lib/utils";
import {UniswapV3Utils} from "../utils/UniswapV3Utils";
import {RunHelper} from "../utils/RunHelper";
import {Univ3TokenSellerLib} from "../../typechain/contracts/token-seller/Univ3TokenSeller";
import TokenSellerConfigStruct = Univ3TokenSellerLib.TokenSellerConfigStruct;

async function main() {
  const signer =  (await ethers.getSigners())[0];

  const POOL_OWNER_AMOUNT_A = "100000";
  const POOL_OWNER_AMOUNT_B = "100000";
  const FEE_UNIV3 = 10_000;

  const decimalsA = 18;
  const decimalsB = 6;

  const poolSwapTokens = false;

  const tokenA = (await DeployerUtils.deployMockToken(signer, "ToSell", decimalsA, "0")) as MockToken;
  console.log("tokenA", tokenA.address);
  const tokenB = (await DeployerUtils.deployMockToken(signer,  "USDC", decimalsB, "0")) as MockToken;
  console.log("tokenB", tokenB.address);

  // --------------------- mint tokens
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    tokenA.populateTransaction.mint(signer.address, parseUnits(POOL_OWNER_AMOUNT_A, decimalsA))
  );
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    tokenB.populateTransaction.mint(signer.address, parseUnits(POOL_OWNER_AMOUNT_B, decimalsB))
  );

  // --------------------- create univ3 pool
  const uniswapV3Factory = (await DeployerUtils.deployContract(signer, "UniswapV3Factory")) as UniswapV3Factory;
  console.log("uniswapV3Factory", uniswapV3Factory.address);

  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    uniswapV3Factory.populateTransaction.createPool(tokenA.address, tokenB.address, FEE_UNIV3)
  );

  const pool = UniswapV3Pool__factory.connect(
    await uniswapV3Factory.getPool(tokenA.address, tokenB.address, FEE_UNIV3),
    signer
  );
  console.log("pool", pool.address);

  const amountA = parseUnits(POOL_OWNER_AMOUNT_A, decimalsA);
  const amountB = parseUnits(POOL_OWNER_AMOUNT_B, decimalsB);
  const sqrtPriceX96 = await UniswapV3Utils.getInitialSqrtPriceX96(amountA, amountB, poolSwapTokens);
  console.log("sqrtPriceX96", sqrtPriceX96);

  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    pool.populateTransaction.initialize(sqrtPriceX96)
  );

  // --------------------- wide range


  // --------------------- token seller
  const NARROW_RANGE_AMOUNT_A = "10000";
  const config: TokenSellerConfigStruct = {
    amountA: parseUnits(NARROW_RANGE_AMOUNT_A, decimalsA),
    thresholdLastRefreshPoolSec: 1000,
    thresholdRatio: parseUnits("0.1", 5),
    thresholdTokenB: 0,
    tickRangeSize: 10,
    tickLimit:
  }

  const tokenSeller = (await DeployerUtils.deployContract(
    signer,
    tokenA.address,
    tokenB.address,
    pool.address,
    config,
    signer.address
  )) as Univ3TokenSeller;


}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
