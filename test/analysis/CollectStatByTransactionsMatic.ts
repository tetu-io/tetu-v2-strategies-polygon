import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {CaptureEvents, IEventsSet} from '../baseUT/strategies/CaptureEvents';
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import fs from "fs";
import {ethers} from "hardhat";
import {
  ConverterStrategyBase__factory,
  TetuVaultV2__factory
} from "../../typechain";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";

describe("CollectStatByTransactionsBase @skip-on-coverage", () => {
  const TRANSACTIONS_AND_BLOCKS = [
    "0x037683a7d4b97e623bf446f21aa991f5db4d4a8737da24bb9a804e10d4d43d62","52957262","hwr",
    "0x102340a203df6419d2714a551772b2143fd1f33424513a4acdea5e9cfda8f683","52974436","hwr",
    "0x54d914a43a204c89503e09215c0d70507a0a7bcd74c9f3cbd78f4a42a4f5f17d","52992228","hwr",
    "0x2922f02b053bd4e7364b3d1cf437b948bdf87c34b2a6ad94efd66c354d36819c","53010497","hwr",
    "0xb1c6b3cc6e68e0603e3726979fb1a5ecac7c201e5c11bf650181e70e9144f94e","53027705","hwr",
    "0xdc497055f2d12fe5c48d3afb5d02c1bb0eab417c6b6273833e4ead921216bf4b","52946296","nsr",
    "0xad4a7b7b3bbf5761b9325f4dcec0f81cf65998ff1aabb41bd07c00b9ba807053","52947572","nsr",
    "0xf32ff3c8c18bc04a1427dc6f31e7aabbf0b7687496d00bf6f3cdac3aea16c12b","52950849","nsr",
    "0xdb2ca25517993823393d7010d9cc401793931c2e24873de0b4da9cd53b9dbe8f","52951132","wba",
    "0x8347080f8d9c534663a0c89f78fe74a94c7baac2e0da1bf5ca32e55d5fedb240","52954221","nsr",
    "0x9cc93870163e4e4b1f764f49505d38c92ca21bb4639d69349ac37202630e7445","52955186","nsr",
    "0x9cb77f4de112d85f1059a545f10d0fc2117bfb59d2b73b7b6da1bc6f9c4612a0","52955467","wba",
    "0xb886e754751a726e9341cfa66b2fe5831949d94daff54de7d173d6c99f7c552c","52962243","nsr",
    "0x7254d363753bea61f249ffd2c115225bc0df4ff0c0223fdfe40e09e32ce9556d","52962288","nsr",
    "0x62ba375563d315df0a20863a494f562a704d0a46a5d929d280f2ed6507e4f93b","52962576","wba",
    "0x52f00d8aed7212a03f407235a28785e6464b3b50cfe8e6e325779d55be206e97","52965824","nsr",
    "0x926d834f1332ca3f7bc8271396e175cb7ef78a0a11dd54f163b41cc6eec1a978","52967025","nsr",
    "0xf4beeaba4997131f09283c8387144fa63a13fcfbf9f61d90a53a8c393a0c3367","52967331","wba",
    "0xf71dc77bc04cb02e7a48dc9dbd4bad69962d06035c9b4b5c0ff36bc201d53602","52970628","nsr",
    "0xef69d8bb864fb3bcba382095e363ce3b3b68f1f2e67d57e944ef4ac02f03022f","52977291","nsr",
    "0x29356c622c401751a1588ee7c1dd60613bc863892a7de349d9f2cf2980a0d067","52979160","nsr",
    "0xce291ac3d8f52c1319117eeb79bae73d67bd744377272019a25bb65380c7fdbe","52979442","wba",
    "0x2f7b3930183761d5dd85136b3689e3eb97da15e91064315391254cc97f8a6583","52984869","nsr",
    "0x11e42da54e5367f01f6acab78b49e0dd93f3ca2ba66034a95b55c2b480d6a9df","52990164","nsr",
    "0xae1464d9e3b73f15a566e70e9852fbc0103c765323d58cedb5e034dc9b6e5647","52993127","nsr",
    "0x93b25052f3438f20f3c7b64dfe861a35c4472017057fdbf4ce755994e84c4d9f","52993137","wba",
    "0x48cee1a865101973b06173e87b133b51a13ba0b8ed94b3bfae0c85da702718b3","52993178","wba",
    "0xfc4f5c813897fa8eb3a5cc0925dfaeb3fb013a63b05dcc7d37bc949fc5e65952","53003475","nsr",
    "0x1d8b8cac4325acc1b1c9ba00735b679da5704c0a5a8f9624c053288109824c25","53005762","nsr",
    "0x0e4c64aacff34c517198a53761053da492a1fe5d6d3d6e71ad3ca24ccb7ee1ce","53006322","wba",
    "0x4476aa1d176bfd159350d319444079a2da512e525ea1a05ec9d5bd9e8911b438","53006364","wba",
    "0x948888bedc93cd75c1169f6333b2a637f680bd87e69387170f9f799a94a4e6b5","53010456","nsr",
    "0xd439652316a8c58c3d08d76d68be934db6a2e2f2afb3b014eee55358431fd7de","53012773","nsr",
    "0x94c9c2a2e0b8a6237c499ba9b2d9a1680e6b6cae59a3107c94b54685818cb784","53014084","nsr",
    "0xc2ce8296529153ed4c700f2dea03620052d8f9e11cef1368f4ec019538e46d6d","53015034","nsr",
    "0xb6091feee883fc9db6a1421fa05219538063784d66cd566a7916ddd2fd5d5839","53016417","nsr",
    "0x742ff2673bcdfb8c794cb2c98e874d2c1cbf44e5c6ae443cc799d6994ddc4a73","53016714","wba",
    "0x9b2a58f022cee6d0790bbe0e32fe6afcd5507c7e387fc884c50e1ec28d81705c","53027672","nsr",
    "0x18ac27c0140fadafcc2a162ac93b55c2e1b2d80b80fedf6c87cedbed7c4036ea","53028602","nsr",

  ];

  let snapshotBefore: string;
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID, -1);
    snapshotBefore = await TimeUtils.snapshot();
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
    await HardhatUtils.restoreBlockFromEnv();
  });

  it("should save statistics", async () => {
    const pathOut = "./tmp/matic-statistics-by-txx.csv";
    const [signer] = await ethers.getSigners();
    const VAULT = "0x0D397F4515007AE4822703b74b9922508837A04E";
    const STRATEGY = "0xCdc5560AB926Dca3d4989bF814469Af3f989Ab2C";

    const states: IStateNum[] = [];

    if (fs.existsSync(pathOut)) {
      fs.rmSync(pathOut);
    }

    const converterStrategyBase = await ConverterStrategyBase__factory.connect(STRATEGY, signer);
    const vault = TetuVaultV2__factory.connect(VAULT, signer);

    const saver = async (title: string, e?: IEventsSet) => {
      const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
      states.push(state);
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
    };


    const listEventsSets = new Map<number, IEventsSet>();
    for (let i = 0; i < TRANSACTIONS_AND_BLOCKS.length / 3; ++i) {
      const tx = TRANSACTIONS_AND_BLOCKS[3 * i];
      const block = Number(TRANSACTIONS_AND_BLOCKS[3 * i + 1]);

      const receipt = await ethers.provider.getTransactionReceipt(tx);
      if (! receipt) console.log("no receipt");
      const eventsSet = await CaptureEvents.handleReceipt(signer, receipt, 6);
      listEventsSets.set(block, eventsSet);
    }

    for (let i = 0; i < TRANSACTIONS_AND_BLOCKS.length / 3; ++i) {
      const block = Number(TRANSACTIONS_AND_BLOCKS[3 * i + 1]);
      console.log(i, block);
      const prefix = TRANSACTIONS_AND_BLOCKS[3 * i + 2];

      await HardhatUtils.switchToBlock(block - 1, POLYGON_NETWORK_ID);
      await saver(`b:${i}`);

      const eventsSet = listEventsSets.get(block);

      await HardhatUtils.switchToBlock(block, POLYGON_NETWORK_ID);
      await saver(`a:${i}${prefix}`, eventsSet);
    }
  });
});