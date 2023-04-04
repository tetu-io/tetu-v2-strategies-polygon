import { loadFixture, mine } from '@nomicfoundation/hardhat-network-helpers';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { config as dotEnvConfig } from 'dotenv';
import { ERC4626Strict, ExternalRateProvider, TetuV1SingleTokenStrictStrategy } from '../../../../typechain'
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { Consts } from '../../../../deploy_constants/constatants';
import ERC4626LinearPoolFactoryABI from '../../../../scripts/abis/ERC4626LinearPoolFactory.json';
import BalancerVaultABI from '../../../../scripts/abis/BalancerVault.json';
import LinearPoolABI from '../../../../scripts/abis/LinearPool.json';
import LinearPoolRebalancerABI from '../../../../scripts/abis/LinearPoolRebalancer.json';

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: 'boolean',
      default: false,
    },
    hardhatChainId: {
      type: 'number',
      default: 137,
    },
  }).argv;

chai.use(chaiAsPromised);

const ST_MATIC_ADDRESS = '0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4'
const T_ST_MATIC_ADDRESS = '0xF813a454C975ad418e8dB18764a2191D182478F4'
const ST_MATIC_RATE_PROVIDER_ADDRESS = '0xdEd6C522d803E35f65318a9a4d7333a22d582199'

describe('ExternalRateProvider tests', async() => {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return;
  }

  async function deployContracts() {
    const ExternalRateProviderFactory = await ethers.getContractFactory('ExternalRateProvider');
    const rateProvider = await ExternalRateProviderFactory.deploy(
      ST_MATIC_ADDRESS,
      T_ST_MATIC_ADDRESS,
      ST_MATIC_RATE_PROVIDER_ADDRESS,
    ) as ExternalRateProvider;

    const externalRateProvider = await ethers.getContractAt('IRateProvider', ST_MATIC_RATE_PROVIDER_ADDRESS);
    const tStMaticVault = await ethers.getContractAt('IERC4626', T_ST_MATIC_ADDRESS);

    return { rateProvider, externalRateProvider, tStMaticVault };
  }

  describe('Common tests', function() {
    it('Rate calculation test', async function() {
      const { rateProvider, externalRateProvider, tStMaticVault } = await loadFixture(deployContracts);
      const rate = await rateProvider.getRate();
      const vaultRate = await tStMaticVault.convertToAssets(BigNumber.from(10).pow(18));
      const externalRate = await externalRateProvider.getRate();
      const expectedRate = vaultRate.mul(externalRate).div(BigNumber.from(10).pow(18));
      expect(rate.toString().length).is.eq(19);
      expect(rate).is.eq(expectedRate);
    });
  });

});
