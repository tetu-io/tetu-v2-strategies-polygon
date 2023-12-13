import {DeployerUtilsLocal} from "../utils/DeployerUtilsLocal";
import {
  ControllerV2__factory,
  ConverterStrategyBase__factory,
  IERC20__factory,
  KyberConverterStrategyEmergency,
  KyberConverterStrategyEmergency__factory, StrategySplitterV2__factory, TetuVaultV2__factory
} from "../../typechain";
import {Misc} from "../utils/Misc";
import {InjectUtils} from "../../test/baseUT/strategies/InjectUtils";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {formatUnits} from "ethers/lib/utils";
import {IController__factory} from "../../typechain/factories/@tetu_io/tetu-converter/contracts/interfaces";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../test/baseUT/utils/HardhatUtils";
import {RunHelper} from "../utils/RunHelper";
import {ethers} from "hardhat";

/**
 * to run the script:
 *      npx hardhat run scripts/tasks/updateBase.ts
 */
async function main() {
  // await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
  const CONTROLLER = "0x255707B70BF90aa112006E1b07B9AeA6De021424";

  const signer = (await ethers.getSigners())[0];
  // const signer = await DeployerUtilsLocal.impersonate("0xF1dCce3a6c321176C62b71c091E3165CC9C3816E"); // for debug
  console.log("signer", signer.address);

  await RunHelper.runAndWait(async () => ControllerV2__factory.connect(CONTROLLER, signer).upgradeProxy([
      "0x32f7C3a5319A612C1992f021aa70510bc9F16161",
      "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e"
    ])
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });