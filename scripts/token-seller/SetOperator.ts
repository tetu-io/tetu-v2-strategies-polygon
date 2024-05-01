import {parseUnits} from "ethers/lib/utils";
import {
  IERC20Metadata__factory,
  MockToken__factory,
  UniswapV3Callee__factory,
  Univ3TokenSeller__factory, Univ3TokenSellerResolver__factory
} from "../../typechain";
import {ethers, network} from "hardhat";
import {Misc} from "../utils/Misc";
import {RunHelper} from "../utils/RunHelper";

/**
 * npx hardhat run scripts/token-seller/SetOperator.ts
 */
async function main() {
  const TOKEN_SELLER = "0x51002Cad5e6FbE3856311f431E1c41c46Acc5D47";
  const RESOLVER = "0xfe5C094C5B2D51B599cE25A81595329045815b96";
  // const MESSAGE_SENDER = "0x0592ce0e3ffb1bc21f5f687e4b9b9da91d9124c3";

  const signer = (await ethers.getSigners())[0];
  console.log("signer", signer.address);

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const tokenSeller = Univ3TokenSeller__factory.connect(TOKEN_SELLER, signer);
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    tokenSeller.populateTransaction.setOperator(RESOLVER, true)
  );

  // const resolver = Univ3TokenSellerResolver__factory.connect(RESOLVER, signer);
  // await RunHelper.runAndWait2ExplicitSigner(
  //   signer,
  //   resolver.populateTransaction.changeOperatorStatus(MESSAGE_SENDER, true)
  // );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
