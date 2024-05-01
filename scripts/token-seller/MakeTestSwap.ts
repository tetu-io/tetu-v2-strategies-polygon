import {formatUnits, parseUnits} from "ethers/lib/utils";
import {
  MockToken__factory,
  UniswapV3Callee__factory, UniswapV3Pool__factory,
  Univ3TokenSeller__factory
} from "../../typechain";
import {ethers, network} from "hardhat";
import {RunHelper} from "../utils/RunHelper";
import {Misc} from "../utils/Misc";

/**
 * npx hardhat run scripts/token-seller/MakeTestSwap.ts
 */
async function main() {
  const TOKEN_A = "0xF21ABFC5D68819EA0044fdB256d0AA854DC3034b";
  const TOKEN_B = "0xF992a90B4F2D59B65548bF9766a02ee8170E7F07";
  const POOL = "0x11aB7c23B6d05Aa08D69A1eD669Ad19f3eAC52d9";
  const UNISWAP_V3_CALEE = "0x848A49De3f59C62A337463f1D856Ad30FE85675e";
  const TOKEN_SELLER = "0x8E294388A3E91cdac5FEA95b5b75f509b85dC5E2";

  const signer = (await ethers.getSigners())[0];
  // const signer = await Misc.impersonate("0xF1dCce3a6c321176C62b71c091E3165CC9C3816E");
  console.log("signer", signer.address);

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const tokenA = MockToken__factory.connect(TOKEN_A, signer);
  const tokenB = MockToken__factory.connect(TOKEN_B, signer);
  const uniswapV3Callee = UniswapV3Callee__factory.connect(UNISWAP_V3_CALEE, signer);
  const tokenSeller = Univ3TokenSeller__factory.connect(TOKEN_SELLER, signer);
  const pool = UniswapV3Pool__factory.connect(POOL, signer);

  const decimalsA = await tokenA.decimals();
  const decimalsB = await tokenB.decimals();

  const swapTokenA = true;
  const swapAmount = "2000000";
  const amountToSwap = parseUnits(swapAmount, swapTokenA ? decimalsA : decimalsB);

  // await RunHelper.runAndWait2ExplicitSigner(
  //   signer,
  //   tokenB.connect(signer).populateTransaction.mint(signer.address, amountToSwap)
  // )
  // return

  if (swapTokenA) {
    await RunHelper.runAndWait2ExplicitSigner(
      signer,
      tokenA.connect(signer).populateTransaction.approve(uniswapV3Callee.address, amountToSwap)
    )
  } else {
    await RunHelper.runAndWait2ExplicitSigner(
      signer,
      tokenB.connect(signer).populateTransaction.approve(uniswapV3Callee.address, amountToSwap)
    );
  }

  const stateBefore = await tokenSeller.state();
  const slot0Before = await pool.slot0();
  const balanceABefore = +formatUnits(await tokenA.balanceOf(signer.address), decimalsA);
  const balanceBBefore = +formatUnits(await tokenB.balanceOf(signer.address), decimalsB);

  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    uniswapV3Callee.connect(signer).populateTransaction.swap(
      POOL,
      signer.address,
      swapTokenA ? tokenA.address : tokenB.address,
      amountToSwap
    )
  );

  const stateAfter = await tokenSeller.state();
  const slot0After = await pool.slot0();

  console.log("BalanceA", balanceABefore);
  console.log("BalanceB", balanceBBefore);
  console.log("stateBefore.lowerTick", stateBefore.lowerTick);
  console.log("stateBefore.upperTick", stateBefore.upperTick);
  console.log("slot0Before.tick", slot0Before.tick);

  console.log("BalanceA.after", +formatUnits(await tokenA.balanceOf(signer.address), decimalsA));
  console.log("BalanceB.after", +formatUnits(await tokenB.balanceOf(signer.address), decimalsB));
  console.log("stateAfter.lowerTick", stateAfter.lowerTick);
  console.log("stateAfter.upperTick", stateAfter.upperTick);
  console.log("slot0After.tick", slot0After.tick);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
