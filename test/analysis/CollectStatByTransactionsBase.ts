import {BASE_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {CaptureEvents, IEventsSet} from '../baseUT/strategies/CaptureEvents';
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import fs from "fs";
import {ethers} from "hardhat";
import {
  ConverterStrategyBase__factory,
  TetuVaultV2__factory
} from "../../typechain";
import {BaseAddresses} from "../../scripts/addresses/BaseAddresses";

describe("CollectStatByTransactionsBase @skip-on-coverage", () => {
  const TRANSACTIONS_AND_BLOCKS = [
    "0xf0bc8cfca2966995c6f53142a9a52db1fc3cffeebb4aa8d7e92d746cbc3e2de2","8466606","nsr",
    "0xfbdcf6b2c8b7807b4a64e9afcc4f927bd5a4a27d8b898cf0d7a199e5161e987a","8466649","hw",
    "0x118b024c62f50b6380d4f88c8f14c9c549d6ba2a41f8f6c2f212fc8210ebb898","8468123","nsr",
    "0x257f99315eb006a2ca252d4a186acf947ba6360d737f8ab303c8182f51950f11","8468448","wba",
    "0x92e0e8ff54463e0b66d233549635376f1c369832a2a12a39cc4d27b32925063a","8470039","nsr",
    "0xb72db7ba638e508afafa4e78da7e66f7d3912d4606ce4e05f994a8deb815dbac","8470375","wba",
    "0x8571e46004c3ff82614faaf834980980f6529e0e094265939bbb2dcc6cc7cea9","8472995","nsr",
    "0x0f770226125e835ef4eb98e275cbcc76f02e2c195b3d66c9fbefc378806de151","8473975","wba",
    "0x3426f811d86293fca1d6f862ffc1bfdb181e2de495d9f0c332acedad724da872","8475011","nsr",
    "0x2b677c29095c522c90e95ccd46e65aaa5d5712624776ca39a6e6f2f34d0b33cd","8475336","wba",
    "0xb9055ecac63f591be78c2775679a26113590c7751653ed93399f1b85d9796435","8479162","nsr",
    "0x044e0308d0f8bfdeab82c80e3a242d9bb46e8d56207cbf42820f4557ad23b13f","8480253","wba",
    "0x91b5d6b6d4b2ef16bb5ff4f18ccc37316ddfee5c31c760478be3e8ed70775bac","8481267","nsr",
    "0x87c7b429162c5b7639bb538f37b29cc414d4c9da120b69dc4fd15ef27186bf4c","8481280","wba",
    "0x37b5c5a3aece8fb15692283fc67126e4a38d2b26ad33b45281a2e24f331a6934","8481322","wba",
    "0xa25208b3749fdc9ab18732e35cd8d141490f0f8289f13cb40c01f8c4bd6b888c","8485239","nsr",
    "0xf5d0f9b8316c3caa8c31b10eb7a6ff94582f84e8c910249a1ce75cf85dbd21a6","8486251","nsr",
    "0x37cf762cc853a1e82438f5754107c480d4a5e2bfc3379929d059eb23f900cf21","8486468","hw",
    "0x1dfdb165d1e5b358df9887f89fcbb7ecfd35b11ca6e0d2a7c07b5ca82dfd6f0b","8486583","wba",
    "0xe64a7e2dd6110a96fabab272a04ebca5a98cff3dccf13e3fbab0a2acc6cf9ad3","8486868","wba",
    "0xdfca046ad9133a3eaaa94f5db1a82065b22c7dbd02d1af8a65f7e89cdb706cad","8486910","wba",
    "0xaf14467fea83f2767b774a3fcafeb7140c9687e66005346aee75352b9fd0ebc3","8498304","nsr",
    "0xd33fda81c6f6acd37c38fa03b4d63a0a9edd469e094f0eebcf2d52ca689d6fd3","8498630","wba",
    "0xd5dbb972cf267142c20e2220f43cb6224efea3e5b61ba618af2b817b817b4afd","8498894","wba",
    "0xa51d8275b6f136504e4da8c1283857d984548f154fa7d4a9a37ec5c36d2ad7e4","8498936","wba",
    "0x82aa63c8bfabfa19e2a3cb43035bf95bd843181600a1f99551603b6184889c25","8500397","nsr",
    "0x44e5a8767b634d74a8eef2c3a099c85c17d89f445b94c8114b02ca85c4320116","8500723","wba",
    "0x14d4d03f85b77c548106ab8ba2f8f7c873b2430bcb8954708c957458fa99dc57","8506290","hw",
    "0x84496ad7dad5426727bfd19e544006ea2ddb77c92353d6b065c4ecf4985d3c3a","8516579","nsr",
    "0x1e3c06b8f1b8ba92fe4035066837fe68f9302310b38c51e839f12e8fa60f99fd","8516905","wba",
    "0x7bcb097d217304beeaf820b54da88be0e64123191bb876ec8885bc72017d6f9a","8522556","nsr",
    "0xed7e751687db4a98e94e448abd362c0eaf6bb0ec20f50d8070d8c353b96d8d85","8522882","wba",
    "0xfad53999288db4066fbccacdc29a7f29a30cd1c25e87072d723b08f03a7c0151","8526094","hw",
    "0xa6c83e4f4288c334b202dc63a390335363f28f76a77f500253b43d4b5ade2472","8531487","nsr",
    "0xf50fd86dd1b81efda6f3352361cbda90b14ba7804917bbdbbc2d2bf51828ae86","8531814","wba",
    "0x1b7068b6346adb91f19cec3968edcf1f9b371aed6532a197bf6532aa3fb8d5c1","8534579","nsr",
    "0x837005dc23e073ce1280a8ba89b08b7f928ee2a051a6b8504496b7b9b0b91252","8534906","wba",
    "0x7849622da8bbf331995386779db925fb9ff634c24a12edadae35c5b8e49fd8cd","8534949","wba",
    "0x73836ae209edac2e06b92b496ea8ae076c0ce63263098c01d0259470d3c47cee","8538104","nsr",
    "0x4b3d2fde9dae855b435d4800f60025738b1f3029f32afd9c700c7a79da5262d2","8538431","wba",
    "0xc03a5e14dd0a2d77e617637c880d2598b87ddf73ad59f827a10853cce54aded1","8539995","nsr",
    "0x3cf996d0082a15ca1693f90eac2dbcb7caaf82344b899d8cbbe3a023870a6312","8540668","wba",
    "0x39921753991cd65eef8da6695057750c1a3ae9a0969ac86da5bee4890f5b0204","8540711","wba",
    "0xd42df24774058455c890f5a186e44f2a3161e83d2d0415a4e0a1a76210b2f65a","8543280","nsr",
    "0xe5fee9d17bbc2f6cecaf98eaa19456fc66af2d94e8524b8c8135d1c1e5b2fa21","8543607","wba",
    "0x0fc1520bc62c9fc5f0f284bfb3411da704378576a7bbc9c5a67488aa1140eb0e","8544753","nsr",
    "0xc31e00aef3b936fb257e51d98e2cb4a5786cd42b0423ee42b002d77ee2aee096","8545902","hw",
    "0xbf0664cb748253e804d290c92081809da4f2d6fae7d5ffa5ce821978434e5717","8554522","nsr",
    "0x9cc49be6bb462b82a3702f1b8b983247b45cda5f377732cf0d02dcc5949449e1","8554848","wba",
    "0x1fb49b60ed8908ca8bf87f2f8574ff5901f2fa1493db123bce48ec8760797c56","8555954","nsr",
    "0x7bb4a8f9b5347099d5ba275e8447d4743d7cab06467a50dfbefe3ccedb7ca93c","8565737","hw",
    "0x2cde05c2979af093bd60573d46b3488835c33c589f957a75b20488e317e987e1","8571253","nsr",
    "0x6a547333486589844bcaed48c5338bdd5d44864763b8ab0ce25f9236de86d311","8575180","nsr",
    "0xb29be114c31fc5413fb01ec2b322c720dc3cda82855d6a44d806d9a52d947849","8576399","nsr",
    "0x30141279a5fc55593c4cca6210307568cba0242fdf0272513094acfc07dd1cfc","8577412","nsr",
    "0xffb4c490815f69a2b2c070fbc5d65d6faa0c0f96ed15b26e5367aa28ac2e75a7","8582038","wba",
    "0x1ec8f3576e1495b84587572bb05d25db75e78ee783888e9d93f1868ed0fbf4e4","8585567","hw",
    "0x8e55aee731bddfa91d2466c7e3700f4e0bd093ee70ab765a2422c37bbf264381","8592341","nsr",
    "0xca814352c7ef08d5a84cb8f805ae4723c203bc19721b26584c18b07385abedc6","8597352","wba",
    "0x5d17bcb0ef4788134eb5eac26cec83e5e57d87201c544357b2a65ec34491e5e3","8597394","wba",
    "0x4f97a6abc429b27cb607d228a6ca9454f61000dff0afce40b26f24ab343ae138","8601872","nsr",
    "0x47eba5c6969a53aaaf80073d712ec278b2c9011c9cd01abe7b9cc4e177fcb526","8605386","hw",
    "0xcc3fd11ff369a402831968fdcceeb3c500cff90a55cedf6ef2f0026ea3fecc35","8615413","nsr",
    "0xf77e08d8e4c4c15af9902bf88f9990683f46b5a605007dee50cc58939e6af49b","8618832","nsr",
    "0x74fb60776dc7edaa98f9a85f6b6bd50d87515276313cc69311eb1f38f090a0ad","8618844","wba",
    "0xcc3499223e25f9724a1637a5846c681936c7f17c7088d1c195e4a92e807de92b","8618886","wba",
    "0xc1101d2302f92d8be031382af416b212d7b71d2577dfbff70dae54132bd36375","8625210","hw",
    "0xf67471d8c68693ccc65a9db67f2267e35bc6f75ac334a9876de16c074b33f7ee","8628842","nsr",


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
    const pathOut = "./tmp/base-statistics-by-txx.csv";
    const [signer] = await ethers.getSigners();
    const VAULT = "0x68f0a05FDc8773d9a5Fd1304ca411ACc234ce22c";
    const STRATEGY = "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e"; // usdbc-usdt
    // const STRATEGY = "0x32f7C3a5319A612C1992f021aa70510bc9F16161"; // usdbc-dai

    const states: IStateNum[] = [];

    if (fs.existsSync(pathOut)) {
      fs.rmSync(pathOut);
    }

    const converterStrategyBase = await ConverterStrategyBase__factory.connect(STRATEGY, signer);
    const vault = TetuVaultV2__factory.connect(VAULT, signer);

    const saver = async (title: string, e?: IEventsSet) => {
      const state = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, title, {eventsSet: e});
      states.push(state);
      StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: BaseAddresses.USDbC_TOKEN});
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

      await HardhatUtils.switchToBlock(block - 1, BASE_NETWORK_ID);
      await saver(`b:${i}`);

      const eventsSet = listEventsSets.get(block);

      await HardhatUtils.switchToBlock(block, BASE_NETWORK_ID);
      await saver(`a:${i}${prefix}`, eventsSet);
    }
  });
});