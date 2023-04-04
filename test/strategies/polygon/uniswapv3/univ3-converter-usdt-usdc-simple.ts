import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai from 'chai';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { ethers } from 'hardhat';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  IController__factory,
  IERC20__factory,
  IERC20Metadata__factory,
  IStrategyV2,
  StrategySplitterV2,
  TetuVaultV2,
  UniswapV3ConverterStrategy,
  UniswapV3ConverterStrategy__factory,
} from '../../../../typechain';
import { MaticAddresses } from '../../../../scripts/addresses/MaticAddresses';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { CoreAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/models/CoreAddresses';
import { TokenUtils } from '../../../../scripts/utils/TokenUtils';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { Misc } from '../../../../scripts/utils/Misc';
import { ConverterUtils } from '../../../baseUT/utils/ConverterUtils';
import { DeployerUtilsLocal } from '../../../../scripts/utils/DeployerUtilsLocal';


const { expect } = chai;

describe('univ3-converter-usdt-usdc-simple', function() {

  let snapshotBefore: string;
  let snapshot: string;

  let gov: SignerWithAddress;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

  let core: CoreAddresses;
  let strategy: UniswapV3ConverterStrategy;
  let vault: TetuVaultV2;
  let splitter: StrategySplitterV2;
  let pool: string;
  let asset: string;
  let decimals: number;


  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2] = await ethers.getSigners();
    gov = await Misc.impersonate(MaticAddresses.GOV_ADDRESS);

    core = Addresses.getCore() as CoreAddresses;
    pool = MaticAddresses.UNISWAPV3_USDC_USDT_100;
    asset = MaticAddresses.USDC_TOKEN;
    decimals = await IERC20Metadata__factory.connect(asset, gov).decimals();

    const data = await DeployerUtilsLocal.deployAndInitVaultAndStrategy(
      asset,
      'TetuV2_UniswapV3_USDC-USDT-0.01%',
      async(_splitterAddress: string) => {
        const _strategy = UniswapV3ConverterStrategy__factory.connect(
          await DeployerUtils.deployProxy(signer, 'UniswapV3ConverterStrategy'),
          gov,
        );

        await _strategy.init(
          core.controller,
          _splitterAddress,
          MaticAddresses.TETU_CONVERTER,
          pool,
          0,
          0,
        );

        return _strategy as unknown as IStrategyV2;
      },
      IController__factory.connect(core.controller, gov),
      gov,
      0,
      0,
      0,
      false,
    );

    vault = data.vault;
    strategy = UniswapV3ConverterStrategy__factory.connect(data.strategy.address, gov);
    splitter = data.splitter;

    // setup converter
    await ConverterUtils.whitelist([strategy.address]);
    // Disable platforms at TetuConverter
    await ConverterUtils.disableDForce(signer);
    await ConverterUtils.disableAaveV2(signer);

    // ---
    await TokenUtils.getToken(asset, signer.address, parseUnits('10000', decimals));
    await TokenUtils.getToken(asset, signer2.address, parseUnits('10000', decimals));

    await IERC20__factory.connect(asset, signer).approve(vault.address, parseUnits('10000', decimals));
    await IERC20__factory.connect(asset, signer2).approve(vault.address, parseUnits('10000', decimals));
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });


  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  it('test', async function() {

    const depositAmount1 = parseUnits('1000', decimals);

    const sharePriceBefore = await vault.sharePrice();

    for (let i = 0; i < 1; i++) {

      await vault.connect(signer).deposit(depositAmount1, signer.address);

      const investedAssets = await strategy.investedAssets();
      console.log('investedAssets', formatUnits(investedAssets, decimals));
      expect(investedAssets).above(0);
      expect(await strategy.baseAmounts(MaticAddresses.USDC_TOKEN)).eq(0);
      expect(await strategy.baseAmounts(MaticAddresses.USDT_TOKEN)).eq(0);

      const sharePriceAfterDeposit = await vault.sharePrice();
      expect(sharePriceAfterDeposit).eq(sharePriceBefore);

    }

  });

});
