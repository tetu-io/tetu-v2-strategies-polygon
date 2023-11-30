import hre from 'hardhat';
import { VerifyUtils } from './utils/VerifyUtils';

async function main() {
  const { deployments } = hre;

  await verify('StrategyLib');
  await verify('StrategyLib2');
  await verify('ConverterStrategyBaseLib', 'contracts/strategies');
  await verify('ConverterStrategyBaseLib2', 'contracts/strategies');
  await verify('IterationPlanLib', 'contracts/libs');
  await verify('BorrowLib', 'contracts/libs');
  await verify('PairBasedStrategyLib', 'contracts/strategies/pair');
  await verify('PairBasedStrategyLogicLib', 'contracts/strategies/pair');
  await verify('PairBasedStrategyReader', 'contracts/strategies/pair');
  await verify('BalancerLogicLib', 'contracts/strategies/balancer');
  await verify('BalancerBoostedStrategy', 'contracts/strategies/balancer');
  await verify('UniswapV3Lib', 'contracts/strategies/uniswap');
  await verify('UniswapV3DebtLib', 'contracts/strategies/uniswap');
  await verify('UniswapV3ConverterStrategyLogicLib', 'contracts/strategies/uniswap');
  await verify('UniswapV3ConverterStrategy', 'contracts/strategies/uniswap');
  await verify('AlgebraLib', 'contracts/strategies/algebra');
  await verify('AlgebraConverterStrategyLogicLib', 'contracts/strategies/algebra');
  await verify('AlgebraDebtLib', 'contracts/strategies/algebra');
  await verify('AlgebraConverterStrategy', 'contracts/strategies/algebra');
  await verify('KyberLib', 'contracts/strategies/kyber');
  await verify('KyberDebtLib', 'contracts/strategies/kyber');
  await verify('KyberConverterStrategyLogicLib', 'contracts/strategies/kyber');
  await verify('KyberConverterStrategy', 'contracts/strategies/kyber');
  // await verify('RebalanceDebtConfig', 'contracts/tools');
}

async function verify(name: string, pkg?: string) {
  const { deployments } = hre;
  let ctr;
  try {
    ctr = await deployments.get(name);
  } catch (e) {}
  if (!ctr) {
    return;
  }

  if (pkg) {
    await VerifyUtils.verifyWithContractName(ctr.address, `${pkg}/${name}.sol:${name}`);
  } else {
    await VerifyUtils.verify((await deployments.get(name)).address);
  }
}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
