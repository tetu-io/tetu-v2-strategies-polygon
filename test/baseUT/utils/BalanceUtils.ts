import {BigNumber} from "ethers";
import {IERC20__factory, IERC20Metadata, IERC20Metadata__factory} from "../../../typechain";
import {parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../scripts/utils/Misc";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export interface IUserBalances {
  collateral: BigNumber;
  borrow: BigNumber;
}

export class BalanceUtils {
  /**
   * Convert string or number to string.
   * Use BigNumber.toString() for big-numbers
   */
  static toString(n: number | string | BigNumber | boolean) : string {
    return typeof n === "object"
      ? n.toString()
      : "" + n;
  }

  static async getAmountFromHolder(
    asset: string,
    holder: string,
    recipient: string,
    amount: number | BigNumber
  ) : Promise<BigNumber> {
    const connection = await IERC20Metadata__factory.connect(
      asset,
      await Misc.impersonate(holder)
    );
    const decimals = await connection.decimals();

    const requiredTotalAmount = typeof(amount) === "number"
      ? parseUnits(amount.toString(), decimals)
      : amount;
    const availableAmount = await connection.balanceOf(holder);
    const amountToClaim = requiredTotalAmount.gt(availableAmount)
      ? availableAmount
      : requiredTotalAmount;
    console.log("holder", holder);
    console.log("availableAmount", availableAmount);
    console.log("requiredTotalAmount", requiredTotalAmount);
    console.log("decimals", decimals);
    console.log("amount", amount);

    if (amountToClaim.gt(0)) {
      console.log(`Transfer ${amountToClaim.toString()} of ${await connection.name()} to ${recipient}`);
      await connection.transfer(recipient, amountToClaim);
    }

    return amountToClaim;
  }

  /**
   * Transfer {requiredAmount} from holders to the receiver.
   * If the {requiredAmount} is undefined, transfer all available amount.
   * Return transferred amount
   */
  static async getRequiredAmountFromHolders(
    requiredAmount: BigNumber | undefined,
    token: IERC20Metadata,
    holders: string[],
    receiver: string
  ) : Promise<BigNumber> {
    let dest: BigNumber = BigNumber.from(0);
    for (const holder of holders) {
      const holderBalance = await token.balanceOf(holder);
      const amountToTransfer = requiredAmount && holderBalance.gt(requiredAmount)
        ? requiredAmount
        : holderBalance;

      await token
        .connect(await Misc.impersonate(holder))
        .transfer(receiver, amountToTransfer);
      console.log("Require amount=", requiredAmount, ", transfer amount=", amountToTransfer);

      dest = dest.add(amountToTransfer);
      if (requiredAmount) {
        requiredAmount = requiredAmount?.sub(amountToTransfer);
      }
    }

    return dest;
  }

  static async getBalances(
    signer: SignerWithAddress,
    userAddress: string,
    assets: string[]
  ) : Promise<BigNumber[]> {
    const dest: BigNumber[] = [];
    for (const asset of assets) {
      dest.push(
        await IERC20__factory.connect(asset, signer).balanceOf(userAddress)
      );
    }
    return dest;
  }
}