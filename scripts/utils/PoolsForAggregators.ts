import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IERC20Metadata__factory} from "../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {AggregatorUtils} from "../../test/baseUT/utils/AggregatorUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";

export class PoolsForAggregators {
  static async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static async collectInfoForOneInch(
    signer: SignerWithAddress,
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountToSwap: string
  ): Promise<Map<string, string>> {
    const decimalsTokenIn = await IERC20Metadata__factory.connect(tokenIn, signer).decimals();

    const json = await AggregatorUtils.getLiquiditySources(chainId);
    console.log(json);

    const results = new Map<string, string>();

    for (const protocol of json.protocols) {
      await this.delay(2000);

      try {
        console.log("protocol", protocol.id)
        const swapData = await AggregatorUtils.getQuoteForGivenProtocol(
          chainId,
          tokenIn,
          tokenOut,
          parseUnits(amountToSwap.toString(), decimalsTokenIn),
          signer.address,
          protocol.id
        );
        console.log("swapData", swapData);

        results.set(protocol.id, swapData.toAmount);
      } catch(e) {
        console.log(e);
      }
    }

    console.log(results);
    return results;
  }

  static async getListPoolsWithAmountsTo(
    results: Map<string, string>,
    signer: SignerWithAddress,
    tokenIn: string,
  ): Promise<string[]> {
    const decimalsTokenIn = await IERC20Metadata__factory.connect(tokenIn, signer).decimals();
    const lines = ["Protocol;AmountTo"];

    results.forEach((value: string, key: string) => {
      lines.push(`${key};${+formatUnits(value, decimalsTokenIn)};`);
    });

    return lines;
  }


}