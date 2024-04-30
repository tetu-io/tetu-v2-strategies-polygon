import {ethers, network} from "hardhat";
import {DeployTokenSellerUtils} from "./DeployTokenSellerUtils";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";
import {DeployerUtils} from "../utils/DeployerUtils";
import {
  MockToken,
  UniswapV3Callee, UniswapV3Factory,
  UniswapV3Factory__factory, UniswapV3LibFacade, UniswapV3Pool,
  UniswapV3Pool__factory, Univ3TokenSeller__factory
} from "../../typechain";
import {RunHelper} from "../utils/RunHelper";
import {parseUnits} from "ethers/lib/utils";
import {UniswapV3Utils} from "../utils/UniswapV3Utils";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

const POOL_SPOOKY_SWAP_FACTORY = "0x7928a2c48754501f3a8064765ECaE541daE5c3E6";
const poolSwapTokens = false;
const fee = 10000; // 1%

const tickRangeSize = 10;
const SIGNER_AMOUNT_A = "1000";
const thresholdRatio = "0.1";
const thresholdLastRefreshPoolSec = 100;

const decimalsA = 18;
const decimalsB = 6;

const AMOUNT_A_TO_SIGNER = "1000000";
const AMOUNT_B_TO_SIGNER = "1000000";
const AMOUNT_A_TO_TOKEN_SELLER = "10000";

const AMOUNT_A_WIDE = "10000";
const AMOUNT_B_WIDE = "10000";

async function putLiquidityToRangeWide(
  signer: SignerWithAddress,
  pool: UniswapV3Pool,
  uniswapV3Callee: UniswapV3Callee,
  facadeUni: UniswapV3LibFacade,
  poolSwapTokens: boolean,
  pricesRange: string[],
  sqrtPriceX96: BigNumber,
  amountA: BigNumber,
  amountB: BigNumber,
  tokenA: MockToken,
  tokenB: MockToken,
) {
  console.log("************ putLiquidityToRangeWide");
  const tickCurrent = await facadeUni._getTickAtSqrtRatio(sqrtPriceX96);
  const priceLowerSquareX96 = sqrtPriceX96.mul(
    parseUnits(pricesRange[0], 5)
  ).mul(
    parseUnits(pricesRange[0], 5)
  ).div(
    parseUnits("1", 5 + 5)
  );
  const priceUpperSquareX96 = sqrtPriceX96.mul(
    parseUnits(pricesRange[1], 5)
  ).mul(
    parseUnits(pricesRange[1], 5)
  ).div(
    parseUnits("1", 5 + 5)
  );
  const tickLower0 = await facadeUni._getTickAtSqrtRatio(priceLowerSquareX96);
  const tickUpper0 = await facadeUni._getTickAtSqrtRatio(priceUpperSquareX96);
  const tickSpacing = await pool.tickSpacing();
  const tickRange = Math.ceil(
    (Math.round((tickUpper0 - tickLower0) / 2)) / tickSpacing
  ) * tickSpacing;
  console.log("************ tickCurrent", tickCurrent);
  console.log("************ tickLower0", tickLower0);
  console.log("************ tickUpper0", tickUpper0);
  console.log("************ tickRange", tickRange);
  console.log("************ tickCurrent - tickRange", tickCurrent - tickRange);
  console.log("************ (tickCurrent - tickRange) / tickSpacing", (tickCurrent - tickRange) / tickSpacing);
  console.log("************ Math.ceil(tickCurrent - tickRange) / tickSpacing)", Math.ceil(tickCurrent - tickRange) / tickSpacing);
  console.log("************ (Math.ceil((tickCurrent - tickRange) / tickSpacing) - 1) * tickSpacing", (Math.ceil((tickCurrent - tickRange) / tickSpacing) - 1) * tickSpacing);

  const lowerTick = (tickCurrent < 0 && tickCurrent / tickSpacing * tickSpacing !== tickCurrent)
    ? (Math.floor((tickCurrent - tickRange) / tickSpacing) - 1) * tickSpacing
    : Math.floor((tickCurrent - tickRange) / tickSpacing) * tickSpacing;
  const upperTick = tickRange === 0 ? lowerTick + tickSpacing : lowerTick + tickRange * 2;

  console.log("************ lowerTick, upperTick:", lowerTick, upperTick);
  const liquidityAmount = poolSwapTokens
    ? await facadeUni.getLiquidityForAmounts(sqrtPriceX96, lowerTick, upperTick, amountB, amountA)
    : await facadeUni.getLiquidityForAmounts(sqrtPriceX96, lowerTick, upperTick, amountA, amountB);
  const requiredAmounts = await facadeUni.getAmountsForLiquidity(sqrtPriceX96, lowerTick, upperTick, liquidityAmount);

  console.log("************ prepare initial amounts of both token, requiredAmounts", requiredAmounts);
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    tokenA.populateTransaction.approve(uniswapV3Callee.address, poolSwapTokens ? requiredAmounts.amount1 : requiredAmounts.amount0)
  );
  console.log("balance A", await tokenA.balanceOf(signer.address));
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    tokenB.populateTransaction.approve(uniswapV3Callee.address, poolSwapTokens ? requiredAmounts.amount0 : requiredAmounts.amount1)
  );
  console.log("balance B", await tokenB.balanceOf(signer.address));

  console.log("************ mint liquidityAmount", liquidityAmount);
  // await uniswapV3Callee.mint(pool.address, signer.address, lowerTick, upperTick, liquidityAmount, {gasLimit: 9_000_000})
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    uniswapV3Callee.populateTransaction.mint(pool.address, signer.address, lowerTick, upperTick, liquidityAmount, {gasLimit: 9_000_000})
  );

  return {lowerTick, upperTick, liquidityAmount};
}

/**
 * Deploy a couple of mocked tokens.
 * Create univ3 pool on Spooky Swap.
 * Put liquidity to wide range.
 * Deploy TokenSeller, put liquidity to narrow range.
 *
 * npx hardhat run scripts/token-seller/DeployTokenSellerTokensPool.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";
  const signer =  (await ethers.getSigners())[0];
  console.log("************ signer", signer.address);

  const net = await ethers.provider.getNetwork();
  console.log(net, `************ network name="${network.name}"`);

  const tokenA = (await DeployerUtils.deployMockToken(signer, "MockToSell", decimalsA, "0")) as MockToken;
  const tokenB = (await DeployerUtils.deployMockToken(signer,  "MockUSDC", decimalsB, "0")) as MockToken;

  console.log("************ Deploy mocked tokens");
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    tokenA.populateTransaction.mint(signer.address, parseUnits(AMOUNT_A_TO_SIGNER, decimalsA))
  );
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    tokenB.populateTransaction.mint(signer.address, parseUnits(AMOUNT_B_TO_SIGNER, decimalsB))
  );

  console.log("************ Create a pool");
  // const uniswapV3Factory = (await DeployerUtils.deployContract(signer, "UniswapV3Factory")) as UniswapV3Factory;
  const uniswapV3Factory = UniswapV3Factory__factory.connect(POOL_SPOOKY_SWAP_FACTORY, signer);
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    uniswapV3Factory.populateTransaction.createPool(
      poolSwapTokens ? tokenB.address : tokenA.address,
      poolSwapTokens ? tokenA.address : tokenB.address,
      fee
    )
  );
  const pool = await uniswapV3Factory.getPool(
    poolSwapTokens ? tokenB.address : tokenA.address,
    poolSwapTokens ? tokenA.address : tokenB.address,
    fee
  );
  console.log("************ Pool", pool);

  const sqrtPriceX96 = await UniswapV3Utils.getInitialSqrtPriceX96(
    parseUnits(AMOUNT_A_WIDE, decimalsA),
    parseUnits(AMOUNT_B_WIDE, decimalsB),
    poolSwapTokens
  );

  console.log("************ Initialize the pool, sqrtPriceX96", sqrtPriceX96);
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    UniswapV3Pool__factory.connect(pool, signer).populateTransaction.initialize(sqrtPriceX96)
  );

  console.log("************ Deploy uniswapV3Callee");
  const uniswapV3Callee = (await DeployerUtils.deployContract(signer, "UniswapV3Callee")) as UniswapV3Callee;
  const facadeUni = (await DeployerUtils.deployContract(signer, "UniswapV3LibFacade")) as UniswapV3LibFacade;

  console.log("************ putLiquidityToRangeWide");
  const r = await putLiquidityToRangeWide(
    signer,
    UniswapV3Pool__factory.connect(pool, signer),
    uniswapV3Callee,
    facadeUni,
    poolSwapTokens,
    ["0.01", "100"],
    sqrtPriceX96,
    parseUnits(AMOUNT_A_WIDE, decimalsA),
    parseUnits(AMOUNT_B_WIDE, decimalsB),
    tokenA,
    tokenB
  );

  console.log("************ Deploy token seller");
  const tokenSeller = await DeployTokenSellerUtils.deployTokenSeller(
    signer,
    tokenA.address,
    tokenB.address,
    pool,
    SIGNER_AMOUNT_A,
    tickRangeSize,
    thresholdRatio,
    thresholdLastRefreshPoolSec
  );

  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    tokenA.populateTransaction.mint(tokenSeller, parseUnits(AMOUNT_A_TO_TOKEN_SELLER, decimalsA))
  );
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    Univ3TokenSeller__factory.connect(tokenSeller, signer).populateTransaction.openPosition()
  );
  const isPositionOpened = await Univ3TokenSeller__factory.connect(tokenSeller, signer).isPositionOpened();
  const config = await Univ3TokenSeller__factory.connect(tokenSeller, signer).config();

  const slot0 = await UniswapV3Pool__factory.connect(pool, signer).slot0();
  const liquidity = await UniswapV3Pool__factory.connect(pool, signer).liquidity();

  writeFileSyncRestoreFolder(destPathTxt, `tokenA: ${tokenA.address}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `tokenB: ${tokenB.address}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `pool: ${pool}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `uniswapV3Callee: ${uniswapV3Callee.address}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `facadeUni: ${facadeUni.address}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `tokenSeller: ${tokenSeller}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `wide.lowerTick: ${r.lowerTick}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `wide.upperTick: ${r.upperTick}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `wide.liquidityAmount: ${r.liquidityAmount}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `slot0: ${slot0}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `liquidity: ${liquidity}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `Token seller position opened: ${isPositionOpened}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `Token seller config: ${config}\n`, { encoding: 'utf8', flag: 'a' });
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
