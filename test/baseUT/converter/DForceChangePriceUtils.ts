// import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
// import {BigNumber} from "ethers";
// import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
// import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
// import {Misc} from "../../../scripts/utils/Misc";
// import {DForcePriceOracleMock, IDForceController__factory, IDForcePriceOracle__factory} from "../../../typechain";
//
// export class DForceChangePriceUtils {
//   public static async setupPriceOracleMock(deployer: SignerWithAddress, copyPrices: boolean = true) : Promise<DForcePriceOracleMock> {
//     const cTokensList = [
//       MaticAddresses.DFORCE_IDAI,
//       MaticAddresses.DFORCE_IMATIC,
//       MaticAddresses.DFORCE_IUSDC,
//       MaticAddresses.DFORCE_IWETH,
//       MaticAddresses.DFORCE_IUSDT,
//       MaticAddresses.DFORCE_IWBTC,
//     ];
//     const comptroller = IDForceController__factory.connect(MaticAddresses.DFORCE_CONTROLLER, deployer);
//     const priceOracle = await IDForcePriceOracle__factory.connect(await comptroller.priceOracle(), deployer);
//
//     const owner = await comptroller.owner();
//
//     // deploy mock
//     const mock = (await DeployerUtils.deployContract(deployer, "DForcePriceOracleMock")) as DForcePriceOracleMock;
//
//     // copy current prices from real price oracle to the mock
//     const comptrollerAsAdmin = comptroller.connect(await Misc.impersonate(owner));
//     if (copyPrices) {
//       for (const cToken of cTokensList) {
//         const price = await priceOracle.getUnderlyingPrice(cToken);
//         await mock.setUnderlyingPrice(cToken, price);
//       }
//     }
//
//     // install the mock to the protocol
//     console.log("Change price oracle...");
//     await comptrollerAsAdmin._setPriceOracle(mock.address);
//     console.log("Price oracle is changed");
//
//     return mock;
//   }
// }