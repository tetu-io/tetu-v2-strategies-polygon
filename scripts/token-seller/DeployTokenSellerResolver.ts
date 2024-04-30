import {ethers, network} from "hardhat";
import {DeployTokenSellerUtils} from "./DeployTokenSellerUtils";
import {FtmAddresses} from "../addresses/FtmAddresses";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";
import {DeployerUtils} from "../utils/DeployerUtils";
import {UniswapV3Callee} from "../../typechain";

/**
 * npx hardhat run scripts/token-seller/DeployTokenSellerResolver.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";
  const signer =  (await ethers.getSigners())[0];
  console.log("signer", signer.address);

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const tokenSeller = "0x8E294388A3E91cdac5FEA95b5b75f509b85dC5E2";
  const tokenSellerResolver = (await DeployerUtils.deployContract(signer, "Univ3TokenSellerResolver", tokenSeller, 60)).address;

  writeFileSyncRestoreFolder(destPathTxt, `tokenSellerResolver: ${tokenSellerResolver}\n`, { encoding: 'utf8', flag: 'a' });
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
