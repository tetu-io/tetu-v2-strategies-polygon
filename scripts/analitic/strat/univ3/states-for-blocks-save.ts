/*
import hre, { ethers } from 'hardhat';
import {
  ConverterStrategyBase__factory,
  IRebalancingV2Strategy__factory,
  ISplitter__factory, StrategySplitterV2__factory,
  TetuVaultV2__factory, UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory
} from "../../../../typechain";
import {Misc} from "../../../utils/Misc";
import fs from "fs";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IStateNum, StateUtilsNum} from "../../../../test/baseUT/utils/StateUtilsNum";
import {MaticAddresses} from "../../../addresses/MaticAddresses";
import { reset } from '@nomicfoundation/hardhat-network-helpers';
import { EnvSetup } from '../../../utils/EnvSetup';
import { HardhatUtils } from '../../../../test/baseUT/utils/HardhatUtils';
import { PackedData } from '../../../../test/baseUT/utils/PackedData';
import { DeployerUtilsLocal } from '../../../utils/DeployerUtilsLocal';
import {
  PairBasedStrategyPrepareStateUtils
} from "../../../../test/baseUT/strategies/PairBasedStrategyPrepareStateUtils";
import {InjectUtils} from "../../../../test/baseUT/strategies/InjectUtils";
import { AggregatorUtils } from '../../../../test/baseUT/utils/AggregatorUtils';
import { CaptureEvents } from '../../../../test/baseUT/strategies/CaptureEvents';
import { ENTRY_TO_POOL_IS_ALLOWED } from '../../../../test/baseUT/AppConstants';

// const STRATEGY = '0x29ce0ca8d0A625Ebe1d0A2F94a2aC9Cc0f9948F1'; // dai
const STRATEGY = '0x6565e8136cd415f053c81ff3656e72574f726a5e'; // usdt
const SENDER = "0xbbbbb8c4364ec2ce52c59d2ed3e56f307e529a94";

const blocks = [
  46903059,
  46904113,
  46907104,
  46919958,
  46919995,
  46929800,
  46929861,
  46929893,
  46929929,
  46932234,
  46932757,
  46950884,
  46950985,
  46951193,
  46955941,
  46982273,
  46982314,
  46982989,
  46983976,
  46984017,
  46998353,
  47003171,
  47003428,
  47011028,
  47011068,
  47011068,
  47022512,
  47022552,
  47024513,
  47024554,
  47029602,
  47030384,
  47030483,
  47030523,
  47030562,
  47030602,
  47031633,
  47057709,
  47057810,
  47057851,
  47058424,
  47061669,
  47062075,
  47087481,
  47087515,
  47087555,
  47089606,
  47089646,
  47089686,
  47089726,
];

async function getStateForBlock(
  signer: SignerWithAddress,
  block: number,
  strategy: UniswapV3ConverterStrategy,
  vault: string,
  prefix: string
) : Promise<IStateNum> {
  await reset(EnvSetup.getEnv().maticRpcUrl, block)

  return StateUtilsNum.getState(
    signer,
    await Misc.impersonate(SENDER),
    strategy,
    TetuVaultV2__factory.connect(vault, signer),
    `${prefix}-${block.toString()}`,
  );
}

/!**
 * to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/analitic/strat/univ3/states-for-blocks-save.ts
 *!/
async function main() {
  const pathOut = "./tmp/states.csv";
  // const signer = await DeployerUtilsLocal.impersonate(SENDER);
  const signer = (await ethers.getSigners())[0];

  const states: IStateNum[] = [];

  for (let i = 0; i < blocks.length; ++i) {
    try {
      await HardhatUtils.switchToBlock(blocks[i] - 2);

      const strategy = UniswapV3ConverterStrategy__factory.connect(STRATEGY, signer);
      console.log("strategy", strategy.address);

      const state = await PackedData.getDefaultState(strategy);
      const operator = await DeployerUtilsLocal.impersonate(SENDER);

      const strategyAsOperator = IRebalancingV2Strategy__factory.connect(STRATEGY, operator);
      const converterStrategyBase = ConverterStrategyBase__factory.connect(STRATEGY, operator);
      const vault = TetuVaultV2__factory.connect(
        await (await StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), operator)).vault(),
        signer
      );

      await InjectUtils.injectStrategy(signer, STRATEGY, "UniswapV3ConverterStrategy");
      // await PairBasedStrategyPrepareStateUtils.injectTetuConverter(signer);

      const aggregator = "0x1111111254EEB25477B68fb85Ed929f73A960582";
      const planEntryData = "0x0000000000000000000000000000000000000000000000000000000000000001ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

      console.log("unfoldBorrows.quoteWithdrawByAgg.callStatic --------------------------------");
      const quote = await strategyAsOperator.callStatic.quoteWithdrawByAgg(planEntryData);
      console.log("quote", quote);
      console.log("unfoldBorrows.quoteWithdrawByAgg.FINISH --------------------------------", quote);

      const swapData = await AggregatorUtils.buildSwapTransactionData(
        quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenA : state.tokenB,
        quote.tokenToSwap.toLowerCase() === state.tokenA.toLowerCase() ? state.tokenB : state.tokenA,
        quote.amountToSwap,
        strategyAsOperator.address,
      );

      // const stateBefore = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, `b${i}`);
      // states.push(stateBefore);

      const eventsSet = await CaptureEvents.makeWithdrawByAggStep(
        strategyAsOperator,
        quote.tokenToSwap,
        aggregator,
        quote.amountToSwap,
        swapData,
        planEntryData,
        ENTRY_TO_POOL_IS_ALLOWED,
      );
      console.log("unfoldBorrows.withdrawByAggStep.FINISH --------------------------------");
      const stateAfter = await StateUtilsNum.getState(signer, signer, converterStrategyBase, vault, `a${i}`, {eventsSet});
      states.push(stateAfter);

      if (fs.existsSync(pathOut)) {
        fs.rmSync(pathOut);
      }
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, {mainAssetSymbol: MaticAddresses.USDC_TOKEN});
    } catch(e) {
      console.log("Error:", e);
    }
  }

}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
*/
