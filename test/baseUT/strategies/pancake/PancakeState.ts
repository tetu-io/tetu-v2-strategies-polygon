import {BigNumber} from "ethers";
import {
  IERC20Metadata__factory,
  IPancakeMasterChefV3,
  IPancakeNonfungiblePositionManager,
} from "../../../../typechain";
import {formatUnits} from "ethers/lib/utils";
import {writeFileSyncRestoreFolder} from "../../utils/FileUtils";
import {writeFileSync} from "fs";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  PairBasedStrategyLogicLib
} from "../../../../typechain/contracts/test/facades/pancake/PancakeConverterStrategyLogicLibFacade";

export interface IPancakeState {
  title: string;
  tokenId: number;
  masterChefBalance: number;
  nftBalance: number;
  pendingCake: number;
  userBalanceTokenB: number;
  userBalanceTokenA: number;
  totalLiquidity: BigNumber;
  positionLiquidity: BigNumber;
  positionTokensOwed0: number;
  positionTokensOwed1: number;
  retAmountTokenB: number
  retAmountTokenA: number;
  retRewardsTokenB: number
  retRewardsTokenA: number;
  retRewardsCAKE: number;
  retRewardsTokens: string;
  profitHolderCakeBalance: number;
  profitHolderBalanceTokenB: number;
  profitHolderBalanceTokenA: number;
  facadeCakeBalance: number;
  facadeBalanceTokenB: number;
  facadeBalanceTokenA: number;
}

export interface IPancakeStateInputParams {
  strategy: string,
  chef: IPancakeMasterChefV3;
  nft: IPancakeNonfungiblePositionManager;
  strategyProfitHolder: string;
  funcGetPairState: () => Promise< {
    pair: PairBasedStrategyLogicLib.PairStateStructOutput,
    tokenId: BigNumber,
    chef: string,
  }>;
  tokenA: string;
  tokenB: string;
  cakeToken: string;
  swapTokens: boolean;
}
export interface IPancakeSaverParams {
  amounts?: BigNumber[];
  rewardAmounts?: BigNumber[]; // USDbC, USDC, CAKE
  rewardTokens?: string[];
}

/**
 * Extract most important parameters of PancakeSwap-strategy to struct,
 * allow to save set of structs to CSV file
 */
export class PancakeState {
  static async getPancakeState(
    signer: SignerWithAddress,
    title: string,
    p: IPancakeStateInputParams,
    ps?: IPancakeSaverParams
  ): Promise<IPancakeState> {
    const index0 = p.swapTokens ? 1 : 0;
    const index1 = p.swapTokens ? 0 : 1;
    const tokenId = (await p.funcGetPairState()).tokenId.toNumber();
    return {
      title,
      tokenId,
      userBalanceTokenB: +formatUnits(await IERC20Metadata__factory.connect(p.tokenB, signer).balanceOf(p.strategy), 6),
      userBalanceTokenA: +formatUnits(await IERC20Metadata__factory.connect(p.tokenA, signer).balanceOf(p.strategy), 6),
      masterChefBalance: +formatUnits(await p.chef.balanceOf(p.strategy), 0),
      nftBalance: +formatUnits(await p.nft.balanceOf(p.strategy), 18),
      pendingCake: tokenId === 0
        ? 0
        : +formatUnits(await p.chef.pendingCake(tokenId), 18), // PANCAKE_SWAP_TOKEN.decimals = 18
      positionLiquidity: tokenId === 0
        ? BigNumber.from(0)
        : (await p.nft.positions(tokenId)).liquidity,
      positionTokensOwed0: tokenId === 0
        ? 0
        : +formatUnits((await p.nft.positions(tokenId)).tokensOwed0, 6),
      positionTokensOwed1: tokenId === 0
        ? 0
        : +formatUnits((await p.nft.positions(tokenId)).tokensOwed1, 6),
      totalLiquidity: (await p.funcGetPairState()).pair.totalLiquidity,
      retAmountTokenB: ps?.amounts
        ? +formatUnits(ps?.amounts[index1], 6)
        : 0,
      retAmountTokenA: ps?.amounts
        ? +formatUnits(ps?.amounts[index0], 6)
        : 0,
      retRewardsTokenB: ps?.rewardAmounts
        ? +formatUnits(ps?.rewardAmounts[index1], 6)
        : 0,
      retRewardsTokenA: ps?.rewardAmounts
        ? +formatUnits(ps?.rewardAmounts[index0], 6)
        : 0,
      retRewardsCAKE: ps?.rewardAmounts
        ? +formatUnits(ps?.rewardAmounts[2], 18)
        : 0,
      retRewardsTokens: ps?.rewardTokens
        ? (await Promise.all(ps?.rewardTokens.map(
          async x => IERC20Metadata__factory.connect(x, signer).symbol()
        ))).join(",")
        : "",
      profitHolderCakeBalance: +formatUnits(await IERC20Metadata__factory.connect(p.cakeToken, signer).balanceOf(p.strategyProfitHolder), 18),
      profitHolderBalanceTokenB: +formatUnits(await IERC20Metadata__factory.connect(p.tokenB, signer).balanceOf(p.strategyProfitHolder), 6),
      profitHolderBalanceTokenA: +formatUnits(await IERC20Metadata__factory.connect(p.tokenA, signer).balanceOf(p.strategyProfitHolder), 6),
      facadeCakeBalance: +formatUnits(await IERC20Metadata__factory.connect(p.cakeToken, signer).balanceOf(p.strategy), 18),
      facadeBalanceTokenB: +formatUnits(await IERC20Metadata__factory.connect(p.tokenB, signer).balanceOf(p.strategy), 6),
      facadeBalanceTokenA: +formatUnits(await IERC20Metadata__factory.connect(p.tokenA, signer).balanceOf(p.strategy), 6),
    }
  }

  static saveToCSVColumns(pathOut: string, statuses: IPancakeState[]) {
    // console.log("saveListStatesToCSVColumns", states);
    const stateHeaders = [
      "title",
      "tokenId",
      "masterChefBalance",
      "nftBalance",
      "pendingCake",
      "userBalanceTokenB",
      "userBalanceTokenA",
      "totalLiquidity",
      "positionLiquidity",
      "positionTokensOwed0",
      "positionTokensOwed1",
      "retAmountTokenB",
      "retAmountTokenA",
      "retRewardsTokenB",
      "retRewardsTokenA",
      "retRewardsCAKE",
      "profitHolderCakeBalance",
      "profitHolderBalanceTokenB",
      "profitHolderBalanceTokenA",
      "facadeCakeBalance",
      "facadeBalanceTokenB",
      "facadeBalanceTokenA"
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
      item.userBalanceTokenB,
      item.userBalanceTokenA,
      item.totalLiquidity,
      item.positionLiquidity,
      item.positionTokensOwed0,
      item.positionTokensOwed1,
      item.retAmountTokenB,
      item.retAmountTokenA,
      item.retRewardsTokenB,
      item.retRewardsTokenA,
      item.retRewardsCAKE,
      item.profitHolderCakeBalance,
      item.profitHolderBalanceTokenB,
      item.profitHolderBalanceTokenA,
      item.facadeCakeBalance,
      item.facadeBalanceTokenB,
      item.facadeBalanceTokenA
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

}
