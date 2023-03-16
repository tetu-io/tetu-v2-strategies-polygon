// import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
// import {TimeUtils} from "../../scripts/utils/TimeUtils";
// import hre, {ethers} from "hardhat";
// import {MockHelper} from "../baseUT/helpers/MockHelper";
// import {
//   IERC20__factory, IUniswapV2Factory__factory, IUniswapV2Pair__factory,
//   IUniswapV2Router02__factory
// } from "../../typechain";
// import {PolygonAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon";
// import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
// import {parseUnits} from "ethers/lib/utils";
// import {expect} from "chai";
// import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
// import {MaticHolders} from "../../scripts/addresses/MaticHolders";
//
// describe('Uniswap2LibTest', function () {
//
// //region Global vars for all tests
//   let snapshot: string;
//   let snapshotForEach: string;
//   let deployer: SignerWithAddress;
// //endregion Global vars for all tests
//
// //region before, after
//   before(async function () {
//     this.timeout(1200000);
//     snapshot = await TimeUtils.snapshot();
//     const signers = await ethers.getSigners();
//     deployer = signers[0];
//   });
//
//   after(async function () {
//     await TimeUtils.rollback(snapshot);
//   });
//
//   beforeEach(async function () {
//     snapshotForEach = await TimeUtils.snapshot();
//   });
//
//   afterEach(async function () {
//     await TimeUtils.rollback(snapshotForEach);
//   });
// //endregion before, after
//
// //region Unit tests
//   describe("quoteRemoveLiquidity", () => {
//     describe("Compare withdrawn amounts with quoted ones", () => {
//       it("withdrawn amounts == quoted amounts", async () => {
//         const libFacade = await MockHelper.createUniswap2LibFacade(deployer);
//         const tokenA = PolygonAddresses.USDC_TOKEN;
//         const tokenB = PolygonAddresses.DAI_TOKEN;
//         const router = IUniswapV2Router02__factory.connect(MaticAddresses.QUICK_ROUTER, deployer);
//         const uniswapFactory = IUniswapV2Factory__factory.connect(await router.factory(), deployer);
//         const uniswapPair = IUniswapV2Pair__factory.connect(
//           await uniswapFactory.getPair(tokenA, tokenB),
//           deployer
//         );
//
//         // deposit some liquidity to the uniswap pair
//         const amountA = parseUnits("1000", 6);
//         const amountB = parseUnits("1000", 18);
//         await IERC20__factory.connect(
//           tokenA,
//           await DeployerUtilsLocal.impersonate(MaticHolders.HOLDER_USDC)
//         ).transfer(deployer.address, amountA);
//         await IERC20__factory.connect(
//           tokenB,
//           await DeployerUtilsLocal.impersonate(MaticHolders.HOLDER_DAI)
//         ).transfer(deployer.address, amountB);
//         await IERC20__factory.connect(tokenA, deployer).approve(router.address, amountA);
//         await IERC20__factory.connect(tokenB, deployer).approve(router.address, amountB);
//
//         const deadlineAdd = (await hre.ethers.provider.getBlock("latest")).timestamp + 10;
//         const retAdd = await router.callStatic.addLiquidity(tokenA, tokenB, amountA, amountB, 0, 0, deployer.address, deadlineAdd);
//         await router.addLiquidity(tokenA, tokenB, amountA, amountB, 0, 0, deployer.address, deadlineAdd);
//         console.log("addLiquidity results", retAdd);
//         console.log("liquidity balance", await uniswapPair.balanceOf(deployer.address));
//
//         // withdraw all the deposited liquidity
//         // predict amount that will be withdrawn
//         const quoted = await libFacade.quoteRemoveLiquidity(
//           router.address,
//           deployer.address,
//           tokenA,
//           tokenB,
//           retAdd.liquidity
//         );
//         console.log("quoteRemoveLiquidity results", quoted);
//
//         // withdraw all the deposited liquidity to receiver
//         const receiver = ethers.Wallet.createRandom().address;
//         const deadlineRemove = (await hre.ethers.provider.getBlock("latest")).timestamp + 10;
//         await uniswapPair.approve(router.address, retAdd.liquidity);
//         await router.removeLiquidity(
//           tokenA,
//           tokenB,
//           retAdd.liquidity,
//           0,
//           0,
//           receiver,
//           deadlineRemove
//         );
//
//         const balanceA = await IERC20__factory.connect(tokenA, deployer).balanceOf(receiver);
//         const balanceB = await IERC20__factory.connect(tokenB, deployer).balanceOf(receiver);
//
//         // compare results
//         const ret = [
//           quoted.amountAOut.toString(),
//           quoted.amountBOut.toString()
//         ].join();
//
//         const expected = [
//           balanceA.toString(),
//           balanceB.toString()
//         ].join();
//
//         console.log("ret", ret);
//         console.log("expected", expected);
//         expect(ret).eq(expected);
//       });
//     });
//   });
// //endregion Unit tests
// });
