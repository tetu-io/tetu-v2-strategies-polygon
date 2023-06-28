import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai from 'chai';
import { TimeUtils } from '../../../../scripts/utils/TimeUtils';
import { ethers } from 'hardhat';
import { DeployerUtils } from '../../../../scripts/utils/DeployerUtils';
import {
  ControllerV2__factory,
  IController__factory,
  IERC20__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IStrategyV2,
  StrategyBaseV2__factory,
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
import { UniswapV3StrategyUtils } from '../../../UniswapV3StrategyUtils';
import {
  depositToVault,
  doHardWorkForStrategy,
  printVaultState,
  rebalanceUniv3Strategy,
  redeemFromVault,
} from '../../../StrategyTestUtils';
import { BigNumber } from 'ethers';
import {PriceOracleImitatorUtils} from "../../../baseUT/converter/PriceOracleImitatorUtils";
import {MockHelper} from "../../../baseUT/helpers/MockHelper";
import {UniversalTestUtils} from "../../../baseUT/utils/UniversalTestUtils";
import {IStateParams, StateUtilsNum} from "../../../baseUT/utils/StateUtilsNum";


const { expect } = chai;

describe('univ3-converter-usdt-usdc-simple', function() {

//region Variables
  let snapshotBefore: string;
  let snapshot: string;

  let gov: SignerWithAddress;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

  let core: CoreAddresses;
  let strategy: UniswapV3ConverterStrategy;
  let vault: TetuVaultV2;
  let insurance: string;
  let splitter: StrategySplitterV2;
  let pool: string;
  let asset: string;
  let assetCtr: IERC20Metadata;
  let decimals: number;
  let stateParams: IStateParams;
//endregion Variables

//region before, after
  before(async function() {
    // we need to display full objects, so we use util.inspect, see
    // https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
    require("util").inspect.defaultOptions.depth = null;

    snapshotBefore = await TimeUtils.snapshot();
    [signer, signer2] = await ethers.getSigners();
    gov = await Misc.impersonate(MaticAddresses.GOV_ADDRESS);

    core = Addresses.getCore() as CoreAddresses;
    pool = MaticAddresses.UNISWAPV3_USDC_USDT_100;
    asset = MaticAddresses.USDC_TOKEN;
    assetCtr = IERC20Metadata__factory.connect(asset, signer);
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
      300,
      300,
      false,
    );

    vault = data.vault;
    strategy = UniswapV3ConverterStrategy__factory.connect(data.strategy.address, gov);
    splitter = data.splitter;
    insurance = await vault.insurance();

    // setup converter
    await ConverterUtils.whitelist([strategy.address]);
    const state = await strategy.getState()
    await PriceOracleImitatorUtils.uniswapV3(signer, state.pool, state.tokenA)
    // ---

    await IERC20__factory.connect(asset, signer).approve(vault.address, Misc.MAX_UINT);
    await IERC20__factory.connect(asset, signer2).approve(vault.address, Misc.MAX_UINT);

    await ControllerV2__factory.connect(core.controller, gov).registerOperator(signer.address);

    await vault.setWithdrawRequestBlocks(0);

    const profitHolder = await DeployerUtils.deployContract(signer, 'StrategyProfitHolder', strategy.address, [MaticAddresses.USDC_TOKEN, MaticAddresses.USDT_TOKEN])
    const operator = await UniversalTestUtils.getAnOperator(strategy.address, signer)
    await strategy.connect(operator).setStrategyProfitHolder(profitHolder.address);

    stateParams = {
      mainAssetSymbol: await IERC20Metadata__factory.connect(MaticAddresses.USDC_TOKEN, signer).symbol()
    }
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
//endregion before, after

  it('deposit and full exit should not change share price', async function() {
    const DELTA = 100;
    const facade = await MockHelper.createUniswapV3LibFacade(signer); // we need it to generate IState

    await vault.setDoHardWorkOnInvest(false);
    await TokenUtils.getToken(asset, signer2.address, BigNumber.from(10000));
    await vault.connect(signer2).deposit(10000, signer2.address);

    const cycles = 3;
    const depositAmount1 = parseUnits('100000', decimals);
    await TokenUtils.getToken(asset, signer.address, depositAmount1.mul(cycles));

    const balanceBefore = +formatUnits(await assetCtr.balanceOf(signer.address), decimals);

    await printVaultState(
      vault,
      splitter,
      StrategyBaseV2__factory.connect(strategy.address, signer),
      assetCtr,
      decimals,
    );

    const pathOut = `./tmp/deposit_full_exit_states.csv`;
    for (let i = 0; i < cycles; i++) {
      console.log('------------------ CYCLE', i, '------------------');

      const sharePriceBefore = await vault.sharePrice();

      ///////////////////////////
      // DEPOSIT
      ///////////////////////////


      await depositToVault(vault, signer, depositAmount1, decimals, assetCtr, insurance);

      await printVaultState(
        vault,
        splitter,
        StrategyBaseV2__factory.connect(strategy.address, signer),
        assetCtr,
        decimals,
      );
      const state1 = await StateUtilsNum.getState(signer2, signer, strategy, vault, `d1-${i}`);

      expect(await strategy.investedAssets()).above(0);

      const sharePriceAfterDeposit = await vault.sharePrice();
      expect(sharePriceAfterDeposit).eq(sharePriceBefore);

      ///////////////////////////
      // WITHDRAW
      ///////////////////////////

      await redeemFromVault(vault, signer, 50, decimals, assetCtr, insurance);
      await printVaultState(
        vault,
        splitter,
        StrategyBaseV2__factory.connect(strategy.address, signer),
        assetCtr,
        decimals,
      );
      const state2 = await StateUtilsNum.getState(signer2, signer, strategy, vault, `w2-${i}`);
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, [state1, state2], stateParams,true);

      const sharePriceAfterWithdraw = await vault.sharePrice();
      expect(sharePriceAfterWithdraw).approximately(sharePriceAfterDeposit, DELTA);

      await redeemFromVault(vault, signer, 99, decimals, assetCtr, insurance);
      await printVaultState(
        vault,
        splitter,
        StrategyBaseV2__factory.connect(strategy.address, signer),
        assetCtr,
        decimals,
      );
      const state3 = await StateUtilsNum.getState(signer2, signer, strategy, vault, `w3-${i}`);
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, [state1, state2, state3], stateParams,true);

      const sharePriceAfterWithdraw2 = await vault.sharePrice();
      expect(sharePriceAfterWithdraw2).approximately(sharePriceAfterDeposit, DELTA);

      await redeemFromVault(vault, signer, 100, decimals, assetCtr, insurance);
      await printVaultState(
        vault,
        splitter,
        StrategyBaseV2__factory.connect(strategy.address, signer),
        assetCtr,
        decimals,
      );
      const state4 = await StateUtilsNum.getState(signer2, signer, strategy, vault, `d4-${i}`);
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, [state1, state2, state3, state4], stateParams,true);

      const sharePriceAfterWithdraw3 = await vault.sharePrice();
      expect(sharePriceAfterWithdraw3).approximately(sharePriceAfterDeposit, DELTA);
    }

    const balanceAfter = +formatUnits(await assetCtr.balanceOf(signer.address), decimals);
    console.log('balanceBefore', balanceBefore);
    console.log('balanceAfter', balanceAfter);
    expect(balanceAfter).approximately(balanceBefore - (+formatUnits(depositAmount1, 6) * 0.006 * cycles), cycles);

  });

  it('deposit and exit with hard works should not change share price with zero compound', async function() {
    const DELTA = 500;
    const pathOut = `./tmp/deposit_exit_states.csv`;
    const facade = await MockHelper.createUniswapV3LibFacade(signer); // we need it to generate IState
    const states = [];

    await strategy.setFuseThreshold(parseUnits('1'));

    await vault.setDoHardWorkOnInvest(false);
    await TokenUtils.getToken(asset, signer2.address, parseUnits('1', 6));
    await vault.connect(signer2).deposit(parseUnits('1', 6), signer2.address);

    const cycles = 10;

    const depositAmount1 = parseUnits('10000', decimals);
    await TokenUtils.getToken(asset, signer.address, depositAmount1.mul(cycles));
    let swapAmount = parseUnits('100000', decimals);

    const balanceBefore = +formatUnits(await assetCtr.balanceOf(signer.address), decimals);

    for (let i = 0; i < cycles; i++) {
      const sharePriceBefore = await vault.sharePrice();
      console.log('------------------ CYCLE', i, '------------------');

      ///////////////////////////
      // DEPOSIT
      ///////////////////////////


      if (i % 3 === 0) {
        await depositToVault(vault, signer, depositAmount1, decimals, assetCtr, insurance);
        await printVaultState(
          vault,
          splitter,
          StrategyBaseV2__factory.connect(strategy.address, signer),
          assetCtr,
          decimals,
        );
      } else {
        await depositToVault(vault, signer, depositAmount1.div(2), decimals, assetCtr, insurance);
        await printVaultState(
          vault,
          splitter,
          StrategyBaseV2__factory.connect(strategy.address, signer),
          assetCtr,
          decimals,
        );
        await depositToVault(vault, signer, depositAmount1.div(2), decimals, assetCtr, insurance);
        await printVaultState(
          vault,
          splitter,
          StrategyBaseV2__factory.connect(strategy.address, signer),
          assetCtr,
          decimals,
        );
      }

      states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, `d${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);

      expect(await strategy.investedAssets()).above(0);

      await TimeUtils.advanceNBlocks(300);


      if (i % 2 === 0) {
        await UniswapV3StrategyUtils.movePriceUp(
          signer2,
          strategy.address,
          MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
          swapAmount,
        );
      } else {
        await UniswapV3StrategyUtils.movePriceDown(
          signer2,
          strategy.address,
          MaticAddresses.TETU_LIQUIDATOR_UNIV3_SWAPPER,
          swapAmount,
        );
      }

      // we suppose the rebalance happens immediately when it needs
      if (await strategy.needRebalance()) {
        await rebalanceUniv3Strategy(strategy, signer, decimals);
        await printVaultState(
          vault,
          splitter,
          StrategyBaseV2__factory.connect(strategy.address, signer),
          assetCtr,
          decimals,
        );
      }

      states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, `r${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);

      if (i % 2 === 0) {
        const stateHardworkEvents = await doHardWorkForStrategy(
          splitter,
          StrategyBaseV2__factory.connect(strategy.address, signer),
          signer,
          decimals,
        );
        await printVaultState(
          vault,
          splitter,
          StrategyBaseV2__factory.connect(strategy.address, signer),
          assetCtr,
          decimals,
        );
        states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, `h${i}`)); // todo: stateHardworkEvents
      }


      ///////////////////////////
      // WITHDRAW
      ///////////////////////////

      if (i % 7 === 0) {
        await redeemFromVault(vault, signer, 100, decimals, assetCtr, insurance);
        await printVaultState(
          vault,
          splitter,
          StrategyBaseV2__factory.connect(strategy.address, signer),
          assetCtr,
          decimals,
        );
      } else {
        await redeemFromVault(vault, signer, 50, decimals, assetCtr, insurance);
        await printVaultState(
          vault,
          splitter,
          StrategyBaseV2__factory.connect(strategy.address, signer),
          assetCtr,
          decimals,
        );
        await redeemFromVault(vault, signer, 100, decimals, assetCtr, insurance);
        await printVaultState(
          vault,
          splitter,
          StrategyBaseV2__factory.connect(strategy.address, signer),
          assetCtr,
          decimals,
        );
      }


      const sharePriceAfter = await vault.sharePrice();
      // zero compound
      expect(sharePriceAfter).approximately(sharePriceBefore, DELTA);

      // decrease swap amount slowly
      swapAmount = swapAmount.div(2);

      states.push(await StateUtilsNum.getState(signer2, signer, strategy, vault, `w${i}`));
      await StateUtilsNum.saveListStatesToCSVColumns(pathOut, states, stateParams, true);
    }

    const balanceAfter = +formatUnits(await assetCtr.balanceOf(signer.address), decimals);
    console.log('balanceBefore', balanceBefore);
    console.log('balanceAfter', balanceAfter);
    expect(balanceAfter)
      .approximately(balanceBefore - (+formatUnits(depositAmount1, 6) * 0.006 * cycles), 0.2 * cycles);

  });

});
