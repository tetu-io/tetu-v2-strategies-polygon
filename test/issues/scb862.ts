import {BASE_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {IEventsSet} from "../baseUT/strategies/CaptureEvents";
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import fs from "fs";
import {ethers} from "hardhat";
import {ConverterStrategyBase__factory, TetuVaultV2__factory} from "../../typechain";

describe("Scb830 @skip-on-coverage", () => {
  const TRANSACTIONS_AND_BLOCKS = [
    // "0x346e2725f491b77cf57584173bd0fa68aba384e6cd7c384c9a7ef177edd5084d",	"7305863",
    // "0x33d1564aa3314f45de73fcf16abf7fe8e448047fdbeaa89137921c3eba974a5e",	"7326857",
    "0x73600f50cfc40ffbbe6f62dde3f36134958529ff6ff7d72f6f7384d153537a9b",	"7346681",
    "0x59f5cec02aad2560b174644d53f16462a0b8ce5db6a7c54b1731c01ef1c09e30",	"7366507",
    "0xe4e27b98701c53beca34907d555c78b98c6a9521f241e8f01d7bdec107806d1a",	"7386310",
    "0x8937a3090b26b9d533756cab76ec35401625e0a9e40af8d8162a8f725221addb",	"7406124",
    "0x7710684cb44ecf2b3c100b7f499b08f2cbd99dc6b5668abb08ed3996d2306b54",	"7425947",
    "0x803b1a2b9a19dd9b200af6f113e53b99b114376274cabd50a7da2da1e0c200ca",	"7445782",
    "0xb4c5f686f1d0936b23fadda7659d93d9b065240186940e7cf58d737808ecc28c",	"7465592",
    "0x081527e5b5abb7c1568f6c1b44704375b6d94d8e32b604f83b5a2094f387b350",	"7485396",
  ];

  let snapshotBefore: string;
  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    snapshotBefore = await TimeUtils.snapshot();
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
    await HardhatUtils.restoreBlockFromEnv();
  });

  it("should save statistics", async () => {
    const pathOut = "./tmp/scb-830.csv";
    const [signer] = await ethers.getSigners();
    const VAULT = "0x68f0a05FDc8773d9a5Fd1304ca411ACc234ce22c";
    const STRATEGY = "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e";

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

    for (let i = 0; i < TRANSACTIONS_AND_BLOCKS.length / 2; ++i) {
      console.log(i);
      const tx = TRANSACTIONS_AND_BLOCKS[2 * i];
      const block = Number(TRANSACTIONS_AND_BLOCKS[2 * i + 1]);

      await HardhatUtils.switchToBlock(block - 1, BASE_NETWORK_ID);
      await saver(`b:${i}`);

      await HardhatUtils.switchToBlock(block, BASE_NETWORK_ID);
      await saver(`a:${i}`);
    }
  });
});