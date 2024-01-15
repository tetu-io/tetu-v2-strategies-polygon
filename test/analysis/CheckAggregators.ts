import {AGGREGATOR_ONE_INCH, AggregatorUtils} from "../baseUT/utils/AggregatorUtils";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {IERC20Metadata__factory} from "../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {writeFileSyncRestoreFolder} from "../baseUT/utils/FileUtils";
import {BaseAddresses} from "../../scripts/addresses/BaseAddresses";

describe("CheckAggregators @skip-on-coverage", () => {

  function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function collectInfoForOneInch(
    signer: SignerWithAddress,
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountToSwap: string
  ): Promise<string[]> {
    const decimalsTokenIn = await IERC20Metadata__factory.connect(tokenIn, signer).decimals();

    const json = await AggregatorUtils.getLiquiditySources(chainId);
    console.log(json);

    const results = new Map<string, string>();

    for (const protocol of json.protocols) {
      await delay(2000);

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
    const lines = ["Protocol;AmountTo"];

    results.forEach((value: string, key: string) => {
      lines.push(`${key};${+formatUnits(value, decimalsTokenIn)};`);
    });

    return lines;
  }

  describe("1inch, Polygon", function () {
    const AMOUNT_TO_SWAP = 500_000;
    const TOKEN_IN = MaticAddresses.USDC_TOKEN;
    const TOKEN_OUT = MaticAddresses.USDT_TOKEN;

    let signer: SignerWithAddress;
    let snapshotBefore: string;
    beforeEach(async function () {
      await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
      snapshotBefore = await TimeUtils.snapshot();

      signer = (await ethers.getSigners())[0];

      // we need to display full objects, so we use util.inspect, see
      // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
      require("util").inspect.defaultOptions.depth = null;
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshotBefore);
    });

    it("1inch", async () => {
      const pathOut = `"./tmp/1inch-matic-${AMOUNT_TO_SWAP}.csv`;
      const lines = await collectInfoForOneInch(signer, POLYGON_NETWORK_ID, TOKEN_IN, TOKEN_OUT, AMOUNT_TO_SWAP.toString());
      writeFileSyncRestoreFolder(pathOut, lines.join("\n"), {encoding: 'utf8', flag: 'w'});
    });
  });

  describe("1inch, Base-chain", function () {
    const AMOUNT_TO_SWAP = 50_000;
    const TOKEN_IN = BaseAddresses.USDbC_TOKEN;
    const TOKEN_OUT = BaseAddresses.USDC_TOKEN;

    let signer: SignerWithAddress;
    let snapshotBefore: string;
    beforeEach(async function () {
      await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
      snapshotBefore = await TimeUtils.snapshot();

      signer = (await ethers.getSigners())[0];

      // we need to display full objects, so we use util.inspect, see
      // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
      require("util").inspect.defaultOptions.depth = null;
    });

    afterEach(async function () {
      await TimeUtils.rollback(snapshotBefore);
    });

    function delay(ms: number) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    it("1inch", async () => {
      const pathOut = `./tmp/1inch-base-${AMOUNT_TO_SWAP}.csv`;
      const lines = await collectInfoForOneInch(signer, BASE_NETWORK_ID, TOKEN_IN, TOKEN_OUT, AMOUNT_TO_SWAP.toString());
      writeFileSyncRestoreFolder(pathOut, lines.join("\n"), {encoding: 'utf8', flag: 'w'});
    });
  });
});