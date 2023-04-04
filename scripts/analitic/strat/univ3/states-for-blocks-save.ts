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

const STRATEGY = '0x807a528818113a6f65b7667a59a4caaac719fc12';
const USER = "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94";

const blocks = [
  // 40864194,
  // 40864808,
  // 40865052,
  // 40865081,
  // 40865760,
  // 40868921,
  // 40869185,
  // 40869216,
  // 40871255,
  // 40871285,
  // 40871344,
  // 40873850,
  // 40874395,
  // 40874453,
  // 40874529,
  // 40874568,
  // 40877568,
  // 40879548,
  // 40881240,
  // 40882452,
  // 40882485,
  // 40884858,
  // 40890762,
  // 40890906,
  40894611,
  40899049,
  40899272,
  40902865,
  40908375,
  40932662,
  40936238,
  40937149,
  40937628,
  40951809,
  40959628,
  40970251,
  40990479,
  40990582,
  40990857,
  40992085,
  41007781,
  41011130,
  41058711,
  41070702,
  41073517,
  41073620,
  41073650,
  41087643,
  41093262,
  41099058,
  41105009,
  41107404,
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
