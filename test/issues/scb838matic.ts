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
    const VAULT = "0x0D397F4515007AE4822703b74b9922508837A04E";
    const SPLITTER = "0xA31cE671A0069020F7c87ce23F9cAAA7274C794c";
    const CONTROLLER = "0x33b27e0a2506a4a2fbc213a01c51d0451745343a ";
    const CONVERTER_CONTROLLER = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99";
    const BOOKKEEPER = "0xe3F710033b37864746863a962bc6aFb070d53534";
    const BORROW_MANAGER = "0xC5690F7063eb60D474Bcdb38b60EbF4C3a8Ece3C";

    const OLD_PLATFORM_ADAPTER_AAVE3 = "0x861af5e04ac40DFa479BcA240391FE68d9Cc91fF";
    const OLD_PLATFORM_ADAPTER_AAVE_TWO = "0xD0879ABD0f2EAFaBa07A0701cC1AD2f70e69a069";
    const OLD_PLATFORM_ADAPTER_COMPOUND3 = "0x16f31FdbB251844624886EeC1bCaA452Cde4a135";
    const OLD_PLATFORM_ADAPTER_DFORCE = "0xb86FC63f7409Ffde027Cb75CD2A424E85F6EFF42";

    const NEW_PLATFORM_ADAPTER_AAVE3 = "0xC5690F7063eb60D474Bcdb38b60EbF4C3a8Ece3C";
    const NEW_PLATFORM_ADAPTER_AAVE_TWO = "0x19c18c1d28049CFED3C1e69Fa36d4d9cf45340fF";

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
    await IPlatformAdapter__factory.connect(OLD_PLATFORM_ADAPTER_AAVE3, governance).setFrozen(true);
    await IPlatformAdapter__factory.connect(OLD_PLATFORM_ADAPTER_AAVE_TWO, governance).setFrozen(true);
    await IPlatformAdapter__factory.connect(OLD_PLATFORM_ADAPTER_COMPOUND3, governance).setFrozen(true);
    // await IPlatformAdapter__factory.connect(OLD_PLATFORM_ADAPTER_DFORCE, governance).setFrozen(true);

    // todo remove DForce
    // todo unregister Compound 3

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
      "0xAF2DEcd5Ad64d833Be5Bbd4D7eB16fEA57D473a2", // debt monitor
      CONVERTER_CONTROLLER, // converterController
      "0xA8105284aA9C9A20A2081EEE1ceeF03d9719A5AD", // Strategy_AlgebraConverterStrategy_UsdcUsdt
      "0xCdc5560AB926Dca3d4989bF814469Af3f989Ab2C", // Strategy_UniswapV3ConverterStrategy_UsdcUsdt
    ]);

    console.log("5. set rewards factor");
    await borrowManagerGov.setRewardsFactor(parseUnits("1", 17));

    console.log("6. register all pairs with new AAVE3");
    await borrowManagerGov.addAssetPairs(
      NEW_PLATFORM_ADAPTER_AAVE3,
      [
        "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        "0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6",
        "0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6",
        "0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4",
        "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
        "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
        "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
        "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
      ],
      [
        "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
        "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
        "0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4",
        "0xa3Fa99A148fA48D14Ed51d610c367C61876997F1",
        "0xa3Fa99A148fA48D14Ed51d610c367C61876997F1",
        "0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD",
        "0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4",
        "0xa3Fa99A148fA48D14Ed51d610c367C61876997F1",
        "0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6",
      ]
    );

    console.log("7. register all pairs with new AAVE2");
    await borrowManagerGov.addAssetPairs(
      NEW_PLATFORM_ADAPTER_AAVE_TWO,
      [
        "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      ],
      [
        "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
        "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
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
      "", // Strategy_UniswapV3ConverterStrategy_Base_UsdbcDai
      "", // Strategy_UniswapV3ConverterStrategy_Base_UsdbcUsdc
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