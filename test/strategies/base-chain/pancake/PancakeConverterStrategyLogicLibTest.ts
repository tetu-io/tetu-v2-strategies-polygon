import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BASE_NETWORK_ID, HardhatUtils} from "../../../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {
  IERC20Metadata__factory,
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
import {BigNumber} from "ethers";
import {IEventsSet} from "../../../baseUT/strategies/CaptureEvents";
import {StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import fs, {writeFileSync} from "fs";
import {writeFileSyncRestoreFolder} from "../../../baseUT/utils/FileUtils";

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
      title: string;
      tokenId: number;
      masterChefBalance: number;
      nftBalance: number;
      pendingCake: number;
      userUSDbCBalance: number;
      userUsdcBalance: number;
      totalLiquidity: BigNumber;
      positionLiquidity: BigNumber;
      positionTokensOwed0: number;
      positionTokensOwed1: number;
      retAmountUSDbC: number
      retAmountUsdc: number;
      retRewardsUSDbC: number
      retRewardsUsdc: number;
      retRewardsCAKE: number;
      retRewardsTokens: string;
      profitHolderCakeBalance: number;
      profitHolderUSDbCBalance: number;
      profitHolderUsdcBalance: number;
      facadeCakeBalance: number;
      facadeUSDbCBalance: number;
      facadeUsdcBalance: number;
    }
    interface ISaverParams {
      amounts?: BigNumber[];
      rewardAmounts?: BigNumber[]; // USDbC, USDC, CAKE
      rewardTokens?: string[];
    }
    async function getStatus(
      title: string,
      masterChef: IPancakeMasterChefV3,
      nft: IPancakeNonfungiblePositionManager,
      strategyProfitHolder: string,
      p?: ISaverParams
    ): Promise<IStatus> {
      const tokenId = (await facade.state()).tokenId.toNumber();
      return {
        title,
        tokenId,
        userUSDbCBalance: +formatUnits(await IERC20Metadata__factory.connect(BaseAddresses.USDbC_TOKEN, signer).balanceOf(facade.address), 6),
        userUsdcBalance: +formatUnits(await IERC20Metadata__factory.connect(BaseAddresses.USDC_TOKEN, signer).balanceOf(facade.address), 6),
        masterChefBalance: +formatUnits(await masterChef.balanceOf(facade.address), 0),
        nftBalance: +formatUnits(await nft.balanceOf(facade.address), 18),
        pendingCake: tokenId === 0
          ? 0
          : +formatUnits(await masterChef.pendingCake(tokenId), 18), // PANCAKE_SWAP_TOKEN.decimals = 18
        positionLiquidity: tokenId === 0
          ? BigNumber.from(0)
          : (await nft.positions(tokenId)).liquidity,
        positionTokensOwed0: tokenId === 0
          ? 0
          : +formatUnits((await nft.positions(tokenId)).tokensOwed0, 6),
        positionTokensOwed1: tokenId === 0
          ? 0
          : +formatUnits((await nft.positions(tokenId)).tokensOwed1, 6),
        totalLiquidity: (await facade.state()).pair.totalLiquidity,
        retAmountUSDbC: p?.amounts
          ? +formatUnits(p?.amounts[1], 6)
          : 0,
        retAmountUsdc: p?.amounts
          ? +formatUnits(p?.amounts[0], 6)
          : 0,
        retRewardsUSDbC: p?.rewardAmounts
          ? +formatUnits(p?.rewardAmounts[1], 6)
          : 0,
        retRewardsUsdc: p?.rewardAmounts
          ? +formatUnits(p?.rewardAmounts[0], 6)
          : 0,
        retRewardsCAKE: p?.rewardAmounts
          ? +formatUnits(p?.rewardAmounts[2], 18)
          : 0,
        retRewardsTokens: p?.rewardTokens
          ? (await Promise.all(p?.rewardTokens.map(
            async x => IERC20Metadata__factory.connect(x, signer).symbol()
          ))).join(",")
          : "",
        profitHolderCakeBalance: +formatUnits(await IERC20Metadata__factory.connect(BaseAddresses.PANCAKE_SWAP_TOKEN, signer).balanceOf(strategyProfitHolder), 18),
        profitHolderUSDbCBalance: +formatUnits(await IERC20Metadata__factory.connect(BaseAddresses.USDbC_TOKEN, signer).balanceOf(strategyProfitHolder), 6),
        profitHolderUsdcBalance: +formatUnits(await IERC20Metadata__factory.connect(BaseAddresses.USDC_TOKEN, signer).balanceOf(strategyProfitHolder), 6),
        facadeCakeBalance: +formatUnits(await IERC20Metadata__factory.connect(BaseAddresses.PANCAKE_SWAP_TOKEN, signer).balanceOf(facade.address), 18),
        facadeUSDbCBalance: +formatUnits(await IERC20Metadata__factory.connect(BaseAddresses.USDbC_TOKEN, signer).balanceOf(facade.address), 6),
        facadeUsdcBalance: +formatUnits(await IERC20Metadata__factory.connect(BaseAddresses.USDC_TOKEN, signer).balanceOf(facade.address), 6),
      }
    }

    async function waitForRewardsAndFees(multy: number) {
      const state = await PackedData.getDefaultState(
        IPairBasedDefaultStateProvider__factory.connect(facade.address, signer)
      );

      // wait to get rewards
      await TimeUtils.advanceNBlocks(20_000);
      console.log("------------------- wait for rewards, make swap to generate fee");
      await UniversalUtils.makePoolVolume(
        signer,
        state,
        BaseAddresses.TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER,
        parseUnits('10000', 6).mul(multy)
      );
    }

    async function saveToCSVColumns(pathOut: string, statuses: IStatus[]) {
      // console.log("saveListStatesToCSVColumns", states);
      const stateHeaders = [
        "title",
        "tokenId",
        "masterChefBalance",
        "nftBalance",
        "pendingCake",
        "userUSDbCBalance",
        "userUsdcBalance",
        "totalLiquidity",
        "positionLiquidity",
        "positionTokensOwed0",
        "positionTokensOwed1",
        "retAmountUSDbC",
        "retAmountUsdc",
        "retRewardsUSDbC",
        "retRewardsUsdc",
        "retRewardsCAKE",
        "profitHolderCakeBalance",
        "profitHolderUSDbCBalance",
        "profitHolderUsdcBalance",
        "facadeCakeBalance",
        "facadeUSDbCBalance",
        "facadeUsdcBalance"
      ];
      const headers = [
        '',
        ...statuses.map(x => x.title),
      ];
      const rows = statuses.map(item => [
        item.title,
        item.tokenId,
        item.masterChefBalance,
        item.nftBalance,
        item.pendingCake,
        item.userUSDbCBalance,
        item.userUsdcBalance,
        item.totalLiquidity,
        item.positionLiquidity,
        item.positionTokensOwed0,
        item.positionTokensOwed1,
        item.retAmountUSDbC,
        item.retAmountUsdc,
        item.retRewardsUSDbC,
        item.retRewardsUsdc,
        item.retRewardsCAKE,
        item.profitHolderCakeBalance,
        item.profitHolderUSDbCBalance,
        item.profitHolderUsdcBalance,
        item.facadeCakeBalance,
        item.facadeUSDbCBalance,
        item.facadeUsdcBalance
      ]);

      writeFileSyncRestoreFolder(pathOut, headers.join(';') + '\n', { encoding: 'utf8', flag: 'w'});
      for (let i = 0; i < stateHeaders.length; ++i) {
        const line = [stateHeaders[i], ...rows.map(x => x[i])];
        writeFileSync(
          pathOut,
          line.join(';') + '\n',
          { encoding: 'utf8', flag: 'a' },
        );
      }
    }

    it("enter, wait, get rewards, withdraw", async () => {
      const strategyProfitHolder = ethers.Wallet.createRandom().address;
      const facadePair = await MockHelper.createPairBasedStrategyLogicLibFacade(signer);
      const facadeDebtLib = (await DeployerUtils.deployContract(signer, 'PancakeDebtLibFacade')) as PancakeDebtLibFacade;

      const pool = IPancakeV3Pool__factory.connect(BaseAddresses.PANCAKE_POOL_USDC_USDbC_LP_100, signer);
      const token0 = await pool.token0();
      const token1 = await pool.token1();
      console.log("token0", await IERC20Metadata__factory.connect(token0, signer).symbol());
      console.log("token1", await IERC20Metadata__factory.connect(token1, signer).symbol());

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
      const amountUsdc = parseUnits("1000", 6);
      const amountUSDbC = amountUsdc.mul(props.prop1).div(props.prop0);
      console.log("desired amounts", +formatUnits(amountUsdc, 6), +formatUnits(amountUSDbC, 6));
      const amountUsdc2 = parseUnits("500", 6);
      const amountUSDbC2 = amountUsdc2.mul(props.prop1).div(props.prop0);
      console.log("desired amounts 2", +formatUnits(amountUsdc2, 6), +formatUnits(amountUSDbC2, 6));

      const pathOut = `./tmp/pancake-statuses.csv`;
      const statuses: IStatus[] = [];
      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }

      const saver = async (title: string, p?: ISaverParams): Promise<IStatus> => {
        statuses.push(await getStatus(title, masterChef, nft, strategyProfitHolder, p));
        console.log("status", title, statuses[statuses.length - 1]);
        saveToCSVColumns(pathOut, statuses);
        return statuses[statuses.length - 1];
      };


      console.log("----------------- get tokens on balance");
      await TokenUtils.getToken(BaseAddresses.USDC_TOKEN, facade.address, amountUsdc);
      await TokenUtils.getToken(BaseAddresses.USDbC_TOKEN, facade.address, amountUSDbC);

      await saver("b");

      await facade.initStrategyState(
        "0x255707B70BF90aa112006E1b07B9AeA6De021424",
        BaseAddresses.PANCAKE_POOL_USDC_USDbC_LP_100,
        0,
        0,
        BaseAddresses.USDC_TOKEN,
        [0, 0, Misc.MAX_UINT, 0],
        BaseAddresses.PANCAKE_MASTER_CHEF_V3
      );
      await facade.setStrategyProfitHolder(strategyProfitHolder);

      console.log("------------------- enter");
      const ret = await facade.callStatic.enter([amountUsdc, amountUSDbC]);
      await facade.enter([amountUsdc, amountUSDbC]);
      console.log("consumed amounts", +formatUnits(ret.amountsConsumed[0], 6), +formatUnits(ret.amountsConsumed[1], 6));

      await saver("enter1", {amounts: ret.amountsConsumed});

      await waitForRewardsAndFees(1);

      console.log("------------------- get tokens on balance 2");
      await TokenUtils.getToken(BaseAddresses.USDC_TOKEN, facade.address, amountUsdc2);
      await TokenUtils.getToken(BaseAddresses.USDbC_TOKEN, facade.address, amountUSDbC2);
      await saver("beforeEnter2");

      const ret2 = await facade.callStatic.enter([amountUsdc2, amountUSDbC2]);
      await facade.enter([amountUsdc2, amountUSDbC2]);
      console.log("consumed amounts", +formatUnits(ret2.amountsConsumed[0], 6), +formatUnits(ret2.amountsConsumed[1], 6));

      await saver("enter2", {amounts: ret2.amountsConsumed});

      await waitForRewardsAndFees(2);

      console.log("------------------- claim rewards and fees");
      const rewards1 = await facade.callStatic.claimRewards();
      await facade.claimRewards();
      for (let i = 0; i < rewards1.tokensOut.length; ++i) {
        const token = await IERC20Metadata__factory.connect(rewards1.tokensOut[i], signer)
        console.log("rewards", await token.symbol(), +formatUnits(rewards1.amountsOut[i], await token.decimals()));
      }
      await saver("claimRewards", {rewardTokens: rewards1.tokensOut, rewardAmounts: rewards1.amountsOut});

      await waitForRewardsAndFees(3);

      const statusBeforeExit1 = await saver("beforeExit1");
      console.log("------------------- exit 1");
      const retExit1 = await facade.callStatic.exit(statusBeforeExit1.totalLiquidity.div(2), false);
      await facade.exit(statusBeforeExit1.totalLiquidity.div(2), false);

      await saver("exit1", {amounts: retExit1});

      await waitForRewardsAndFees(4);
      const statusBeforeExit2 = await saver("beforeExit2");
      console.log("------------------- exit 2");
      const retExit2 = await facade.callStatic.exit(statusBeforeExit2.totalLiquidity, false);
      await facade.exit(statusBeforeExit2.totalLiquidity, false);

      await saver("exit2", {amounts: retExit2});
    });
  });
});
