import {ContractReceipt} from "ethers";
import {IFixPricesChangesEventInfo, IGetStateParams} from "./StateUtilsNum";
import {ConverterStrategyBaseLib__factory} from "../../../typechain";
import {FixPriceChangesEventObject} from "../../../typechain/contracts/strategies/ConverterStrategyBaseLib";
import {formatUnits} from "ethers/lib/utils";

export class FixPriceChangesEvents {
  static async handleReceiptWithdrawDepositHardwork(receipt: ContractReceipt, decimals: number) : Promise<IGetStateParams> {
    // collect data for IStateHardworkEvents
    const fixChangePricesEventInfo: IFixPricesChangesEventInfo[] = [];

    const strategy = ConverterStrategyBaseLib__factory.createInterface();
    for (const event of (receipt.events ?? [])) {
      if (event.topics[0].toLowerCase() === strategy.getEventTopic('FixPriceChanges').toLowerCase()) {
        const log = (strategy.decodeEventLog(
          strategy.getEvent("FixPriceChanges"),
          event.data,
          event.topics,
        ) as unknown) as FixPriceChangesEventObject;
        console.log('FixChangePrices.investedAssetsBefore', formatUnits(log.investedAssetsBefore, decimals));
        console.log('FixChangePrices.investedAssetsOut', formatUnits(log.investedAssetsOut, decimals));
        fixChangePricesEventInfo.push({
          assetBefore: +formatUnits(log.investedAssetsBefore, decimals),
          assetAfter: +formatUnits(log.investedAssetsOut, decimals)
        });
      }
    }

    return {fixChangePrices: fixChangePricesEventInfo};
  }
}