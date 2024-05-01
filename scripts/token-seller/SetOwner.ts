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
 * npx hardhat run scripts/token-seller/SetOwner.ts
 */
async function main() {
  const TOKEN_SELLER = "0x51002Cad5e6FbE3856311f431E1c41c46Acc5D47";
  const RESOLVER = "0xfe5C094C5B2D51B599cE25A81595329045815b96";
  const NEW_OWNER = "0x0644141DD9C2c34802d28D334217bD2034206Bf7";

  // const signer = await Misc.impersonate("0xF1dCce3a6c321176C62b71c091E3165CC9C3816E");
  const signer = (await ethers.getSigners())[0];
  console.log("signer", signer.address);

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const tokenSeller = Univ3TokenSeller__factory.connect(TOKEN_SELLER, signer);
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    tokenSeller.populateTransaction.setOwner(NEW_OWNER)
  );

  const resolver = Univ3TokenSellerResolver__factory.connect(RESOLVER, signer);
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    resolver.populateTransaction.offerOwnership(NEW_OWNER)
  );

  console.log("tokenSeller.pendingOwner", await tokenSeller.pendingOwner());
  console.log("resolver.pendingOwner", await resolver.pendingOwner());
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
