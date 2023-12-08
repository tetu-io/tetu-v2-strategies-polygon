import {BASE_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {CaptureEvents, IEventsSet} from '../baseUT/strategies/CaptureEvents';
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import fs from "fs";
import {ethers} from "hardhat";
import {
  ConverterStrategyBase__factory,
  IRebalancingV2Strategy__factory,
  StrategySplitterV2__factory,
  TetuVaultV2__factory
} from "../../typechain";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {InjectUtils} from "../baseUT/strategies/InjectUtils";

describe("Scb830 @skip-on-coverage", () => {
  // const TRANSACTIONS_AND_BLOCKS = [
  //   // "0x346e2725f491b77cf57584173bd0fa68aba384e6cd7c384c9a7ef177edd5084d",	"7305863",
  //   // "0x33d1564aa3314f45de73fcf16abf7fe8e448047fdbeaa89137921c3eba974a5e",	"7326857",
  //   "0x73600f50cfc40ffbbe6f62dde3f36134958529ff6ff7d72f6f7384d153537a9b",	"7346681",
  //   "0x59f5cec02aad2560b174644d53f16462a0b8ce5db6a7c54b1731c01ef1c09e30",	"7366507",
  //   "0xe4e27b98701c53beca34907d555c78b98c6a9521f241e8f01d7bdec107806d1a",	"7386310",
  //   "0x8937a3090b26b9d533756cab76ec35401625e0a9e40af8d8162a8f725221addb",	"7406124",
  //   "0x7710684cb44ecf2b3c100b7f499b08f2cbd99dc6b5668abb08ed3996d2306b54",	"7425947",
  //   "0x803b1a2b9a19dd9b200af6f113e53b99b114376274cabd50a7da2da1e0c200ca",	"7445782",
  //   "0xb4c5f686f1d0936b23fadda7659d93d9b065240186940e7cf58d737808ecc28c",	"7465592",
  //   "0x081527e5b5abb7c1568f6c1b44704375b6d94d8e32b604f83b5a2094f387b350",	"7485396",
  // ];

  const TRANSACTIONS_AND_BLOCKS = [
    "0x081527e5b5abb7c1568f6c1b44704375b6d94d8e32b604f83b5a2094f387b350","7485396","h",
    "0x92a15517c9f4cc55ff7a56d4fd42b82667b0357e6161c41b518a0e1e1999d421","7505226","h",
    "0x25144fb116d39604e97dc8442c8f54db67373f27676791f7bdf08b105ce47a29","7513322","",
    "0xce878baef0a84cafa2feed2ccbec3fb31c517c4d197a1d5e44d4849515754b4a","7513335","",
    "0xb71897188bfb894e212017b1747a1b14959e218b09292a5e49a404bfd77d43c8","7517665","",
    "0xc81c57980982e350016159ac34b2a7d6a59eda49b76e40ac076ff93d5a3d2bdd","7517679","",
    "0x0285ef43ba46757fa10b025e80039f1fe1f70141f2d80032200846fddee8e477","7525038","h",
    "0x0fa795a3ab2ce14f2b6649fd16bf44b06e76731889ad6dc6f9c8439ac6fb36d7","7539974","",
    "0xfea096b7167d02d3e9464c38307324b98e416259656fe47c9cb4cec446f95c4c","7539987","",
    "0xcee5a559cdf7101c4bb2053844cdd2c02c0d9f1d279d4c2fab3bf455fe4fdc2c","7541577","",
    "0xa69f7bcdf38402141f8f5287c4d98ee2b378abfa3148a112c4ae1a28c9344346","7541590","",
    "0x182f8b81e3b9279b44b0871873697a67f7edb11ff82a360772207bb1fbe0b703","7544868","h",
    "0x145bac6545598374880efc224837d715924cc33687e43c15a749766b51ed7a37","7552050","",
    "0xaa59ae50d4112a59449a34fa18c947f18829a1d7ed251985319fe0f18510e20c","7552063","",
    "0x30180f6d007ffe3fb09621393acf17cadff78ff1c1d77e598e31836337a11768","7564701",""
  ];

  let snapshotBefore: string;
  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID, -1);
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
    // const STRATEGY = "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e";
    const STRATEGY = "0x32f7C3a5319A612C1992f021aa70510bc9F16161";

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
      console.log(i);
      const block = Number(TRANSACTIONS_AND_BLOCKS[3 * i + 1]);
      const prefix = TRANSACTIONS_AND_BLOCKS[3 * i + 2];

      await HardhatUtils.switchToBlock(block - 1, BASE_NETWORK_ID);
      await saver(`b:${i}`);

      const eventsSet = listEventsSets.get(block);

      await HardhatUtils.switchToBlock(block, BASE_NETWORK_ID);
      await saver(`a:${i}${prefix}`, eventsSet);
    }
  });

  describe("do hardwork", () => {
    const BLOCK = 7564701;
    const STRATEGY = "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e";
    const pathOut = "./tmp/hardwork-scb862.csv";
    const OPERATOR = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

    it("doHardWork", async () => {
      const states: IStateNum[] = [];

      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }

      const saver = async (title: string, e?: IEventsSet) => {
        const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
        states.push(state);
        StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
      };

      // const signer = await DeployerUtilsLocal.impersonate(SENDER);
      const signer = (await ethers.getSigners())[0];
      await HardhatUtils.switchToBlock(BLOCK - 1, BASE_NETWORK_ID);
      // await HardhatUtils.switchToMostCurrentBlock();

      const operator = await DeployerUtilsLocal.impersonate(OPERATOR);

      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
      console.log(await converterStrategyBase.CONVERTER_STRATEGY_BASE_VERSION());

      const vault = TetuVaultV2__factory.connect(
        await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator)).vault(),
        signer
      );
      const splitter = await vault.splitter();

      await InjectUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
      console.log(await converterStrategyBase.CONVERTER_STRATEGY_BASE_VERSION());

      await saver("b");
      const strategyAsSplitter = converterStrategyBase.connect(await DeployerUtilsLocal.impersonate(splitter));
      const eventsSet = await CaptureEvents.makeHardworkInSplitter(strategyAsSplitter, operator);
      await saver("a", eventsSet);
    });
  });
});