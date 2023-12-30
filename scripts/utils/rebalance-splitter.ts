import {
  ISplitter__factory,
  IStrategyV2__factory,
  StrategySplitterV2__factory,
  TetuVaultV2__factory,
} from '../../typechain';
import { ethers } from 'hardhat';
import { formatUnits } from 'ethers/lib/utils';
import { txParams2 } from '../../deploy_constants/deploy-helpers';
import { RunHelper } from './RunHelper';

const VAULT = '0x0d397f4515007ae4822703b74b9922508837a04e';
const REBALANCE_AMOUNT = 30_000;
const LOSS_TOLERANCE = 10;

async function main() {
  const [signer] = await ethers.getSigners();
  const splitterAdr = await TetuVaultV2__factory.connect(VAULT, signer).splitter();
  const decimals = await TetuVaultV2__factory.connect(VAULT, signer).decimals();
  const splitter = StrategySplitterV2__factory.connect(splitterAdr, signer);

  const strategies = await splitter.allStrategies();
  let lowestStratApr = 9999999999999999999;
  let lowestStrat = '';
  let lowestStratTvl = 0;

  console.log('all strat', strategies.length);
  let found = false;
  for (const strat of strategies) {
    const total = await IStrategyV2__factory.connect(strat, signer).totalAssets();
    const name = await IStrategyV2__factory.connect(strat, signer).strategySpecificName();
    const cap = await splitter.getStrategyCapacity(strat);

    const apr = (await splitter.averageApr(strat)).toNumber();
    console.log('strat', name, formatUnits(apr, 3), formatUnits(total, decimals));

    if (total.gt(cap.add(1000))) {
      continue;
    }
    if (apr < lowestStratApr) {
      found = true;
      lowestStratApr = apr;
      lowestStrat = strat;
      lowestStratTvl = +formatUnits(total, decimals);
    }
  }
  if (!found) {
    console.log('all strategies at highest capacities');
    return;
  }

  let rebalancePerc = Math.min(Math.floor((REBALANCE_AMOUNT / lowestStratTvl) * 100), 100);
  rebalancePerc = rebalancePerc === 0 ? 1 : rebalancePerc;
  console.log('rebalancePerc', rebalancePerc);
  console.log('lowestStratTvl', lowestStratTvl);
  console.log('lowestStrat', lowestStrat);
  console.log('lowestStratApr', lowestStratApr);

  const gas = await splitter.estimateGas.rebalance(rebalancePerc, LOSS_TOLERANCE);

  const txParam = await txParams2();
  await RunHelper.runAndWaitAndSpeedUp(
    ethers.provider,
    () => splitter.rebalance(rebalancePerc, LOSS_TOLERANCE, { ...txParam, gasLimit: gas.mul(2) }),
  );


  const totalAfter = await IStrategyV2__factory.connect(lowestStrat, signer).totalAssets();
  console.log('totalAfter', +formatUnits(totalAfter, decimals));
}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });


// Kyber USDC/USDT NSR 0x4B8bD2623d7480850E406B9f2960305f44c7aDeb
// Kyber USDC/DAI NSR 0x8EC9134046740F83BDED78d6DDcAdAEC42fC61b0
// UniV3 USDC/USDT-100 NSR 0x6565e8136CD415F053C81Ff3656E72574F726a5E
// Algebra USDC/USDT NSR 0x7bbCDcEe68c3DB2Dce5C9b132E426Ef778b48533


// UniV3 USDC/DAI-100 0x29ce0ca8d0A625Ebe1d0A2F94a2aC9Cc0f9948F1
// UniV3 USDC/USDT-100 0x05C7D307632a36D31D7eECbE4cC5Aa46D15fA752
// Kyber USDC/USDT 0xa2078946E966E27750d5c324D428C4d517231060
// QuickSwapV3 USDC-USDT 0x3019e52aCb4717cDF79323592f1F897d243278F4
