import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BASE_NETWORK_ID, HardhatUtils} from "../../../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {
  IERC20Metadata__factory,
  IPancakeMasterChefV3__factory, IPancakeNonfungiblePositionManager__factory,
  IPancakeV3Pool__factory,
  PancakeConverterStrategyLogicLibFacade, PancakeDebtLibFacade
} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";

describe('PancakeConverterStrategyLogicLibTest', function () {
  let snapshotBefore: string;
  let signer: SignerWithAddress;
  let facade: PancakeConverterStrategyLogicLibFacade;

  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();
    [signer] = await ethers.getSigners();

    facade = await DeployerUtils.deployContract(signer, "PancakeConverterStrategyLogicLibFacade") as PancakeConverterStrategyLogicLibFacade;
  })

  after(async function () {
    await HardhatUtils.restoreBlockFromEnv();
    await TimeUtils.rollback(snapshotBefore);
  });

  describe("typical user flow enter/exit", function () {
    it("enter, wait, get rewards, withdraw", async () => {
      const strategyProfitHolder = ethers.Wallet.createRandom().address;
      const facadePair = await MockHelper.createPairBasedStrategyLogicLibFacade(signer);
      const facadeDebtLib = (await DeployerUtils.deployContract(signer, 'PancakeDebtLibFacade')) as PancakeDebtLibFacade;

      const pool = IPancakeV3Pool__factory.connect(BaseAddresses.PANCAKE_POOL_USDC_USDbC, signer);
      const token0 = await pool.token0();
      const token1 = await pool.token1();

      const tickSpacing = await pool.tickSpacing();
      const currentTick = (await pool.slot0()).tick;
      const tickRange = 0; // todo

      console.log("tickSpacing", tickSpacing);
      console.log("currentTick", currentTick);
      console.log("tickRange", tickRange);

      const fee = await pool.fee();
      console.log("fee", fee);

      console.log("range");
      const range = await facadePair.calcTickRange(currentTick, tickRange, tickSpacing);
      console.log(range.lowerTick, range.upperTick);

      const masterChef = IPancakeMasterChefV3__factory.connect(BaseAddresses.PANCAKE_MASTER_CHEF_V3, signer);
      const nft = IPancakeNonfungiblePositionManager__factory.connect(BaseAddresses.PANCAKE_NONFUNGIBLE_POSITION_MANAGER, signer);

      console.log("proportions");
      const props = await facadeDebtLib.getEntryDataProportions(pool.address, range.lowerTick, range.upperTick, false);
      console.log(+formatUnits(props.prop0, 18), +formatUnits(props.prop1, 18));

      // USDC, USDbC = token0, token1
      const amountUsdc = parseUnits("1", 6);
      const amountUSDbC = amountUsdc.mul(props.prop1).div(props.prop0);
      console.log("desired amounts", +formatUnits(amountUsdc, 6), +formatUnits(amountUSDbC, 6));

      console.log("get tokens on balance");
      await TokenUtils.getToken(BaseAddresses.USDC_TOKEN, signer.address, amountUsdc);
      await TokenUtils.getToken(BaseAddresses.USDbC_TOKEN, signer.address, amountUSDbC);

      console.log("approve");
      await IERC20Metadata__factory.connect(BaseAddresses.USDC_TOKEN, signer).approve(nft.address, Misc.MAX_UINT);
      await IERC20Metadata__factory.connect(BaseAddresses.USDbC_TOKEN, signer).approve(nft.address, Misc.MAX_UINT);

      await facade.initStrategyState(
        "0x255707B70BF90aa112006E1b07B9AeA6De021424",
        BaseAddresses.PANCAKE_POOL_USDC_USDbC,
        0,
        0,
        BaseAddresses.USDC_TOKEN,
        [0, 0, Misc.MAX_UINT, 0]
      );

      console.log("enter");
      const ret = await facade.callStatic.enter([amountUsdc, amountUSDbC]);
      await facade.enter([amountUsdc, amountUSDbC]);
      console.log("consumed amounts", +formatUnits(ret.amountsConsumed[0], 6), +formatUnits(ret.amountsConsumed[1], 6));

    });
  });
});
