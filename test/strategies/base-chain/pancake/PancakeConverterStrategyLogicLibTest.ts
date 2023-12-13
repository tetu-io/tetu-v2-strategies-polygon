import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BASE_NETWORK_ID, HardhatUtils} from "../../../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {
  IERC20Metadata__factory,
  IPairBasedDefaultStateProvider,
  IPairBasedDefaultStateProvider__factory,
  IPancakeMasterChefV3,
  IPancakeMasterChefV3__factory,
  IPancakeNonfungiblePositionManager,
  IPancakeNonfungiblePositionManager__factory,
  IPancakeV3Pool__factory,
  PancakeConverterStrategyLogicLibFacade,
  PancakeDebtLibFacade
} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {UniversalUtils} from "../../../baseUT/strategies/UniversalUtils";
import {PackedData} from "../../../baseUT/utils/PackedData";

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

  describe("typical user flow: enter/exit", function () {
    interface IStatus {
      tokenId: number;
      masterChefBalance: number;
      nftBalance: number;
      pendingCake: number;
      positionLiquidity: number;
      userUSDbCBalance: number;
      userUsdcBalance: number;
    }
    async function getStatus(masterChef: IPancakeMasterChefV3, nft: IPancakeNonfungiblePositionManager): Promise<IStatus> {
      const tokenId = (await facade.state()).tokenId.toNumber();
      return {
        tokenId,
        userUSDbCBalance: +formatUnits(await IERC20Metadata__factory.connect(BaseAddresses.USDbC_TOKEN, signer).balanceOf(facade.address), 6),
        userUsdcBalance: +formatUnits(await IERC20Metadata__factory.connect(BaseAddresses.USDC_TOKEN, signer).balanceOf(facade.address), 6),
        masterChefBalance: +formatUnits(await masterChef.balanceOf(facade.address), 0),
        nftBalance: +formatUnits(await nft.balanceOf(facade.address), 18),
        pendingCake: tokenId === 0
          ? 0
          : +formatUnits(await masterChef.pendingCake(tokenId), 18), // todo decimals of CAKE
        positionLiquidity: tokenId === 0
          ? 0
          : +formatUnits((await nft.positions(tokenId)).liquidity, 6), // todo decimals of liquidity
      }
    }

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
      const amountUsdc = parseUnits("100", 6);
      const amountUSDbC = amountUsdc.mul(props.prop1).div(props.prop0);
      console.log("desired amounts", +formatUnits(amountUsdc, 6), +formatUnits(amountUSDbC, 6));

      console.log("get tokens on balance");
      await TokenUtils.getToken(BaseAddresses.USDC_TOKEN, facade.address, amountUsdc);
      await TokenUtils.getToken(BaseAddresses.USDbC_TOKEN, facade.address, amountUSDbC);

      console.log("Status0", await getStatus(masterChef, nft));

      await facade.initStrategyState(
        "0x255707B70BF90aa112006E1b07B9AeA6De021424",
        BaseAddresses.PANCAKE_POOL_USDC_USDbC,
        0,
        0,
        BaseAddresses.USDC_TOKEN,
        [0, 0, Misc.MAX_UINT, 0],
        BaseAddresses.PANCAKE_MASTER_CHEF_V3
      );
      await facade.setStrategyProfitHolder(strategyProfitHolder);

      console.log("enter");
      const ret = await facade.callStatic.enter([amountUsdc, amountUSDbC]);
      await facade.enter([amountUsdc, amountUSDbC]);
      console.log("consumed amounts", +formatUnits(ret.amountsConsumed[0], 6), +formatUnits(ret.amountsConsumed[1], 6));

      console.log("Status.after.deposit1", await getStatus(masterChef, nft));

      await TimeUtils.advanceNBlocks(20_000);
      console.log("Status.after.waiting", await getStatus(masterChef, nft));

      console.log("get tokens on balance 2");
      await TokenUtils.getToken(BaseAddresses.USDC_TOKEN, facade.address, amountUsdc);
      await TokenUtils.getToken(BaseAddresses.USDbC_TOKEN, facade.address, amountUSDbC);

      const ret2 = await facade.callStatic.enter([amountUsdc, amountUSDbC]);
      await facade.enter([amountUsdc, amountUSDbC]);
      console.log("consumed amounts", +formatUnits(ret2.amountsConsumed[0], 6), +formatUnits(ret2.amountsConsumed[1], 6));

      console.log("Status.after.deposit2", await getStatus(masterChef, nft));

      // make swap in the pool to get fee
      const state = await PackedData.getDefaultState(
        IPairBasedDefaultStateProvider__factory.connect(facade.address, signer)
      );
      // todo: use Pancake3Swapper: await UniversalUtils.makePoolVolume(signer, state, BaseAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER, parseUnits('10000', 6));

      console.log("Status.after.makePoolVolume", await getStatus(masterChef, nft));

      // claim rewards and fees
      const rewards1 = await facade.callStatic.claimRewards();
      await facade.claimRewards();
      for (let i = 0; i < rewards1.tokensOut.length; ++i) {
        const token = await IERC20Metadata__factory.connect(rewards1.tokensOut[i], signer)
        console.log("rewards", await token.symbol(), +formatUnits(rewards1.amountsOut[i], await token.decimals()));
      }
    });
  });
});
