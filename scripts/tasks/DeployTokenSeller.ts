import {ethers, network} from "hardhat";
import {DeployTokenSellerUtils} from "./DeployTokenSellerUtils";
import {FtmAddresses} from "../addresses/FtmAddresses";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";

/**
 * npx hardhat run scripts/tasks/DeployTokenSeller.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";
  const signer =  (await ethers.getSigners())[0];
  console.log("signer", signer.address);

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const tokenA = FtmAddresses.WFTM_TOKEN;
  const tokenB = FtmAddresses.USDC_LZ_TOKEN;

  const POOL = "0xf6021f2f63ab3bcdddbaf32939cd66a8b9e4c21c"; // SpookySwap pool
  const tickRangeSize = 10;
  const SIGNER_AMOUNT_A = "1";
  const thresholdRatio = "0.1";
  const thresholdLastRefreshPoolSec = 100;

  const tokenSeller = await DeployTokenSellerUtils.deployTokenSeller(
    signer,
    tokenA,
    tokenB,
    POOL,
    SIGNER_AMOUNT_A,
    tickRangeSize,
    thresholdRatio,
    thresholdLastRefreshPoolSec
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
