import {utils} from "ethers";
import {IController} from "../typechain";
import {TimeUtils} from "../scripts/utils/TimeUtils";
import {TokenUtils} from "../scripts/utils/TokenUtils";
import {DeployerUtilsLocal} from "../scripts/utils/DeployerUtilsLocal";

export class MintHelperUtils {

 /* public static async mint(controller: IController, announcer: IAnnouncer, amount: string, destination: string, mintAll = false, period = 60 * 60 * 48) {
    const fund = await controller.investFund();
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
  }*/

}
