import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {InjectUtils} from "../baseUT/strategies/InjectUtils";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID} from "../baseUT/utils/HardhatUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {
  ConverterStrategyBase,
  ConverterStrategyBase__factory, IERC20Metadata, IERC20Metadata__factory,
  ISplitter__factory, ITetuVaultV2,
  ITetuVaultV2__factory, TetuVaultV2, TetuVaultV2__factory
} from "../../typechain";
import {BigNumber} from "ethers";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../scripts/utils/Misc";
import {TokenUtils} from "../../scripts/utils/TokenUtils";
import {expect} from "chai";
import {Addresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses";
import {CoreAddresses} from "@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses";
import {BaseAddresses} from "../../scripts/addresses/BaseAddresses";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";

describe("Checklist @skip-on-coverage", () => {
  interface IStrategyInfo {
    name: string;
    address: string;
  }
  interface IChainInfo {
    chainId: number;
    tetuConverterAddress: string;
    strategies: IStrategyInfo[];
  }

  const TARGETS: IChainInfo[] = [
    {
      chainId: BASE_NETWORK_ID,
      tetuConverterAddress: BaseAddresses.TETU_CONVERTER,
      strategies: [{name: "UniswapV3ConverterStrategy", address: "0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e"}]
    },
    {
      chainId: POLYGON_NETWORK_ID,
      tetuConverterAddress: MaticAddresses.TETU_CONVERTER,
      strategies: [
        {name: "UniswapV3ConverterStrategy", address: "0xCdc5560AB926Dca3d4989bF814469Af3f989Ab2C"},
        {name: "AlgebraConverterStrategy", address: "0xA8105284aA9C9A20A2081EEE1ceeF03d9719A5AD"},
      ]
    },
  ]

  TARGETS.forEach(function (chainInfo: IChainInfo) {
    describe(`Select chain ${chainInfo.chainId}`, () => {
      let snapshot0: string;
      let signer: SignerWithAddress;
      before(async function () {
        snapshot0 = await TimeUtils.snapshot();
        [signer] = await ethers.getSigners();
        await HardhatUtils.setupBeforeTest(chainInfo.chainId);
      });
      after(async function () {
        await TimeUtils.rollback(snapshot0);
      });

      describe("Update Tetu Converter and adapters", () => {
        let snapshot1: string;
        before(async function () {
          snapshot1 = await TimeUtils.snapshot();
          const core = Addresses.CORE.get(chainInfo.chainId) as CoreAddresses;
          await InjectUtils.injectTetuConverterBeforeAnyTest(signer, core, chainInfo.tetuConverterAddress);
        });
        after(async function () {
          await TimeUtils.rollback(snapshot1);
        });

        chainInfo.strategies.forEach(function (strategyInfo: IStrategyInfo) {
          describe("Deposit 1000 usdc then update strategy", () => {
            let snapshot2: string;
            let strategy: ConverterStrategyBase;
            let vault: TetuVaultV2;
            let asset: IERC20Metadata;
            let assetDecimals: number;
            let amount: BigNumber;

            before(async function () {
              snapshot2 = await TimeUtils.snapshot();
              strategy = ConverterStrategyBase__factory.connect(strategyInfo.address, signer);
              vault = TetuVaultV2__factory.connect(
                await ISplitter__factory.connect(await strategy.splitter(), signer).vault(),
                signer
              );
              asset = IERC20Metadata__factory.connect(await strategy.asset(), signer);
              assetDecimals = await asset.decimals();
              amount = parseUnits("1000", assetDecimals);

              await asset.approve(vault.address, Misc.MAX_UINT);
              await TokenUtils.getToken(asset.address, signer.address, amount.mul(2));
              await vault.deposit(amount, signer.address);

              await InjectUtils.injectStrategy(signer, strategyInfo.address, strategyInfo.name);
            });
            after(async function () {
              await TimeUtils.rollback(snapshot2);
            });

            it("Should successfully deposit/withdraw", async () => {
              await vault.deposit(amount, signer.address);
              await TimeUtils.advanceNBlocks(10);
              await vault.withdrawAll();

              const withdrawn = +formatUnits(await asset.balanceOf(signer.address), assetDecimals);
              expect(withdrawn).approximately(2000*(100000-600)/100000, 1);
            });
          });
        });
      });
    });
  });
});