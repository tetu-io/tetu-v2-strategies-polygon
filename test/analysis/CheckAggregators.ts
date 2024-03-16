import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID} from "../baseUT/utils/HardhatUtils";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {writeFileSyncRestoreFolder} from "../baseUT/utils/FileUtils";
import {BaseAddresses} from "../../scripts/addresses/BaseAddresses";
import {PoolsForAggregators} from "../../scripts/utils/PoolsForAggregators";

describe("CheckAggregators @skip-on-coverage", () => {

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
      const results = await PoolsForAggregators.collectInfoForOneInch(signer, POLYGON_NETWORK_ID, TOKEN_IN, TOKEN_OUT, AMOUNT_TO_SWAP.toString());
      const lines = await PoolsForAggregators.getListPoolsWithAmountsTo(results, signer, TOKEN_IN);
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
      const results = await PoolsForAggregators.collectInfoForOneInch(signer, BASE_NETWORK_ID, TOKEN_IN, TOKEN_OUT, AMOUNT_TO_SWAP.toString());
      const lines = await PoolsForAggregators.getListPoolsWithAmountsTo(results, signer, TOKEN_IN);
      writeFileSyncRestoreFolder(pathOut, lines.join("\n"), {encoding: 'utf8', flag: 'w'});
    });
  });
});