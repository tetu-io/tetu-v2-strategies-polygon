import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {DeployerUtilsLocal} from "../../../../scripts/utils/DeployerUtilsLocal";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DForceHelper} from "./DForceHelper";
import {DForcePriceOracleMock} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";

export class DForceChangePriceUtils {
  public static async setupPriceOracleMock(deployer: SignerWithAddress, copyPrices: boolean = true) : Promise<DForcePriceOracleMock> {
    const cTokensList = [
      MaticAddresses.DFORCE_IDAI,
      MaticAddresses.DFORCE_IMATIC,
      MaticAddresses.DFORCE_IUSDC,
      MaticAddresses.DFORCE_IWETH,
      MaticAddresses.DFORCE_IUSDT,
      MaticAddresses.DFORCE_IWBTC,
      MaticAddresses.DF_TOKEN
    ];
    const priceOracle = await DForceHelper.getPriceOracle(await DForceHelper.getController(deployer), deployer);

    const comptroller = await DForceHelper.getController(deployer);
    const owner = await comptroller.owner();

    // deploy mock
    const mock = (await DeployerUtils.deployContract(deployer, "DForcePriceOracleMock")) as DForcePriceOracleMock;

    // copy current prices from real price oracle to the mock
    const comptrollerAsAdmin = await DForceHelper.getController(
      await DeployerUtilsLocal.impersonate(owner)
    );
    if (copyPrices) {
      for (const cToken of cTokensList) {
        const price = await priceOracle.getUnderlyingPrice(cToken);
        await mock.setUnderlyingPrice(cToken, price);
      }
    }

    // install the mock to the protocol
    console.log("Change price oracle...");
    await comptrollerAsAdmin._setPriceOracle(mock.address);
    console.log("Price oracle is changed");

    return mock;
  }

  public static async changeCTokenPrice(
    oracle: DForcePriceOracleMock,
    signer: SignerWithAddress,
    cToken: string,
    inc: boolean,
    times: number
  ) {
    console.log("changeCTokenPrice");
    const currentPrice: BigNumber = await oracle.getUnderlyingPrice(cToken);
    const newPrice = inc
      ? currentPrice.mul(times)
      : currentPrice.div(times);
    await oracle.setUnderlyingPrice(
      cToken,
      newPrice
    );
    console.log(`Price of asset ${cToken} was changed from ${currentPrice} to ${newPrice}`);
  }
}