import {BASE_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {CaptureEvents, IEventsSet} from '../baseUT/strategies/CaptureEvents';
import {IStateNum, StateUtilsNum} from "../baseUT/utils/StateUtilsNum";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import fs from "fs";
import {ethers} from "hardhat";
import {ConverterStrategyBase__factory, TetuVaultV2__factory} from "../../typechain";

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
    "0xa0158aea703ee626989cea449ff296907a9d3b03e37df410d61180098b3d3043", "7326807",
    "0x1d69a9c41a25ec0d726402c7d13f2d1cdfb052f16b89f73671f76d9c5f133dae", "7326820",
    "0x33d1564aa3314f45de73fcf16abf7fe8e448047fdbeaa89137921c3eba974a5e", "7326857",
    "0x30cbe38ed60c0f604e9636b6a979e51904dbedfb6a9a1dbf6d707eff48405c58", "7327832",
    "0xb48e13f3f55b9a94d78d18c8a7cf7bb0df35118befbeaceba21a290d345fbc88", "7327845",
    "0x5f23e4339515caae9dc16a252eeda00261eed77fd08c4c51200fc1bbd1ae640a", "7331574",
    "0x33a5843f2461ea19e1773ebb0d2381d55d07479e685f4f5946d8010c2edd9f01", "7331587",
    "0x609218b15040bb48223e9a9252f2b473bddf3c9dd60095b8920378463432dfd9", "7332624",
    "0xc9ed85dd1380802e86ec0005e9deac900f055b74ce566b939d710ec1dc467364", "7332637",
    "0x8bdf7ecf3c4060e0995299f7c22fda23f55f6d14dea77b2cb2667f7f2187b7c5", "7332679",
    "0x5aafb29cd3fca04cac3567e35065eeb8e3bc3f60725db82651a286be1f063bbc", "7342178",
    "0xaff81cf6fd34c39f1891a9d8da0e662905f70bd87ae6d05f5888029a5316a74d", "7342192",
    "0x19c9df2a3d710f0cbaa9b2743de50c9c36f9fb7823eb6baed6974731ac98caf8", "7342233",
    "0xdeca9586cdce6ff975e9f24227339a7a6bafd0351103fce2472e0c6ba1429dd0", "7344844",
    "0xc7bcf61325bd086fc487000cda5005911b74439993b91faf318260ba0b7d1c5a", "7344857",
    "0x73600f50cfc40ffbbe6f62dde3f36134958529ff6ff7d72f6f7384d153537a9b", "7346681",
    "0x2c8cf03f933e6663c9ef646a70284897456be42f258d534b88fb33bf01d98ea9", "7357488",
    "0x460a7bf778d6db1276b0e20b83fdfc183a1f122a9492cad53d24f0e8a65779c9", "7357499",
    "0x22cf9b3fef1d352bb6645b912c4ca6411f9e379b781f8eebf2ee535aef8670b9", "7357541",
    "0xd5b04e25a76dae7f5fcfef47d1f00af49b0cd4cf65aae48e6945323d57f17458", "7358646",
    "0xb0638dcd94930426cf5101c734d480024fc845178a8e67e3f4ca569082c25081", "7358660",
    "0xa3e4aa040f140ca301af377198f3f5983e8b0f3e7b80c9902e4f31bd2d3eb374", "7358701",
    "0xea833777b4250a92d9b88dc55b1838ae8f85e5e471c7eeac2e823e1456e2fefe", "7363932",
    "0xb3128dccb32aa4c552859dab3e1c1961ee5054973af81a42219bd3c81295e537", "7363945",
    "0x9ae89dc680c04f227a9c9a55638d28ff55f2d713192bfa8e405708b15d754b08", "7363985",
    "0x4dbe040a99082e874b2a292b65713d2d13e53c47e9197b4571a4497c92ddc826", "7363997",
    "0x3127c04bdb05973b42348244da88276f8542aac60a9e6ed0f060083e74158cf8", "7365037",
    "0x7e87fea66c7562d0323ac88e294256019745a7769f9b9481bddf2d0a2915ece8", "7365049",
    "0x9c562e01021d47b55a6436442d793893df675a88754cc7f281413b3fd0f0d938", "7365091",
    "0x59f5cec02aad2560b174644d53f16462a0b8ce5db6a7c54b1731c01ef1c09e30", "7366507",
    "0x30184ecb19bf187f435945fbe3c60a1f28d5391d8894b8aa276ea515fa51b951", "7381001",
    "0xbafcd5d75c4115949e309d46abaee2d49c353ff38b10b2ed93b5068a948f2001", "7381014",
    "0x37f84a63580c90a6a889077cc31e52ef78adf91e5238d878bfa6802651c9e261", "7381056",
    "0x3b8bb997f093d59e7684f75b8037f15bd75a803690b19ae370838611869cead8", "7384152",
    "0xd18be1d57e1456a085d8e6f445711b472622e3f0704317799124e621618a119a", "7384165",
    "0x4b5816d4ad1375eedf5362f4170b8565640c9dd29c0ec9eb61f5fa882bbab5b1", "7385472",
    "0xb425cccc6a857451a1826c32ab1fc177307f1703f0451cac8b15dcbd2c044869", "7385483",
    "0xe4e27b98701c53beca34907d555c78b98c6a9521f241e8f01d7bdec107806d1a", "7386310",
    "0xcf8de0433a223c7f5fc3316f4a77f7e165a46627d6013c9892b7818ae82a459a", "7388033",
    "0xd5ad25b22cf904908aace1c2b99a7b053d79c44411482b61de23ad32dfa24598", "7388047",
    "0xa010d1db53d39eec6e7c22045e9e019c0f9b6b38f5eae2b07e16f0a23e282391", "7388089",
    "0xefcc9e550cd17d32b4b9f8bc6250d2bd9ad0032d1beb804e8dd4b96aa4a732fa", "7390254",
    "0x7fae608ccbdc22c6b63ff6563f713d3c7d4a433f4916e5ec6b80313d00373324", "7390268",
    "0x9f5fa819ed32ba562d2c020d5871f5dac62b5bb7145b7c109e569638e31454eb", "7390308",
    "0x8937a3090b26b9d533756cab76ec35401625e0a9e40af8d8162a8f725221addb", "7406124",
    "0x16a019d17375f018153225ebeb5f5598fad96bb24cb5673f7a812d177bac2d62", "7412315",
    "0xc797fe1ef63be88cd600a2c8fc62c2b62572d4113eed7846d2592113066bf41d", "7412328",
    "0x6234ba617f9e52deef93312265f6dfbf5ee4696005e019cb3e90a7fda1dc36c1", "7416743",
    "0x494f60e3c19f8ea46ea11cf9525ca6c4212591114e77e8bd131a924f33545469", "7416756",
    "0x7710684cb44ecf2b3c100b7f499b08f2cbd99dc6b5668abb08ed3996d2306b54", "7425947",
    "0x8ff8f6d5d8eaa46c22229353b9ee3f629d950facfd8b4c47e5a42f63e51e4c78", "7426983",
    "0x3435231151f0c5e2108305983e3fd7d70203d25b98226c63255f4d898fce9c24", "7426996",
    "0x0c9769dc75bd2f5995f93c272d40c8028900523bceed1ff22ac33c8775059fbd", "7430499",
    "0xbd7a1ae586c5d2ce06970d7bd596d728dd43ffed3283102fdffaf25739dbbd46", "7430512",
    "0x6346d65686950185b995105a620532b8929ba4c02fa9fd5801653664e9fe9477", "7430555",
    "0x418870728f66e97f46124aa59e2b0b6a9693ca83473acca8e6bf62d5ce6e183a", "7432752",
    "0x2a3d753142556e24cfcfc9db034440ec9ed17ea85c749de83d444500a0c4dba5", "7432765",
    "0xae8b74fca06fd04cbaa3ac5642b0fc47990585f95d35a2966f72d70802b817e7", "7435340",
    "0xfb429095236cb4bdbcf57a488191cb8327441fab57998d55177e0eb030340ceb", "7435353",
    "0x803b1a2b9a19dd9b200af6f113e53b99b114376274cabd50a7da2da1e0c200ca", "7445782",
    "0x386f17c18c801a9f9a9369e1e5b68addea43202d05c28dd5562ea643e6d19dcf", "7446964",
    "0x53146f3b1617b30ea16e1063faeecead4d55268cc31d86fd63a263dbb3bb1125", "7446977",
    "0xebbb8eae7cab0db802aff27d5abd3bf8dabe6cd0d7dc6d24a6a38c160b4cb69a", "7457375",
    "0x424d0a8478218b9fcfa030434410476918d337e525721510ff85b3fc61d137f6", "7457387",
    "0x43d71b4393bd232fd5df78343fd71f12315e285610ba526ed65a86eb44563f40", "7457871",
    "0xb4c5f686f1d0936b23fadda7659d93d9b065240186940e7cf58d737808ecc28c", "7465592",
    "0x8c2b77afd71d7c4ff3e012f51d624abc2d5f9d3de33eaba50cc517a9746acbda", "7468214",
    "0xa431bdd45d6050eb894ed1395a401b292185be325a83c94dfb5d7a23be9fd76c", "7468228",
    "0xfbf653724985222233408f10d9435acea9f1a523a2bf77d4a1e29a264d878007", "7470121",
    "0x1db255cbf786f9803ab2c56703852b4c3636c6bd934fc3898a699503686dbee1", "7470135",
    "0x081527e5b5abb7c1568f6c1b44704375b6d94d8e32b604f83b5a2094f387b350", "7485396",
    "0x92a15517c9f4cc55ff7a56d4fd42b82667b0357e6161c41b518a0e1e1999d421", "7505226",
    "0x25144fb116d39604e97dc8442c8f54db67373f27676791f7bdf08b105ce47a29", "7513322",
    "0xce878baef0a84cafa2feed2ccbec3fb31c517c4d197a1d5e44d4849515754b4a", "7513335",
    "0xb71897188bfb894e212017b1747a1b14959e218b09292a5e49a404bfd77d43c8", "7517665",
    "0xc81c57980982e350016159ac34b2a7d6a59eda49b76e40ac076ff93d5a3d2bdd", "7517679",
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


    const listEventsSets = new Map<number, IEventsSet>();
    for (let i = 0; i < TRANSACTIONS_AND_BLOCKS.length / 2; ++i) {
      const tx = TRANSACTIONS_AND_BLOCKS[2 * i];
      const block = Number(TRANSACTIONS_AND_BLOCKS[2 * i + 1]);

      const receipt = await ethers.provider.getTransactionReceipt(tx);
      if (! receipt) console.log("no receipt");
      const eventsSet = await CaptureEvents.handleReceipt(signer, receipt, 6);
      listEventsSets.set(block, eventsSet);
    }

    for (let i = 0; i < TRANSACTIONS_AND_BLOCKS.length / 2; ++i) {
      console.log(i);
      const block = Number(TRANSACTIONS_AND_BLOCKS[2 * i + 1]);

      await HardhatUtils.switchToBlock(block - 1, BASE_NETWORK_ID);
      await saver(`b:${i}`);

      const eventsSet = listEventsSets.get(block);

      await HardhatUtils.switchToBlock(block, BASE_NETWORK_ID);
      await saver(`a:${i}`, eventsSet);
    }
  });
});