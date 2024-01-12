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
    "0xbf7400c0dbe8fa32d70af1b9a78570c236a0e0216e39da75cc72b138b959c37c","51103641","wba",
    "0x1d199b4b9b7ac23d988b73f5fc74940ef3091007f86c54ce8e83c194501807a0","51125313","wba",
    "0x4c2e43bdc7dec5fd93f82466193c7cd81c63c803b474a7e52f70932fbba18939","51125358","wba",
    "0x8f93193722be2e29307f62b85b6e7524ef2aa04d144efcb109079f0e5998db7e","51136691","wba",
    "0xa2f953961763b7d8db0fb649474486cb7ad0d662ae00255fac452941fb1a607d","51136722","wba",
    "0xf838f05c70dd5fc325942c05c9bbba15a49d89bee20a6c5189494e2b80c19400","51151944","wba",
    "0x835d11cafcc724508216c498e9b369ec9398ed9a20a996855af15f51d205c691","51155994","wba",
    "0xea92594efdb6d133b3f313c59b08e03b79ee74fe8995927028c9e92f66e71dab","51159249","wba",
    "0xa66d1a75ca2daddfab3bb2710fdfc25f8f6a0dc029717ee94b7d7f7d6766966b","51159293","wba",
    "0x60e0bdd804bb1cf77aae9f2c2ffaf11edd1149c68cdadba211f71ecd51be01a6","51162390","wba",
    "0x250212fd12429d11ba330ba8a2989dd7459aa304d80db5f0c4f326feb43657ae","51168373","wba",
    "0xcce9b90ac6ade6b1354a0a5a3aebaed9b1c6e38fccee5398d5df37fc48290d06","51175260","wba",
    "0x3114fbd34b52c889410caba4bb8670d4bec089b8ea1abafdd2b781175a524afe","51176808","wba",
    "0xc384536ed2685969e1a6182ed365204ced72f383e6e6c72bfae3fbedae45b01d","51179171","wba",
    "0x6d221b411878e3816e968592bb472b1a53c0b7997fd22cd6819bea503534b97d","51180496","wba",
    "0xfd0363e939e9776305f4e4565d810035c4f46a15ce7303952acdc02387122140","51188673","wba",
    "0x83ad5d22787246c2e1e1f17bdc2f6eafa7c16dda6863fdbaaee67904b02fcb66","51194354","wba",
    "0x64bebe04a6c839d1a12e4c0f68aad8d1773e356a2bc463b36271465b0d6da567","51197607","wba",
    "0x99108bb625a816d6d4958232775f1de84273ec3d0e6ab978509562a9342a08ea","51202561","wba",
    "0x29f30ca8c33564cf28148d73bf98ffd939c07be44c199c02731984dcff639a23","51206565","wba",
    "0x4799e68676509f08bf449c68e8263355274e56c799d58072f255968980ed31e4","51208835","wba",
    "0x50159ce80a015d8023df1b421ec0ae99a6a284db6a008c11831644284068ef69","51211944","wba",
    "0x12cb3f74957d5572480336c9d3b83b2884ad69d361312cace4c4cc2506faf32e","51211988","wba",
    "0x3cb674c7e3ddae37217ece203406c69c15729b34cf28a0911bd40f452fc95cce","51212033","wba",
    "0xdf94794ecdb0e42f7c32deef366a40911279db8de976d84c0940e4190775635c","51220936","wba",
    "0x7092035e0c78311be7281eb796be172f96a72450b2de955957eafb9fa17e771a","51220974","wba",
    "0x8baaebfe0077ea7a3915640acf73ef5b39d83a996a23e88fbd3a8f4065b89dd6","51278756","wba",
    "0x380847aee9997ff4953e5da5d3b6b791f8d3be23d8a98d88f10f8eb31520fd65","51278797","wba",
    "0x395263e44860fa2aa6ad544e7f56b031b879ed217b7bb9d76f47638ad70eb0ac","51278840","wba",
    "0x2109364eaf3f828c8f86f60cf552f92c0e5ce9111176c2ce54fece9bf97ce1b2","51278883","wba",
    "0xe57548cdf8fbdfcc92b6e498762dabf400e144d06c3c78bb9c983e37c457ab40","51280713","wba",
    "0x7fdcbd59a669c8ca9d0bbc7401b5c8cba3eaf216fbd6c03a7864094822aff9b9","51286411","wba",
    "0x99a9dc79d82af845790d2d3fe713c7463c888d857bf34d2d16eeb3206dd1172c","51286454","wba",
    "0x57d2512b2b191204da668427737ecaf09ca889b6e2fc94947dcadd11851ac081","51296682","wba",
    "0x83ea99c3cb7a2b8879100ef087412ee8eee2c57545c50ffba5bfce0098f8747c","51322940","wba",
    "0x1ffd27a41dcb9f9e09253d4d430f0ab774a3182f86a687b1ae34f8edf30428eb","51322983","wba",
    "0x602198cc3676c9d46084e8d52d085bae887bc2141f561b3b430d65e8b2c0b3eb","51332070","wba",
    "0xa62a4e6ff7a6bc6ddf0703043ab42027a6e28d75595f8322f52d7b7484613920","51338131","wba",
    "0x0ee2f40709b9565ba8ddbf0ac77f802bf134aa0bd23503ba93d696944311e9e4","51338174","wba",
    "0xca44e1e79641e11440e02c60fa84dc3dba02b59fcd62484d38a391740bd635b7","51355575","wba",
    "0xbd64966228e5f04866a7a13e9e236fd5c1d02acb301c801dc244a20bf5054ab7","51355611","wba",
    "0x5ca2cc391562131aed809ad058555a2170ff97413ed70226c7ef1606e8544598","51369399","wba",
    "0xba9a59d3d8aef15ab5f74f850c34c7826c68cd83f4c0b532a7e6906d7d67bd02","51369443","wba",
    "0x76894e0687774a05066ec445b107bd203de4b6090c827377fac609a9d8e463d7","51385047","wba",
    "0xe3d85f594804d4d9c7e23d19720b4a8ddb060bdd5dd10cc3703902b82804c518","51408615","wba",
    "0xedc430a1af8e672c06603cb4e1866009d9e94606616c6e194f04924cf7be39ee","51408645","wba",
    "0x75b926fe0a4c8f258cc4a4e0431660450bf91bdb33c7a623cabf24dc805acd67","51420554","wba",
    "0x0fa51e12c6801b68152e2ecf26b7ffb5778a88012fdf568bc563bbbe18bcea05","51421902","wba",
    "0xbf41155fbdee33ea14cb07403e76bb39435fe28adfb842272083f8b6fc303578","51425182","wba",
    "0xe0ef50e8b49bd5e765f4ea657df06e432e1bf40eccd8990edb7da7cc1a04da7c","51427093","wba",
    "0x2907d4d3778c1c9e3235bb08bf95edb3b33f5890a4037a6d1ef29bb56c4080f8","51435884","wba",
    "0xf88d3700804596bee68a59a62ed6274a78215302d8195c6fa8d9f764cd4cfb15","51437271","wba",
    "0x7bb2c6b23c3d9f238bf28f440ff7ce68b99fa3921291d3e66ff503cd757f31d0","51440806","wba",
    "0x15ac25060d6cc9b5318443411d9fb349f9a31bbceaffb2f6f93901769c92225c","51440850","wba",
    "0x21547b4d67d6f0a09b1277684115346095b3d3f9eb7b5e726d46ccf8d6054e4b","51444703","wba",
    "0x14315e971f5d7adb4bfec172a4dbc1cc906cd6ed091c3c365f32d9e64e0dd450","51446463","wba",
    "0xa0084a6f4fb7a3f96bf91028568103fb30bc529ac8e87c18d7a35139cc7a3911","51446508","wba",
    "0xc1289362fbbfc29ce5d8bc4dab901f7b3069c7c84857d3f4512cfa4552d704a1","51449791","wba",
    "0xf922c544c46868c66de0a3f30f04a8c6d615ccd0c0feb2b17baec4082c9629b1","51457638","wba",
    "0xcddf1ed28cbb0f206c6e0f9a79c81751018c1c3437d987ba3c5d23363e4a917f","51463135","wba",
    "0xdb96f090ba2907277c90531915af90f5f58e72030c3d340dcb7c23ad1bc1f232","51469661","wba",
    "0x13e6d783487f5796f3ec5651d175c870da9ba4b6733e0c44351b78a5dc47a2db","51481031","wba",
    "0xf06ba943d057cf856cf81c0dcc4fee54f85904af0da65f1155e0757d0137da75","51481072","wba",
    "0x7efbf8c3cedd5cb7a58d60f45d65665390362b08e5c41b5fb1eb28944a4b0c8a","51483388","wba",
    "0x56a153a636974cb3de68c28538d717f9af193bee40838990834cda7685a16aa2","51488808","wba",
    "0x24dce12751f77e32b1617023c6da1c89344dd6c7f5a0cfadbbeadc199a82249f","51490262","wba",
    "0xccab4fe0743acb6bbe6c92d8c532579025998befaa16f434e7946bdf0f898f26","51490306","wba",
    "0xfcd184895971c8c01509ced2a99d13aaf0dc1c5b5065a1f5235ac4886a665886","51516693","wba",
    "0x4abb80c7cdab95fc20fabf350396be3a7dd33a376ea0e004ef36443be6adcf4b","51521991","wba",
    "0x0c0d025a90d4b1eb0fcb6389c822d01f999564cf0b090022a97b1648851b8631","51528209","wba",
    "0xf9be1a857ba1093b3570a806c818b4de4f2f33289b06c5f5bcb0e7846c42126e","51540076","wba",
    "0x1462f041efe5c3e77d47f5da10bf3eb547f23738b45ebf36b76db2e36afb2fbe","51557924","wba",
    "0x484211613a9cd095ba09eadd98224d1b9c2ed2efb41b630233498f7ae9dea062","51557955","wba",
    "0x0312876f3e7850995d772eb26791d0934b4fce3a186154f13ce54002c0b06a8c","51558001","wba",
    "0x388607166a2d5be14be83513200792fa95ab09d3a149c407807a3476530e9fd8","51570464","wba",
    "0x7ad439f1f0d76169aca4db0c95bcf2336ef0557480e0626178628c60e870a933","51571742","wba",
    "0x44c64a6b417edeb511799643d001f515881748beedecf6a32fcc75719889ef28","51573758","wba",
    "0x269924c97d118647942cc6339c2e9228ab15ba0ef309ee147ee37fed43c531f8","51581908","wba",
    "0x8e63e1f990e057479addcda7498980e623144d82edf26d9c0715e79c863761be","51584533","wba",
    "0x9bc2ccc843275a7a499bce35b33fe706a244a8f3f4876aa52a28aff486e60a02","51584577","wba",
    "0xb60ba6699103c313958de07e743d1d15480b1b93e9db524d0fdfc5f4d4a78d7d","51585892","wba",
    "0x412267744981d8a7cb2fee06593bbd820c9f76753aa24d107946df832c77f53c","51587341","wba",
    "0xc5f1c787a24ae155a5e579beabec7120c9d92cafe7d88745fe8fd640a13a715f","51587386","wba",
    "0x996d1ab2710d01f6faf451de03931c314c669715a65fa18f0e6482e8f8e9ddef","51587430","wba",
    "0x9b2aa95cd7127954f9074b6de563e019cc2deb6dd19f8f4978102c3d85ea171b","51587543","wba",
    "0x434f007da53de73526795765e7d64e4c4219cc86a99bea9365d0a1aca1cfac06","51587588","wba",
    "0x01a6b0af1dc47c2e35a125b0134e2013953ec84ba03c89306adc66df072a1b14","51588413","wba",
    "0x0c21af0683afdc4994f52d2b117f002ec74936e88d64d6f987c9baef866555c0","51589622","wba",
    "0x046270ab705d65a680f9e2cfd734e0554ccdb73b2e90f7a1871c0db40bd32dfc","51589666","wba",
    "0xe3b95441905bfea2a72316117e0d0751f3eec5392c8f70827504e42e8e2c2c21","51591469","wba",
    "0xc83f8f8c6ab77aafff5f9f75b04ce68699e40d9b373d33695167ca973ae03eca","51591514","wba",
    "0x772839c3e3e2a3d38d7c1caca59dd09557691c6d002c5d3ecbe97a2b0acdb624","51594406","wba",
    "0x868eab477ddf41ce9054e747eda791c30f6963d2cd906eab7861446c62291805","51594447","wba",
    "0xdd9d1d819e7a45133dca44a9919b3a356e69ca8e1ae2e914f498e9d704fd945f","51599782","wba",
    "0x4ed96933b573f77efd3b688a713d290f454a0fb5cd07a46616262c9e4e0d7b4e","51599825","wba",
    "0xf2040c5e6246dbf65a777af2e8131c9929e661fa936834ccd9a2fb94f7e8c3ee","51603342","wba",
    "0x71392ec3f51ab025619b20948c22aedb1728fb7b88f8b79036f967f6968dcd07","51605857","wba",
    "0x7c5f4f00769f322b1bd1e01d66027e633a292db6362ad36e064dcec604952281","51605901","wba",
    "0x5fee83a03add9efc2e00ade910c6abe4bbc7e42d176c87b0ee609ff983f569f9","51618191","wba",
    "0x679de25ccb86fb9e646642091ac0c5ebb020234e37fab53b3f388d11fd0e82ae","51619363","wba",
    "0x1bb03e0e990bc4fa031dca7510be5c978c76e4f7d48fd4a4305a4b914a49f3cb","51622709","wba",
    "0x29aead60cbdf35edfdede4f9a9e424ad465a372a35a082e3018039c1f47ad07d","51625717","wba",
    "0xbc1aa5842ce028c06d3fe36c27486ad9c60efe0ca4c0381f5d10fa2d89c61093","51627866","wba",
    "0x178b82ab41c0168f098041a48c19c9abce89f6210c323e65add70e994b781e93","51631192","wba",
    "0x52a610fc2ef6af713bbd1c1375d39fc6a6324b9ada570df5e20d1b66baf4f797","51634675","wba",
    "0x8d0f9c4f09d3991d2ff8637fb296446b6eab4797f877a7e6c2b136949b8ad6f0","51636353","wba",
    "0x37e10d518b175eb0f9d942acd8b96cccbe35e86132038868d634d970f954fca2","51636398","wba",
    "0x17b49d23852f44bbc1c4913ecd4b81b449441f165ebcdc4fcbccdc59b2496619","51638668","wba",
    "0xb776e03f99a03230545f402b2f8e33b4a07350136920d88881c9643eda66727f","51638712","wba",
    "0x0dc0ddb295ac441951a8be344e110e7288531476b5dfa64a319d84185a49f894","51641471","wba",
    "0x78258c860174f52b94f7d7b618032d8cc8cb7cf9171caf040e653b8b9099fffa","51648369","wba",
    "0x2676179aad66cad5284868f0f6a36bb390803367f3f72afc59e9623af09f42be","51651256","wba",
    "0x6f898724a2783706b7529373548b8ad996856679ef66b181f092af1735662ada","51654126","wba",
    "0x1e1824ab5782bcfbd5214c3ed31f5847e655d778070d7bde4c75da4ed041b401","51662269","wba",
    "0xadcff262f82a5cdc8cf724f959ca171bee406edacc2c995c18578a7941bef7da","51662313","wba",
    "0xa689f730702eec9c86b23d54d531999555e9fa32004d4056a7f1f2a3fe0be355","51675183","wba",
    "0x7d5aca77ed1654ad8d6c0440908b9f6abf53313a0ead0d80c6693013046bf2c2","51695972","wba",
    "0xf9d3ca2b1c205bf191a05638c102099cae22d8d973ee51ad77375c8f449d6015","51696019","wba",
    "0x42c11845bdc15107414b9add998fd628b02c570c3404a7a0371d6406efe49c88","51696064","wba",
    "0xfe72bd3c641b7f6d8199433ab2dea9bfeed3643484387e5366cc9eecc52d8a5a","51696109","wba",
    "0x3313ba925b0bc2e5ce2485ced85c719c7f9bdf7d160f88f296c52b7234b0e760","51706053","wba",
    "0x4d4aff0726f280536f491c5c9862fcd836868b76a355dc4b256bffb342d64d6d","51707440","wba",
    "0x9b95dd62ab1a89b37e58555a9a7d437ea4a405b3a89e28af7886c14cda63d6dd","51707485","wba",
    "0x271b0589b0a8558844e5edd029a866e088833fe6fdcce5084554fa4c837fc372","51707530","wba",
    "0x11b2933083508b1f8148c3278b42ccb7b8fca3ea597759671206a39d7336a730","51713874","wba",
    "0x5423957d21bd536a5e59a24d8a2d33351286dce251ff4bd3806402d43bba5daa","51713920","wba",
    "0x47f832ada4615a7558f0ceb2203273bcd2b319adc4833633b07937b1e9a0d102","51721069","wba",
    "0xaeb555b8a7b69ea6e233886f96b5015427b29297473a940bb0a6057565664371","51721112","wba",
    "0x964d5ab92d9d4c44ef09200fa2d5f68f9d2125eded90cb8ce2bbc45334385b0a","51721157","wba",
    "0x2009da137a01d8fa1216cbc993d69dfad8f04498acb8a7d073623089015b9827","51741495","wba",
    "0x8aa63870d31de27f0e499aaf5c97953ca75d82ea0c10c52b3a6d4f60444116d9","51749265","wba",
    "0x706a7454e75e9930b6e8c8d0a3100d0ee70d3c50619bb991e712db724e005684","51751478","wba",
    "0xfe694d1de010514500996e8651c6e61bacb215b67dc59297d0637192066d7302","51771386","wba",
    "0x99a50770fdf2004a3427577ef0e35cbe0f557ef2223fdb34a97a5f9ab2459f8c","51774214","wba",
    "0xfb8d71f2c78c751cd5dfcf18611df326d327fc01580445284c6d7a09117eb5b4","51774258","wba",
    "0x76228d1a0272ab6923db33f4d34ccf9d0c497065d9c9c92062391b89a54b9fdb","51777699","wba",
    "0x535a038b1713d899efec5133a83993a9aad3540eef9f7eb9cf83725fd89c3c7b","51778902","wba",
    "0x29f36a10b8d3edbab5b7477e40ebcf83c1b2ddd322ef02b66b501aefc12c0d1c","51778945","wba",

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