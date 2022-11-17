import {utils} from "ethers";
import {IAnnouncer, IController} from "../typechain";
import {TimeUtils} from "./TimeUtils";
import {TokenUtils} from "./TokenUtils";
import {DeployerUtilsLocal} from "../scripts/deploy/DeployerUtilsLocal";

export class MintHelperUtils {

  public static async mint(controller: IController, announcer: IAnnouncer, amount: string, destination: string, mintAll = false, period = 60 * 60 * 48) {
    const fund = await controller.fund();
    const distributor = await controller.distributor();
    console.log("mint reward tokens", amount)
    await announcer.announceMint(utils.parseUnits(amount), distributor, fund, mintAll);

    await TimeUtils.advanceBlocksOnTs(period);

    await controller.mintAndDistribute(utils.parseUnits(amount), mintAll);
    const tetu = await controller.rewardToken();
    const fundBal = await TokenUtils.balanceOf(tetu, fund);
    const distBal = await TokenUtils.balanceOf(tetu, distributor);
    await TokenUtils.transfer(tetu, await DeployerUtilsLocal.impersonate(fund), destination, fundBal.toString());
    await TokenUtils.transfer(tetu, await DeployerUtilsLocal.impersonate(distributor), destination, distBal.toString());
  }

}
