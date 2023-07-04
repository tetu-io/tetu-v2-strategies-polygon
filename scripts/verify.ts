import hre from 'hardhat';
import { VerifyUtils } from './utils/VerifyUtils';

async function main() {
  const { deployments } = hre;

  await hre.run("verify:verify", {
    address: '0x3CFb9dB5bAc2137491853175a8CBF9FfAcE5C9dd',
    libraries: {
      StrategyLib: '0x6d1f7FE0d9D168B6b2cEC568f2b8aA2bcAb942cf',
    }
  })

  // await VerifyUtils.verify((await deployments.get('StrategyLib')).address);
  // await VerifyUtils.verify((await deployments.get('ConverterStrategyBaseLib')).address);
  // await VerifyUtils.verify((await deployments.get('ConverterStrategyBaseLib2')).address);

  // await VerifyUtils.verify((await deployments.get('UniswapV3Lib')).address);
  // await VerifyUtils.verify((await deployments.get('UniswapV3DebtLib')).address);
  // await VerifyUtils.verify((await deployments.get('UniswapV3ConverterStrategyLogicLib')).address);
  // await VerifyUtils.verify((await deployments.get('UniswapV3ConverterStrategy')).address);

  // await VerifyUtils.verify((await deployments.get('AlgebraLib')).address);
  // await VerifyUtils.verify((await deployments.get('AlgebraConverterStrategyLogicLib')).address);
  // await VerifyUtils.verify((await deployments.get('AlgebraDebtLib')).address);
  // await VerifyUtils.verify((await deployments.get('AlgebraConverterStrategy')).address);


  // await VerifyUtils.verify((await deployments.get('BalancerLogicLib')).address);
  // await VerifyUtils.verify((await deployments.get('BalancerBoostedStrategy')).address);

  // await VerifyUtils.verify((await deployments.get('KyberLib')).address);
  // await VerifyUtils.verify((await deployments.get('KyberDebtLib')).address);
  // await VerifyUtils.verify((await deployments.get('KyberConverterStrategyLogicLib')).address);
  // await VerifyUtils.verify((await deployments.get('KyberConverterStrategy')).address);
}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
