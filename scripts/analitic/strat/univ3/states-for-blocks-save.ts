import hre, { ethers } from 'hardhat';
import {IState, Uniswapv3StateUtils} from "../../../../test/strategies/polygon/uniswapv3/utils/Uniswapv3StateUtils";
import {
  ISplitter__factory,
  TetuVaultV2__factory, UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory
} from "../../../../typechain";
import {Misc} from "../../../utils/Misc";
import fs from "fs";
import {MockHelper} from "../../../../test/baseUT/helpers/MockHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

const STRATEGY = '0xAe9842896507ba6D926E38BD1E560c3874B9a80c';
const USER = "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94";

const blocks = [
  // 41291000, // 9 apr 2023
  // 41294887,
  // 41298954,
  // 41311047,
  // 41329356,
  // 41336721,
  // 41338897,
  // 41352779,
  // 41358857,
  41374971, // 11 apr 2023
  41381882,
  41384214,
  41386913,
  41389478,
  41389510,
  41389540,
  41390750,
  41391213,
  41400812,
  41401353,
  41401720
];

async function getStateForBlock(
  signer: SignerWithAddress,
  block: number,
  strategy: UniswapV3ConverterStrategy,
  vault: string,
  prefix: string
) : Promise<IState> {
  await hre.network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.TETU_MATIC_RPC_URL,
          blockNumber: Number(block),
        },
      },
    ],
  });

  const facade = await MockHelper.createUniswapV3LibFacade(signer);
  return Uniswapv3StateUtils.getState(
    signer,
    await Misc.impersonate(USER),
    strategy,
    TetuVaultV2__factory.connect(vault, signer),
    facade,
    `${prefix}-${block.toString()}`,
  );
}

/**
 * to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/analitic/strat/univ3/states-for-blocks-save.ts
 */
async function main() {
  const pathOut = "./tmp/states.csv";
  const signer = (await ethers.getSigners())[0];

  const strategy = UniswapV3ConverterStrategy__factory.connect(STRATEGY, signer);
  console.log("strategy", strategy.address);

  const splitter = await strategy.splitter();
  console.log("splitter", splitter);

  const vault = await ISplitter__factory.connect(splitter, signer).vault();
  console.log("vault", vault);

  const states: IState[] = [];

  for (const block of blocks) {
    const blockPrev = block - 1;
    console.log("block", blockPrev);

    const statePrev = await getStateForBlock(signer, blockPrev, strategy, vault, "B");
    states.push(statePrev);

    const state = await getStateForBlock(signer, block, strategy, vault, "r");
    states.push(state);

    if (fs.existsSync(pathOut)) {
      fs.rmSync(pathOut);
    }
    await Uniswapv3StateUtils.saveListStatesToCSVColumns(pathOut, states);
  }

}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
