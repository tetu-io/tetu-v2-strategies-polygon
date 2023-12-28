import {BASE_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {
  PancakeDebtLibFacade,
  IPancakeMasterChefV3__factory,
  IPancakeNonfungiblePositionManager__factory,
  IPancakeV3Pool__factory, IERC20Metadata__factory,
} from "../../typechain";
import {BaseAddresses} from "../../scripts/addresses/BaseAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {MockHelper} from "../baseUT/helpers/MockHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../scripts/utils/TokenUtils";
import {Misc} from "../../scripts/utils/Misc";

describe("Scb863 @skip-on-coverage", () => {
  let snapshotBefore: string;
  let signer: SignerWithAddress;

  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();
    [signer] = await ethers.getSigners();
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
    await HardhatUtils.restoreBlockFromEnv();
  });

  it("Add liquidity to pancake, get rewards and fees, withdraw the liquidity back", async () => {
    const facade = await MockHelper.createPairBasedStrategyLogicLibFacade(signer);
    const facadeDebtLib = (await DeployerUtils.deployContract(signer, 'PancakeDebtLibFacade')) as PancakeDebtLibFacade;

    const pool = IPancakeV3Pool__factory.connect(BaseAddresses.PANCAKE_POOL_USDC_USDbC_LP_100, signer);
    const token0 = await pool.token0();
    const token1 = await pool.token1();

    const masterChef = IPancakeMasterChefV3__factory.connect(BaseAddresses.PANCAKE_MASTER_CHEF_V3, signer);

    const nft = IPancakeNonfungiblePositionManager__factory.connect(BaseAddresses.PANCAKE_NONFUNGIBLE_POSITION_MANAGER, signer);
    const fee = await pool.fee(); // The pool's fee in hundredths of a bip, i.e. 1e-6
    const tickSpacing = await pool.tickSpacing();
    const currentTick = (await pool.slot0()).tick;
    const tickRange = 0; // todo

    console.log("tickSpacing", tickSpacing);
    console.log("currentTick", currentTick);
    console.log("tickRange", tickRange);
    console.log("fee", fee);

    console.log("range");
    const range = await facade.calcTickRange(currentTick, tickRange, tickSpacing);
    console.log(range.lowerTick, range.upperTick);

    console.log("proportions");
    const props = await facadeDebtLib.getEntryDataProportions(pool.address, range.lowerTick, range.upperTick, false);
    console.log(+formatUnits(props.prop0, 18), +formatUnits(props.prop1, 18));

    // USDC, USDbC
    const amountUsdc = parseUnits("1", 6);
    const amountUSDbC = amountUsdc.mul(props.prop1).div(props.prop0);

    console.log("get tokens on balance");
    await TokenUtils.getToken(BaseAddresses.USDC_TOKEN, signer.address, amountUsdc);
    await TokenUtils.getToken(BaseAddresses.USDbC_TOKEN, signer.address, amountUSDbC);

    console.log("approve");
    await IERC20Metadata__factory.connect(BaseAddresses.USDC_TOKEN, signer).approve(nft.address, Misc.MAX_UINT);
    await IERC20Metadata__factory.connect(BaseAddresses.USDbC_TOKEN, signer).approve(nft.address, Misc.MAX_UINT);

    console.log("mint");
    await nft.mint({
      token0,
      token1,
      fee,
      tickLower: range.lowerTick,
      tickUpper: range.upperTick,
      amount0Desired: amountUsdc,
      amount1Desired: amountUSDbC,
      amount0Min: 0,
      amount1Min: 0,
      recipient: signer.address,
      deadline: 1e10
    });

    console.log("stake");

    console.log("harvest");

    console.log("unstake");

    console.log("withdraw");
  });
});