import hre, { ethers } from 'hardhat';
import {
  ISplitter__factory,
  TetuVaultV2__factory, UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory
} from "../../../../typechain";
import {Misc} from "../../../utils/Misc";
import fs from "fs";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IStateNum, StateUtilsNum} from "../../../../test/baseUT/utils/StateUtilsNum";
import {MaticAddresses} from "../../../addresses/MaticAddresses";

// const STRATEGY = '0x29ce0ca8d0A625Ebe1d0A2F94a2aC9Cc0f9948F1'; // dai
const STRATEGY = '0x05C7D307632a36D31D7eECbE4cC5Aa46D15fA752'; // usdt
const USER = "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94";

const blocks = [
  // 43906125,
  // 43907643,
  // 43908898,
  // 43910152,
  // 43911405,
  // 43912658,
  // 43913914
  // 43919173,
  // 43920427,
  // 43921680,
  // 43923003,
  // 43924257
  43925615,
  43926262,
  43926875,
  43927510,
  43928130,
];

async function getStateForBlock(
  signer: SignerWithAddress,
  block: number,
  strategy: UniswapV3ConverterStrategy,
  vault: string,
  prefix: string
) : Promise<IStateNum> {
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

  return StateUtilsNum.getState(
    signer,
    await Misc.impersonate(USER),
    strategy,
    TetuVaultV2__factory.connect(vault, signer),
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

  const states: IStateNum[] = [];

  for (const block of blocks) {
    const blockPrev = block - 1;
    console.log("block", blockPrev);

    // const statePrev = await getStateForBlock(signer, blockPrev, strategy, vault, "B");
    // states.push(statePrev);

    const state = await getStateForBlock(signer, block, strategy, vault, "r");
    states.push(state);

    if (fs.existsSync(pathOut)) {
      fs.rmSync(pathOut);
    }
    await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
  }

}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
