import {ethers, network} from "hardhat";
import {DeployTokenSellerUtils} from "./DeployTokenSellerUtils";
import {FtmAddresses} from "../addresses/FtmAddresses";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";

/**
 * npx hardhat run scripts/token-seller/DeployTokenSeller.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";
  const signer =  (await ethers.getSigners())[0];
  console.log("signer", signer.address);

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const tokenA = "0xe4436821e403e78a6dd62f7a9f5611f97a18f44c"; // sacra (token to sell)
  const tokenB = "0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83"; // ftm

  const POOL = "0x56e837286dc7366ef6d6464d332ac6f9d32bc5a0"; // SpookySwap pool
  const tickRangeSize = 10;
  const SIGNER_AMOUNT_A = "1";
  const thresholdRatio = "0.1";
  const thresholdLastRefreshPoolSec = 60;
  const tickLimit = 40810;

  const tokenSeller = await DeployTokenSellerUtils.deployTokenSeller(
    signer,
    tokenA,
    tokenB,
    POOL,
    SIGNER_AMOUNT_A,
    tickRangeSize,
    thresholdRatio,
    thresholdLastRefreshPoolSec,
    tickLimit
  );
  console.log("tokenSeller", tokenSeller);
  writeFileSyncRestoreFolder(destPathTxt, `tokenSeller: ${tokenSeller}\n`, { encoding: 'utf8', flag: 'a' });
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
