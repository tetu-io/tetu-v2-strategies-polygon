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
  const TOKEN_SELLER = "0x8E294388A3E91cdac5FEA95b5b75f509b85dC5E2";
  const RESOLVER = "0xd2538f5f7c328a7027a5e0dea1938931601d1684";
  const MESSAGE_SENDER = "0x0592ce0e3ffb1bc21f5f687e4b9b9da91d9124c3";

  const signer = (await ethers.getSigners())[0];
  console.log("signer", signer.address);

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const tokenSeller = Univ3TokenSeller__factory.connect(TOKEN_SELLER, signer);
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    tokenSeller.populateTransaction.setOperator(RESOLVER, true)
  );

  const resolver = Univ3TokenSellerResolver__factory.connect(RESOLVER, signer);
  await RunHelper.runAndWait2ExplicitSigner(
    signer,
    resolver.populateTransaction.changeOperatorStatus(MESSAGE_SENDER, true)
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
