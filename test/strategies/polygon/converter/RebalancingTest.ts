import {ethers} from "hardhat";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {Misc} from "../../../../scripts/utils/Misc";
import {
  ConverterController__factory,
  DebtMonitor__factory, IPoolAdapter, IPoolAdapter__factory,
  Keeper,
  Keeper__factory, KeeperCaller,
  ProxyControlled__factory, TetuConverter__factory
} from "../../../../typechain";
import {PriceOracleManagerUtils} from "../../../baseUT/converter/PriceOracleManagerUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {boolean} from "hardhat/internal/core/params/argumentTypes";

async function getPoolAdapter(
  signer: SignerWithAddress,
  borrows: string[],
  collateralAsset: string,
  borrowAsset: string
): Promise<IPoolAdapter> {
  for (const b of borrows) {
    const poolAdapter = await IPoolAdapter__factory.connect(b, signer);
    const status = await poolAdapter.getStatus();
    const config = await poolAdapter.getConfig();
    if (config.collateralAsset.toLowerCase() === collateralAsset.toLowerCase() && config.borrowAsset.toLowerCase() === borrowAsset.toLowerCase()) {
      console.log("Pool adapter found, config", config);
      // return poolAdapter;
    }
    console.log("Pool adapter config", config);
  }
  throw Error("Pool adapter wasn't found");
}
/**
 * Try to move prices
 * and check how rebalancing works
 */
describe("study, Rebalancing test", () => {
  it("should return expected values", async () => {
    const signer = (await ethers.getSigners())[0];
    const tetuConverter = TetuConverter__factory.connect(MaticAddresses.TETU_CONVERTER, signer);
    const controller = ConverterController__factory.connect(await tetuConverter.controller(), signer);
    const debtMonitor = DebtMonitor__factory.connect(await controller.debtMonitor(), signer);

    const governance = await controller.governance();
    const proxyUpdater = await controller.proxyUpdater();

    // inject debug version of the Keeper
    const keeperProxy = ProxyControlled__factory.connect(await controller.keeper(), await Misc.impersonate(proxyUpdater));
    // const keeperNewImplementation = (await DeployUtils.deployContract(signer, "Keeper")).address;
    // await keeperProxy.upgrade(keeperNewImplementation);

    // inject debug version of the TetuConverter
    const tetuConverterProxy = ProxyControlled__factory.connect(await controller.tetuConverter(), await Misc.impersonate(proxyUpdater));
    // const tetuConverterNewImplementation = (await DeployUtils.deployContract(signer, "TetuConverter")).address;
    // await tetuConverterProxy.upgrade(tetuConverterNewImplementation);

    // deploy test keeper-caller and register it as an operator
    const keeperCaller = await DeployerUtils.deployContract(signer, "KeeperCaller") as KeeperCaller;
    await keeperCaller.setupKeeper(keeperProxy.address, keeperProxy.address);

    // get all opened positions
    const countPositions = (await debtMonitor.getCountPositions()).toNumber();
    const borrows = [];
    for (let i = 0; i < countPositions; i++) {
      const borrow = await debtMonitor.positions(i);
      borrows.push(borrow);
      console.log("Pool adapter with opened borrow", borrow);
    }

    // register keeper-caller as operator
    const keeper = Keeper__factory.connect(keeperProxy.address, await Misc.impersonate(governance));
    await keeper.changeOperatorStatus(keeperCaller.address, true);

    // get current statuses
    const priceManager = await PriceOracleManagerUtils.build(signer, await controller.tetuConverter());
    // const dForcePriceOracle = await DForceChangePriceUtils.setupPriceOracleMock(signer, true);

    const before = await keeper.checker();
    console.log("Before change price", before);

    const collateralAsset = MaticAddresses.USDC_TOKEN;
    const borrowAsset = MaticAddresses.USDT_TOKEN;

    const poolAdapter: IPoolAdapter = await getPoolAdapter(signer, borrows, collateralAsset, borrowAsset);
    const statusBefore = await poolAdapter.getStatus();
    console.log("Status initial", statusBefore);

    // change prices to force call of fixHealth
    await priceManager.decPrice(collateralAsset, 5);
    await priceManager.incPrice(borrowAsset, 5);

    // get prices after changing of the prices
    const statusAfterChangePrice = await poolAdapter.getStatus();
    console.log("Status after change price", statusAfterChangePrice);

    const checker = await keeper.checker();
    console.log("Checker", after);

    await keeperCaller.callChecker();

    const statusAfterFixHealth = await poolAdapter.getStatus();
    console.log("Status after fix health", statusAfterFixHealth);

    // nothing to check, it's study test
  });
});
