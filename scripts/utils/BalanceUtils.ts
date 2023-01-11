import {IERC20} from "../../typechain";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class BalanceUtils {
  /**
   * Mint additional amount of the given token
   */
  static async mintAdditionalTokens(
    signer: SignerWithAddress,
    token: IERC20,
    amountToMint: BigNumber
  ) {

  }
}