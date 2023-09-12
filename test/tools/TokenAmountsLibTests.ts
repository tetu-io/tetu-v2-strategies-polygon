import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { DeployerUtils } from '../../scripts/utils/DeployerUtils';
import { TokenAmountsLibTest } from '../../typechain';
import { PolygonAddresses as PA } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';
import { BigNumber, utils } from 'ethers';
import {
  GAS_FILTER_2_ALL_AMOUNTS_NOT_ZERO,
  GAS_FILTER_2_ALL_AMOUNTS_ZERO,
  GAS_FILTER_2_SECOND_AMOUNT_ZERO,
} from '../baseUT/GasLimits';
import { controlGasLimitsEx } from '../../scripts/utils/GasLimitUtils';
import { HARDHAT_NETWORK_ID, HardhatUtils } from '../baseUT/utils/HardhatUtils';


const { expect } = chai;
chai.use(chaiAsPromised);

describe('TokenAmountsLib tests', function() {
  let signer: SignerWithAddress;

  let lib: TokenAmountsLibTest;
  const _addr = utils.getAddress;

  before(async function() {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    [signer] = await ethers.getSigners();

    lib = await DeployerUtils.deployContract(signer, 'TokenAmountsLibTest') as TokenAmountsLibTest;
  });

  describe('filterZeroAmounts', async() => {

    describe('Good paths', () => {
      describe('Zero amounts exist', () => {
        it('at index 0', async() => {
          const tokens = [
            PA.USDC_TOKEN,
            PA.DAI_TOKEN,
            PA.TETU_TOKEN,
          ];
          const amounts = [0, 1, 2];
          const filtered = await lib.filterZeroAmounts(tokens, amounts);
          // await lib.print(filtered[0], filtered[1]);

          expect(filtered[0].length).eq(2);
          expect(filtered[0]).deep.equal([
            _addr(PA.DAI_TOKEN),
            _addr(PA.TETU_TOKEN),
          ]);
          expect(filtered[1][0]).eq(1);
          expect(filtered[1][1]).eq(2);
        });

        it('at index 1', async() => {
          const tokens = [
            PA.USDC_TOKEN,
            PA.DAI_TOKEN,
            PA.TETU_TOKEN,
          ];
          const amounts = [1, 0, 2];
          const filtered = await lib.filterZeroAmounts(tokens, amounts);
          // await lib.print(filtered[0], filtered[1]);

          expect(filtered[0].length).eq(2);
          expect(filtered[0]).deep.equal([
            _addr(PA.USDC_TOKEN),
            _addr(PA.TETU_TOKEN),
          ]);
          expect(filtered[1][0]).eq(1);
          expect(filtered[1][1]).eq(2);
        });

        it('at index 2', async() => {
          const tokens = [
            PA.USDC_TOKEN,
            PA.DAI_TOKEN,
            PA.TETU_TOKEN,
          ];
          const amounts = [1, 2, 0];
          const filtered = await lib.filterZeroAmounts(tokens, amounts);
          // await lib.print(filtered[0], filtered[1]);

          expect(filtered[0].length).eq(2);
          expect(filtered[0]).deep.equal([
            _addr(PA.USDC_TOKEN),
            _addr(PA.DAI_TOKEN),
          ]);
          expect(filtered[1][0]).eq(1);
          expect(filtered[1][1]).eq(2);
        });

        it('all zeros', async() => {
          const tokens = [
            PA.USDC_TOKEN,
            PA.DAI_TOKEN,
            PA.TETU_TOKEN,
          ];
          const amounts = [0, 0, 0];
          const filtered = await lib.filterZeroAmounts(tokens, amounts);
          // await lib.print(filtered[0], filtered[1]);

          expect(filtered[0].length).eq(0);
          expect(filtered[1].length).eq(0);
        });
      });
      it('empty array', async() => {
        const tokens: string[] = [];
        const amounts: BigNumber[] = [];
        const filtered = await lib.filterZeroAmounts(tokens, amounts);
        // await lib.print(filtered[0], filtered[1]);

        expect(filtered[0].length).eq(0);
        expect(filtered[1].length).eq(0);
      });
    });

    describe('Bad paths', () => {
      it('array mismatch', async() => {
        const tokens = [
          PA.USDC_TOKEN,
          PA.DAI_TOKEN,
          PA.TETU_TOKEN,
        ];
        const amounts = [0, 0];

        await expect(lib.filterZeroAmounts(tokens, amounts)).revertedWith('TS-19 lengths'); // AppErrors.INCORRECT_LENGTHS
      });
    });

    describe('Gas estimation @skip-on-coverage', () => {
      it('Two tokens, no zero amounts', async() => {
        const tokens = [PA.USDC_TOKEN, PA.DAI_TOKEN];
        const amounts = [1, 2];
        const gasUsed = await lib.estimateGas.filterZeroAmounts(tokens, amounts);

        controlGasLimitsEx(gasUsed, GAS_FILTER_2_ALL_AMOUNTS_NOT_ZERO, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });

      it('Two tokens, both amounts are zero', async() => {
        const tokens = [PA.USDC_TOKEN, PA.DAI_TOKEN];
        const amounts = [0, 0];
        const gasUsed = await lib.estimateGas.filterZeroAmounts(tokens, amounts);

        controlGasLimitsEx(gasUsed, GAS_FILTER_2_ALL_AMOUNTS_ZERO, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });

      it('Two tokens, second amount is zero', async() => {
        const tokens = [PA.USDC_TOKEN, PA.DAI_TOKEN];
        const amounts = [1, 0];
        const gasUsed = await lib.estimateGas.filterZeroAmounts(tokens, amounts);

        controlGasLimitsEx(gasUsed, GAS_FILTER_2_SECOND_AMOUNT_ZERO, (u, t) => {
          expect(u).to.be.below(t + 1);
        });
      });
    });
  });

  describe('combineArrays', () => {
    describe('Good paths', () => {
      it('should return empty array if all arrays are empty', async() => {
        const r = await lib.combineArrays(
          [], [],
          [], [],
          [], [],
        );

        const ret = [r.allTokens.length, r.allAmounts.length].join();
        const expected = [0, 0].join();

        expect(ret.toLowerCase()).eq(expected.toLowerCase());
      });
      it('should return all items if first array is empty', async() => {
        const r = await lib.combineArrays(
          [], [],
          [PA.DAI_TOKEN], [2],
          [PA.TETU_TOKEN], [3],
        );

        const ret = [r.allTokens.join(), r.allAmounts.join()].join('\n');
        const expected = [
          [PA.DAI_TOKEN, PA.TETU_TOKEN].join(),
          [2, 3].join(),
        ].join('\n');
        expect(ret.toLowerCase()).eq(expected.toLowerCase());
      });
      it('should return all items if second array is empty', async() => {
        const r = await lib.combineArrays(
          [PA.DAI_TOKEN], [2],
          [], [],
          [PA.TETU_TOKEN], [3],
        );

        const ret = [r.allTokens.join(), r.allAmounts.join()].join('\n');
        const expected = [
          [PA.DAI_TOKEN, PA.TETU_TOKEN].join(),
          [2, 3].join(),
        ].join('\n');
        expect(ret.toLowerCase()).eq(expected.toLowerCase());
      });
      it('should return all items if third array is empty', async() => {
        const r = await lib.combineArrays(
          [PA.DAI_TOKEN], [2],
          [PA.TETU_TOKEN], [3],
          [], [],
        );

        const ret = [r.allTokens.join(), r.allAmounts.join()].join('\n');
        const expected = [
          [PA.DAI_TOKEN, PA.TETU_TOKEN].join(),
          [2, 3].join(),
        ].join('\n');
        expect(ret.toLowerCase()).eq(expected.toLowerCase());
      });
      it('should return all items if no duplicates in input arrays', async() => {
        const r = await lib.combineArrays(
          [PA.USDC_TOKEN], [1],
          [PA.DAI_TOKEN], [2],
          [PA.TETU_TOKEN], [3],
        );

        const ret = [r.allTokens.join(), r.allAmounts.join()].join('\n');
        const expected = [
          [PA.USDC_TOKEN, PA.DAI_TOKEN, PA.TETU_TOKEN].join(),
          [1, 2, 3].join(),
        ].join('\n');

        expect(ret.toLowerCase()).eq(expected.toLowerCase());
      });
      it('should return single item if all input arrays contain same token', async() => {
        const r = await lib.combineArrays(
          [PA.USDC_TOKEN, PA.USDC_TOKEN], [1, 2],
          [PA.USDC_TOKEN], [3],
          [PA.USDC_TOKEN, PA.USDC_TOKEN, PA.USDC_TOKEN], [4, 5, 6],
        );

        const ret = [r.allTokens.join(), r.allAmounts.join()].join('\n');
        const expected = [PA.USDC_TOKEN, 21].join('\n');

        expect(ret.toLowerCase()).eq(expected.toLowerCase());
      });

      it('should return all items if duplicates exist in input arrays', async() => {
        const r = await lib.combineArrays(
          [PA.USDC_TOKEN, PA.DAI_TOKEN], [1, 2],
          [PA.DAI_TOKEN], [3],
          [PA.TETU_TOKEN, PA.DAI_TOKEN, PA.USDC_TOKEN], [4, 5, 6],
        );

        const ret = [r.allTokens.join(), r.allAmounts.join()].join('\n');
        const expected = [
          [PA.USDC_TOKEN, PA.DAI_TOKEN, PA.TETU_TOKEN].join(),
          [7, 10, 4].join(),
        ].join('\n');

        expect(ret.toLowerCase()).eq(expected.toLowerCase());
      });
    });
    describe('Bad paths', () => {
      it('array mismatch 1', async() => {
        const tokens1 = [PA.USDC_TOKEN, PA.DAI_TOKEN, PA.TETU_TOKEN];
        const amounts1 = [0, 0]; // (!)
        const tokens2 = [PA.USDC_TOKEN, PA.DAI_TOKEN, PA.TETU_TOKEN];
        const amounts2 = [0, 0, 0];
        const tokens3 = [PA.USDC_TOKEN, PA.DAI_TOKEN, PA.TETU_TOKEN];
        const amounts3 = [0, 0, 0];

        await expect(
          lib.combineArrays(
            tokens1, amounts1,
            tokens2, amounts2,
            tokens3, amounts3,
          ),
        ).revertedWith('TS-19 lengths'); // AppErrors.INCORRECT_LENGTHS
      });
      it('array mismatch 2', async() => {
        const tokens1 = [PA.USDC_TOKEN, PA.DAI_TOKEN, PA.TETU_TOKEN];
        const amounts1 = [0, 0, 0];
        const tokens2 = [PA.USDC_TOKEN, PA.DAI_TOKEN, PA.TETU_TOKEN];
        const amounts2 = [0, 0, 0, 0]; // (!)
        const tokens3 = [PA.USDC_TOKEN, PA.DAI_TOKEN, PA.TETU_TOKEN];
        const amounts3 = [0, 0, 0];

        await expect(
          lib.combineArrays(
            tokens1, amounts1,
            tokens2, amounts2,
            tokens3, amounts3,
          ),
        ).revertedWith('TS-19 lengths'); // AppErrors.INCORRECT_LENGTHS
      });
      it('array mismatch 3', async() => {
        const tokens1 = [PA.USDC_TOKEN, PA.DAI_TOKEN, PA.TETU_TOKEN];
        const amounts1 = [0, 0, 0];
        const tokens2 = [PA.USDC_TOKEN, PA.DAI_TOKEN, PA.TETU_TOKEN];
        const amounts2 = [0, 0, 0];
        const tokens3 = [PA.TETU_TOKEN]; // (!)
        const amounts3 = [0, 0, 0];

        await expect(
          lib.combineArrays(
            tokens1, amounts1,
            tokens2, amounts2,
            tokens3, amounts3,
          ),
        ).revertedWith('TS-19 lengths'); // AppErrors.INCORRECT_LENGTHS
      });
    });
  });

  describe('uncheckedInc', () => {
    it('should return incremented value', async() => {
      expect((await lib.uncheckedInc(10)).toNumber()).eq(11);
    });
  });

});
