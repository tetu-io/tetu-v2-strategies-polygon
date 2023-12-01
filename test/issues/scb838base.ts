import {BASE_NETWORK_ID, HardhatUtils} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {
  IController__factory,
  IPlatformAdapter__factory
} from "../../typechain/factories/@tetu_io/tetu-converter/contracts/interfaces";
import {ethers} from "hardhat";
import {DeployerUtilsLocal} from "../../scripts/utils/DeployerUtilsLocal";
import {
  Bookkeeper,
  Bookkeeper__factory,
  BorrowManager__factory,
  ControllerV2__factory,
  ConverterController__factory, ConverterStrategyBase__factory, IERC20Metadata__factory,
  ISplitter__factory, ITetuVaultV2__factory, ProxyControlled, StrategySplitterV2__factory, TetuVaultV2__factory
} from "../../typechain";
import {Misc} from "../../scripts/utils/Misc";
import {parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../scripts/utils/TokenUtils";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";

describe("Scb830 @skip-on-coverage", () => {
  const BLOCK = 7314048;

  let snapshotBefore: string;
  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID, BLOCK);
    snapshotBefore = await TimeUtils.snapshot();
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
    await HardhatUtils.restoreBlockFromEnv();
  });

  it("apply updates and check deposit/withdraw", async () => {
    const VAULT = "0x68f0a05FDc8773d9a5Fd1304ca411ACc234ce22c";
    const SPLITTER = "0xA01ac87f8Fc03FA2c497beFB24C74D538958DAbA";
    const CONTROLLER = "0x255707B70BF90aa112006E1b07B9AeA6De021424";
    const CONVERTER_CONTROLLER = "0x1AC16b6aBeEE14487DE6CF946d05A0dE5169a917";
    const BOOKKEEPER = "0x588cE8be7ac5202cD7C7fD10Be65E33D26dA2534";
    const BORROW_MANAGER = "0xa2A1F4C5435F91FD01340081b756b4af4d944025";
    const OLD_PLATFORM_ADAPTER = "0x3a13F2Cd361403855Db53e1DA935acdE97616a4C";

    const NEW_PLATFORM_ADAPTER = "0xEE7c4beFfF6c8FAEdDEc28d9E0BD330102328e9F";

    const signer = (await ethers.getSigners())[0];
    console.log("signer", signer.address);

    const controllerAsSigner = ControllerV2__factory.connect(CONTROLLER, signer);
    console.log("controller", controllerAsSigner.address);
    console.log("controller version", await controllerAsSigner.CONTROLLER_VERSION());

    const governance = await Misc.impersonate(await controllerAsSigner.governance());
    console.log("governance", governance.address);

    const controllerGov = await ControllerV2__factory.connect(CONTROLLER, governance);
    const converterControllerGov = await ConverterController__factory.connect(CONVERTER_CONTROLLER, governance);
    const borrowManagerGov = BorrowManager__factory.connect(BORROW_MANAGER, governance);

    console.log("1. reg governance as operator");
    await controllerGov.registerOperator(governance.address);

    console.log("change governance in tetu converter");
    const converterControllerOldGovernanceAddress = await converterControllerGov.governance();
    console.log("old governance of TetuConverter", converterControllerOldGovernanceAddress);
    const converterControllerOldGovernance = await Misc.impersonate(converterControllerOldGovernanceAddress);
    await converterControllerGov.connect(converterControllerOldGovernance).setGovernance("0x3f5075195b96B60d7D26b5cDe93b64A6D9bF33e2");

    console.log("2. accept governance");
    await converterControllerGov.acceptGovernance();

    console.log("3. freeze adapters");
    await IPlatformAdapter__factory.connect(OLD_PLATFORM_ADAPTER, governance).setFrozen(true);

    // pause strategies
    const splitter = StrategySplitterV2__factory.connect(SPLITTER, governance);
    // await splitter.pauseInvesting(
    //   "0x32f7C3a5319A612C1992f021aa70510bc9F16161", // Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai, apr = 15269
    // );
    // await splitter.pauseInvesting(
    //   "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e", // Strategy_UniswapV3ConverterStrategy_Base_UsdbcUsdc, apr = 35437
    // );

    console.log("4. install new logic");
    await controllerGov.upgradeProxy([
      BORROW_MANAGER, // borrow manager
      "0x09C60C4C66059C358ed23B77757d684a0dFDB759", // debt monitor
      CONVERTER_CONTROLLER, // converterController
      "0x32f7C3a5319A612C1992f021aa70510bc9F16161", // Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai
      "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e", // Strategy_UniswapV3ConverterStrategy_Base_UsdbcUsdc
    ]);

    console.log("5. set rewards factor");
    await borrowManagerGov.setRewardsFactor(parseUnits("1", 17));

    console.log("6. register all pairs with new platform adapter");
    await borrowManagerGov.addAssetPairs(
      NEW_PLATFORM_ADAPTER,
      [
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
      ],
      [
        "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
        "0x4200000000000000000000000000000000000006",
        "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
        "0x4200000000000000000000000000000000000006",
        "0x4200000000000000000000000000000000000006",
      ]
    );
    // await splitter.continueInvesting(
    //   "0x32f7C3a5319A612C1992f021aa70510bc9F16161", // Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai
    //   15269
    // );
    // await splitter.continueInvesting(
    //   "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e", // Strategy_UniswapV3ConverterStrategy_Base_UsdbcUsdc
    //   35437
    // );

    console.log("set bookkeeper");
    await converterControllerGov.setBookkeeper(BOOKKEEPER);

    const strategies = [
      "0x32f7C3a5319A612C1992f021aa70510bc9F16161", // Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai
      "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e", // Strategy_UniswapV3ConverterStrategy_Base_UsdbcUsdc
    ];

    for (const strategyAddress of strategies) {
      console.log("deposit to", strategyAddress);
      const strategy = await ConverterStrategyBase__factory.connect(strategyAddress, signer);
      const asset = IERC20Metadata__factory.connect(await strategy.asset(), signer);
      const assetDecimals = await asset.decimals();
      const amount = parseUnits("1000", assetDecimals);
      const vault = TetuVaultV2__factory.connect(VAULT, signer);

      await asset.approve(VAULT, Misc.MAX_UINT);
      await TokenUtils.getToken(asset.address, signer.address, amount.mul(2));

      await vault.deposit(amount, signer.address);
      await TimeUtils.advanceNBlocks(10);

      console.log("withdraw from", strategyAddress);
      await vault.withdrawAll();
    }

    console.log("try to update bookkeeper once more");
    const bookkeeperNew = await DeployerUtils.deployContract(signer, 'Bookkeeper') as Bookkeeper;
    await controllerGov.announceProxyUpgrade(
      [BOOKKEEPER],
      [bookkeeperNew.address]
    );
    await TimeUtils.advanceBlocksOnTs(60 * 60 * 18);
    await controllerGov.upgradeProxy([BOOKKEEPER]);

    console.log("Bookkeeper version", await Bookkeeper__factory.connect(BOOKKEEPER, signer).BOOKKEEPER_VERSION());
  });


});