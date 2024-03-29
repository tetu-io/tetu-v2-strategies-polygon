import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  Bookkeeper__factory,
  ConverterController__factory,
  ConverterStrategyBase__factory,
  IPairBasedDefaultStateProvider__factory,
  StrategySplitterV2__factory, TetuConverter__factory,
  TetuVaultV2__factory
} from "../../typechain";
import {PackedData} from "../baseUT/utils/PackedData";
import {formatUnits} from "ethers/lib/utils";
import {IERC20Metadata__factory} from "../../typechain/factories/@tetu_io/tetu-liquidator/contracts/interfaces";
import {ethers} from "hardhat";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID} from "../baseUT/utils/HardhatUtils";

interface IVaultInfo {
  block: number;
  timestamp: number;
  tvl: number;
  rewardsAprFrom: number;
  compoundApr: number;
  users: number;
  insurance: number;
  totalProfit: number;
  sharePrice: number;
  strategies: IStrategyInfo[];
}

interface IStrategyInfo {
  strategyAddress: string;
  strategyName: string;
  allocatedPercent: number;
  averageApr: number;
  fuseStatus: number;
  debtToInsurance: number;
  previewGains: number;
  previewLosses: number;
}

interface ITask {
  chain: number;
  vault: string;
  strategies: string[];
}

async function getVaultInfo(signer: SignerWithAddress, task: ITask): Promise<IVaultInfo> {
  const vault = TetuVaultV2__factory.connect(task.vault, signer);

  const underlying = await vault.asset();
  const asset = IERC20Metadata__factory.connect(underlying, signer);
  const decimals = await asset.decimals();

  const totalSupplyVault = +formatUnits(await vault.totalSupply(), decimals);
  const totalAssetsVault = +formatUnits(await vault.totalAssets(), decimals);
  const insurance = +formatUnits(
    await asset.balanceOf(await vault.insurance()),
    decimals
  );
  const sharePrice = totalAssetsVault / totalSupplyVault;

  const blockNumber = ethers.getDefaultProvider().blockNumber;
  const blockData = await ethers.getDefaultProvider().getBlock(blockNumber);

  const strategies = await Promise.all(task.strategies.map(
    async x => getStrategyInfo(signer, x)
  ))

  return {
    block: ethers.getDefaultProvider().blockNumber,
    compoundApr: 0, // todo
    rewardsAprFrom: 0, // todo
    users: 0, // todo
    totalProfit: totalAssetsVault - totalSupplyVault,
    insurance,
    sharePrice,
    tvl: totalAssetsVault,
    timestamp: blockData.timestamp,
    strategies
  }
}

async function getStrategyInfo(signer: SignerWithAddress, strategy: string): Promise<IStrategyInfo> {
  const converterStrategyBase = ConverterStrategyBase__factory.connect(strategy, signer);
  const pairBasedStrategy = IPairBasedDefaultStateProvider__factory.connect(strategy, signer);
  const splitter = StrategySplitterV2__factory.connect(await converterStrategyBase.splitter(), signer);
  const vault = TetuVaultV2__factory.connect(await splitter.vault(), signer);

  const underlying = await vault.asset();
  const decimals = await IERC20Metadata__factory.connect(underlying, signer).decimals();

  const totalSupplyVault = +formatUnits(await vault.totalSupply(), decimals);
  const totalAssetsVault = +formatUnits(await vault.totalAssets(), decimals);
  const insurance = +formatUnits(await vault.insurance(), decimals);
  const sharePrice = totalAssetsVault / totalSupplyVault;

  const strategyName = await converterStrategyBase.strategySpecificName();
  const averageApr = +formatUnits(await splitter.averageApr(strategy), 3);
  const totalAssetStrategy = +formatUnits(await converterStrategyBase.totalAssets(), decimals);
  const allocatedPercent = totalAssetStrategy * 100 / totalAssetsVault;
  const debtToInsurance = +formatUnits(await converterStrategyBase.debtToInsurance(), decimals);

  const data = await PackedData.getDefaultState(pairBasedStrategy);

  const preview = await Bookkeeper__factory.connect(
    await ConverterController__factory.connect(
      await TetuConverter__factory.connect(await converterStrategyBase.converter(), signer).controller(),
      signer
    ).bookkeeper(),
    signer
  ).previewPeriod(underlying, strategy);

  return {
    allocatedPercent,
    averageApr,
    fuseStatus: data.fuseStatus,
    debtToInsurance,
    strategyAddress: strategy,
    strategyName,
    previewGains: +formatUnits(preview.gains, decimals),
    previewLosses: +formatUnits(preview.losses, decimals),
  }
}

const TASKS: ITask[] = [
  {
    chain: BASE_NETWORK_ID,
    vault: "0x68f0a05FDc8773d9a5Fd1304ca411ACc234ce22c",
    strategies: ["0xAA43e2cc199DC946b3D528c6E00ebb3F4CC2fC0e"]
  },
  // {
  //   chain: POLYGON_NETWORK_ID,
  //   vault: "0x0D397F4515007AE4822703b74b9922508837A04E",
  //   strategies: ["0xCdc5560AB926Dca3d4989bF814469Af3f989Ab2C"]
  // }
];

describe("base", () => {
  TASKS.forEach(function (task: ITask) {
    it(`generate data ${task.chain}`, async () => {
      const [signer] = await ethers.getSigners();
      await HardhatUtils.switchToMostCurrentBlock(task.chain);

      const ret = await getVaultInfo(signer, task);
      console.log("ret", ret);
    })
  });
});