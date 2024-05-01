import {formatUnits, parseUnits} from "ethers/lib/utils";
import {
  IERC20Metadata__factory,
  MockToken__factory,
  UniswapV3Callee__factory, UniswapV3Pool__factory,
  Univ3TokenSeller__factory
} from "../../typechain";
import {ethers, network} from "hardhat";
import {Misc} from "../utils/Misc";
import {RunHelper} from "../utils/RunHelper";

/**
 * npx hardhat run scripts/token-seller/GetStatus.ts
 */
async function main() {
  const TOKEN_A = "0xF21ABFC5D68819EA0044fdB256d0AA854DC3034b";
  const TOKEN_B = "0xF992a90B4F2D59B65548bF9766a02ee8170E7F07";
  const POOL = "0x11aB7c23B6d05Aa08D69A1eD669Ad19f3eAC52d9";
  const TOKEN_SELLER = "0x8E294388A3E91cdac5FEA95b5b75f509b85dC5E2";

  // const signer = (await ethers.getSigners())[0];
  const signer = await Misc.impersonate("0xF1dCce3a6c321176C62b71c091E3165CC9C3816E");
  console.log("signer", signer.address);

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const swapTokenA = false;

  const tokenA = MockToken__factory.connect(TOKEN_A, signer);
  const tokenB = MockToken__factory.connect(TOKEN_B, signer);

  const decimalsA = await tokenA.decimals();
  const decimalsB = await tokenB.decimals();

  const tokenSeller = Univ3TokenSeller__factory.connect(TOKEN_SELLER, signer);
  const pool = UniswapV3Pool__factory.connect(POOL, signer);
  const owner = await tokenSeller.owner();

  const state = await tokenSeller.state();
  const slot0 = await pool.slot0();
  const config = await tokenSeller.config();

  console.log("owner", owner);
  console.log("TokenSeller.config", config);
  console.log("TokenSeller.config.tickLimit", config.tickLimit);
  console.log("TokenSeller.state", state);

  console.log("Need to refresh", await tokenSeller.needToRefresh());
  console.log("BalanceA", +formatUnits(await tokenA.balanceOf(signer.address), decimalsA));
  console.log("BalanceB", +formatUnits(await tokenB.balanceOf(signer.address), decimalsB));
  console.log("TokenSeller.state.lowerTick", state.lowerTick);
  console.log("TokenSeller.state.upperTick", state.upperTick);
  console.log("slot0Before.tick", slot0.tick);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
