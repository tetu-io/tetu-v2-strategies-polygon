import {
  IConverterController__factory,
  IERC20__factory,
  IERC20Metadata__factory,
  IPlatformAdapter__factory,
  ITetuConverter,
  ITetuConverter__factory,
} from '../../typechain';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { BalanceUtils } from '../baseUT/utils/BalanceUtils';
import { TimeUtils } from '../../scripts/utils/TimeUtils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Misc } from '../../scripts/utils/Misc';
import { MaticHolders } from '../../scripts/addresses/MaticHolders';

interface IFindBorrowStrategyInput {
  collateralAsset: string;
  amountIn: BigNumber;
  borrowAsset: string;
}

async function disablePlatformAdapter(
  signer: SignerWithAddress,
  platformAdapter: string,
  converter: ITetuConverter,
) {
  console.log(`disable ${platformAdapter}`);
  const converterControllerAddr = await converter.controller();
  const converterController = IConverterController__factory.connect(converterControllerAddr, signer);
  const converterControllerGovernanceAddr = await converterController.governance();
  const converterControllerGovernance = await Misc.impersonate(converterControllerGovernanceAddr);
  const platformAdapterDForce = IPlatformAdapter__factory.connect(platformAdapter, converterControllerGovernance);
  await platformAdapterDForce.setFrozen(true);
  console.log(`disable ${platformAdapter} done.\n\n`);
}

describe.skip('issue230310, study mine with interval > 1', () => {
  it('study', async() => {
    const converterAddress = '0x298F30E21f0dfa3718b9C31ae27c8A5E6A88B95E';
    const signer = (await ethers.getSigners())[0];

    const converter = ITetuConverter__factory.connect(converterAddress, signer);

    // Disable DForce (as it reverts on repay after block advance)
    await disablePlatformAdapter(signer, '0x6F4ff8c26727F74103D9dDd7aF33d6c57913Ed06', converter);

    // Disable Hundred Finance (no liquidity)
    await disablePlatformAdapter(signer, '0xf0331230Cd31288A887897975130d00915eaF325', converter);

    const borrows: IFindBorrowStrategyInput[] = [
      {
        collateralAsset: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
        amountIn: BigNumber.from('16616700000'),
        borrowAsset: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
      },
      {
        collateralAsset: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
        amountIn: BigNumber.from('16616700000'),
        borrowAsset: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
      },
      {
        collateralAsset: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
        amountIn: BigNumber.from('33874516337'),
        borrowAsset: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
      },
      {
        collateralAsset: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
        amountIn: BigNumber.from('30658733565'),
        borrowAsset: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
      },
      {
        collateralAsset: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
        amountIn: BigNumber.from('2380967055'),
        borrowAsset: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
      },
      {
        collateralAsset: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
        amountIn: BigNumber.from('800726625'),
        borrowAsset: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
      },
    ];

    for (let i = 0; i < 10; ++i) {
      for (const borrow of borrows) {
        console.log('borrow', borrow);
        const convertStrategies = await converter.callStatic.findBorrowStrategies(
          '0x',
          borrow.collateralAsset,
          borrow.amountIn,
          borrow.borrowAsset,
          1296000,
        );
        console.log('convertStrategies', convertStrategies);

        await BalanceUtils.getRequiredAmountFromHolders(
          convertStrategies.collateralAmountsOut[0],
          IERC20Metadata__factory.connect(borrow.collateralAsset, signer),
          [MaticHolders.HOLDER_USDC],
          signer.address,
        );
        await IERC20__factory.connect(borrow.collateralAsset, signer)
          .approve(converter.address, convertStrategies.collateralAmountsOut[0]);
        await converter.borrow(
          convertStrategies.converters[0],
          borrow.collateralAsset,
          convertStrategies.collateralAmountsOut[0],
          borrow.borrowAsset,
          convertStrategies.amountToBorrowsOut[0],
          signer.address,
        );
        console.log('borrow.done');
        await TimeUtils.advanceNBlocks(20_000);
      }
    }
  });
});
