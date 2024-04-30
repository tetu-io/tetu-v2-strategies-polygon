import {parseUnits} from "ethers/lib/utils";
import {IERC20Metadata__factory, MockToken__factory, UniswapV3Callee__factory} from "../../typechain";
import {ethers, network} from "hardhat";
import {Misc} from "../utils/Misc";
import {RunHelper} from "../utils/RunHelper";

/**
 * npx hardhat run scripts/token-seller/MakeTestSwap.ts
 */
async function main() {
  const TOKEN_A = "0xF21ABFC5D68819EA0044fdB256d0AA854DC3034b";
  const TOKEN_B = "0xF992a90B4F2D59B65548bF9766a02ee8170E7F07";
  const POOL = "0x11aB7c23B6d05Aa08D69A1eD669Ad19f3eAC52d9";
  const UNISWAP_V3_CALEE = "0x848A49De3f59C62A337463f1D856Ad30FE85675e";

  const signer = (await ethers.getSigners())[0];
  // const signer = await Misc.impersonate("0xF1dCce3a6c321176C62b71c091E3165CC9C3816E");
  console.log("signer", signer.address);

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const swapTokenA = false;

  const tokenA = MockToken__factory.connect(TOKEN_A, signer);
  const tokenB = MockToken__factory.connect(TOKEN_B, signer);
  const uniswapV3Callee = UniswapV3Callee__factory.connect(UNISWAP_V3_CALEE, signer);

  const decimalsA = await tokenA.decimals();
  const decimalsB = await tokenB.decimals();

  const swapAmount = "1000";
  const amountToSwap = parseUnits(swapAmount, swapTokenA ? decimalsA : decimalsB);

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

  console.log("BalanceA", await tokenA.balanceOf(signer.address));
  console.log("BalanceB", await tokenB.balanceOf(signer.address));

  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    uniswapV3Callee.connect(signer).populateTransaction.swap(
      POOL,
      signer.address,
      swapTokenA ? tokenA.address : tokenB.address,
      amountToSwap
    )
  );

  console.log("BalanceA.after", await tokenA.balanceOf(signer.address));
  console.log("BalanceB.after", await tokenB.balanceOf(signer.address));

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
