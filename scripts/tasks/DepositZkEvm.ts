import {ethers} from "hardhat";
import {RunHelper} from "../utils/RunHelper";
import {ControllerV2__factory, TetuVaultV2__factory} from "../../typechain";
import {IERC20Metadata__factory} from "../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {ZkevmAddresses} from "../addresses/ZkevmAddresses";
import {Misc} from "../utils/Misc";
import {TokenUtils} from "../utils/TokenUtils";
import {parseUnits} from "ethers/lib/utils";

/**
 * to run the script:
 *      npx hardhat run scripts/tasks/DepositZkEvm.ts
 */
async function main() {
  const signer = (await ethers.getSigners())[0];
  // const signer = await Misc.impersonate("0xF1dCce3a6c321176C62b71c091E3165CC9C3816E");
  console.log("signer", signer.address);

  const VAULT = "0x3650823873F34a019533db164f492e09365cfa7E";

  // const tx = "0x3bc46233efdefd05f861ae7ff938db03ee52b1c12bfecb6e9919d75de2745715";

  // const receipt = await ethers.provider.getTransactionReceipt("0x3bc46233efdefd05f861ae7ff938db03ee52b1c12bfecb6e9919d75de2745715");
  // const tx = await ethers.provider.getTransaction("0x3bc46233efdefd05f861ae7ff938db03ee52b1c12bfecb6e9919d75de2745715");
  // const unsignedTx = {
  //   to: tx.to,
  //   nonce: tx.nonce,
  //   gasLimit: tx.gasLimit,
  //   gasPrice: tx.gasPrice,
  //   data: tx.data,
  //   value: tx.value,
  //   chainId: tx.chainId
  // };
  // const signature = {
  //   v: tx.v,
  //   r: tx.r,
  //   s: tx.s
  // }
  //
  // console.log("tx", tx);
  //
  // const serialized = ethers.utils.serializeTransaction(unsignedTx, signature);
  // console.log(serialized);

  const asset = IERC20Metadata__factory.connect(ZkevmAddresses.USDC_TOKEN, signer);
  console.log("approve");
  console.log("balance", await IERC20Metadata__factory.connect(ZkevmAddresses.USDC_TOKEN, signer).balanceOf(signer.address));
  // await RunHelper.runAndWait2ExplicitSigner(signer, asset.populateTransaction.approve(VAULT, Misc.MAX_UINT));
  console.log("deposit");
  // await RunHelper.runAndWait2ExplicitSigner(signer, TetuVaultV2__factory.connect(VAULT, signer).populateTransaction.deposit(parseUnits('0.1', 6), signer.address));
  const tx = await TetuVaultV2__factory.connect(VAULT, signer).populateTransaction.deposit(parseUnits('0.1', 6), signer.address);
  console.log("tx", tx);
  console.log("tx.data", tx.data);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });