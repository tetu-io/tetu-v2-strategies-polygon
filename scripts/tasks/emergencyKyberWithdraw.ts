import {DeployerUtilsLocal} from "../utils/DeployerUtilsLocal";
import {
  ConverterStrategyBase__factory,
  IERC20__factory,
  KyberConverterStrategyEmergency,
  KyberConverterStrategyEmergency__factory, StrategySplitterV2__factory, TetuVaultV2__factory
} from "../../typechain";
import {Misc} from "../utils/Misc";
import {InjectUtils} from "../../test/baseUT/strategies/InjectUtils";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {formatUnits} from "ethers/lib/utils";
import {IController__factory} from "../../typechain/factories/@tetu_io/tetu-converter/contracts/interfaces";

// async function getBalances(
//   signer: SignerWithAddress,
//   strategy: KyberConverterStrategyEmergency,
//   governance: string
// ): Promise<IBalances> {
//   return {
//     strategyUsdc: +formatUnits(await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, signer).balanceOf(strategy.address), 6),
//     strategyUsdt: +formatUnits(await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(strategy.address), 6),
//     governanceUsdc: +formatUnits(await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, signer).balanceOf(governance), 6),
//     governanceUsdt: +formatUnits(await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(governance), 6),
//   }
// }

/**
 * to run the script:
 *      npx hardhat run scripts/tasks/emergencyKyberWithdraw.ts
 */
async function main() {
  const STRATEGY = "0x792Bcc2f14FdCB9FAf7E12223a564e7459eA4201"; // Strategy_KyberConverterStrategy_UsdcUsdt

  // const signer = (await ethers.getSigners())[0];\
  const signer = await DeployerUtilsLocal.impersonate("0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94"); // for debug
  await InjectUtils.injectStrategy(signer, STRATEGY, "KyberConverterStrategyEmergency"); // for debug

  const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, signer);
  const vault = TetuVaultV2__factory.connect(
    await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer)).vault(),
    signer
  );

  const governance = await IController__factory.connect(await vault.controller(), signer).governance();
  const kyberStrategy = KyberConverterStrategyEmergency__factory.connect(STRATEGY, signer);
  //
  // const balancesBefore = await getBalances(signer, kyberStrategy, governance);
  // console.log("Balances before", balancesBefore);

  await kyberStrategy.emergencyCloseDirectDebtsUsingFlashLoan();

  const balanceUsdc = await kyberStrategy.balanceOf(MaticAddresses.USDC_TOKEN);
  const balanceUsdt = await kyberStrategy.balanceOf(MaticAddresses.USDT_TOKEN);

  await kyberStrategy.salvage(MaticAddresses.USDC_TOKEN, balanceUsdc);
  await kyberStrategy.salvage(MaticAddresses.USDT_TOKEN, balanceUsdt);

  // const balancesAfter = await getBalances(signer, kyberStrategy, governance);
  // console.log("Balances after", balancesAfter);
  // console.log("Profit USDC:", balancesAfter.governanceUsdc - balancesBefore.governanceUsdc);
  // console.log("Profit USDT:", balancesAfter.governanceUsdt - balancesBefore.governanceUsdt);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });