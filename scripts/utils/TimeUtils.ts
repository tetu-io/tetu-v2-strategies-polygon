import {ethers} from "hardhat";
import {Misc} from "./Misc";
import {Multicall} from "../../typechain";

export class TimeUtils {

  public static async advanceBlocksOnTs(add: number) {
    const start = Date.now();
    // const block = await TimeUtils.currentBlock();
    await ethers.provider.send('evm_increaseTime', [add]);
    await ethers.provider.send('evm_mine', []);
    // await TimeUtils.mineAndCheck();
    Misc.printDuration('advanceBlocksOnTs ' + add + ' completed', start);
  }

  public static async advanceNBlocks(n: number) {
    await ethers.provider.send("hardhat_mine", ['0x' + n.toString(16), '0x' + Number(1).toString(16)]);
  }

  public static async mineAndCheck() {
    const start = ethers.provider.blockNumber;
    while (true) {
      await ethers.provider.send('evm_mine', []);
      if (ethers.provider.blockNumber > start) {
        break;
      }
      console.log('waite mine 10sec');
      await Misc.delay(10000);
    }
  }

  public static async setBlock(blockNumber: number) {
    await ethers.provider.send('evm_setNextBlockTimestamp', [blockNumber]);
  }

  public static async setNextBlockTime(ts: number) {
    await ethers.provider.send('evm_setNextBlockTimestamp', [ts]);
    await ethers.provider.send('evm_mine', []);
  }

  // // doesn't work, need to investigate
  // public static async currentBlock() {
  //   const tools = await DeployerUtils.getToolsAddresses();
  //   const multicall = Multicall__factory.connect(tools.multicall, ethers.provider);
  //   const blockHash = await multicall.getLastBlockHash();
  //   return (await ethers.provider.getBlock(blockHash)).number;
  // }

  public static async getBlockTime(multicall: Multicall, block?: number | null): Promise<number> {
    if (block) {
      return (await multicall.getCurrentBlockTimestamp({blockTag: block})).toNumber();
    } else {
      return (await multicall.getCurrentBlockTimestamp()).toNumber();
    }
  }

  public static async snapshot() {
    const id = await ethers.provider.send("evm_snapshot", []);
    console.log("made snapshot", id);
    return id;
  }

  public static async rollback(id: string) {
    console.log("restore snapshot", id);
    return ethers.provider.send("evm_revert", [id]);
  }

}
