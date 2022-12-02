import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers} from 'hardhat';
import {DeployerUtils} from '../../scripts/utils/DeployerUtils';
import {
  TokenAmountsLib,
} from '../../typechain';
import {PolygonAddresses as PA} from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';
import {BigNumber, utils} from "ethers";


const {expect} = chai;
chai.use(chaiAsPromised);

describe('TokenAmountsLib tests', function () {
  let signer: SignerWithAddress;

  let lib: TokenAmountsLib;
  const _addr = utils.getAddress;

  before(async function () {
    [signer] = await ethers.getSigners()

    lib = await DeployerUtils.deployContract(signer, 'TokenAmountsLib') as TokenAmountsLib;
  });

  ////////////////////////// TESTS ///////////////////////////

  it('print', async () => {
    const tokens = [
      PA.USDC_TOKEN,
      PA.DAI_TOKEN,
      PA.TETU_TOKEN,
    ];
    const amounts = [0, 1, 2];
    await lib.print(tokens, amounts);
  });

  it('filterZeroAmounts', async () => {
    {
      const tokens = [
        PA.USDC_TOKEN,
        PA.DAI_TOKEN,
        PA.TETU_TOKEN,
      ];
      const amounts = [0, 1, 2];
      const filtered = await lib.filterZeroAmounts(tokens, amounts);
      await lib.print(filtered[0], filtered[1]);

      expect(filtered[0].length).eq(2);
      expect(filtered[0]).deep.equal([
        _addr(PA.DAI_TOKEN),
        _addr(PA.TETU_TOKEN),
      ]);
      expect(filtered[1][0]).eq(1);
      expect(filtered[1][1]).eq(2);
    }
    {
      const tokens = [
        PA.USDC_TOKEN,
        PA.DAI_TOKEN,
        PA.TETU_TOKEN,
      ];
      const amounts = [1, 0, 2];
      const filtered = await lib.filterZeroAmounts(tokens, amounts);
      await lib.print(filtered[0], filtered[1]);

      expect(filtered[0].length).eq(2);
      expect(filtered[0]).deep.equal([
        _addr(PA.USDC_TOKEN),
        _addr(PA.TETU_TOKEN),
      ]);
      expect(filtered[1][0]).eq(1);
      expect(filtered[1][1]).eq(2);
    }
    {
      const tokens = [
        PA.USDC_TOKEN,
        PA.DAI_TOKEN,
        PA.TETU_TOKEN,
      ];
      const amounts = [1, 2, 0];
      const filtered = await lib.filterZeroAmounts(tokens, amounts);
      await lib.print(filtered[0], filtered[1]);

      expect(filtered[0].length).eq(2);
      expect(filtered[0]).deep.equal([
        _addr(PA.USDC_TOKEN),
        _addr(PA.DAI_TOKEN),
      ]);
      expect(filtered[1][0]).eq(1);
      expect(filtered[1][1]).eq(2);
    }
    {
      const tokens: string[] = [];
      const amounts: BigNumber[] = [];
      const filtered = await lib.filterZeroAmounts(tokens, amounts);
      await lib.print(filtered[0], filtered[1]);

      expect(filtered[0].length).eq(0);
      expect(filtered[1].length).eq(0);
    }
    {
      const tokens = [
        PA.USDC_TOKEN,
        PA.DAI_TOKEN,
        PA.TETU_TOKEN,
      ];
      const amounts = [0, 0, 0];
      const filtered = await lib.filterZeroAmounts(tokens, amounts);
      await lib.print(filtered[0], filtered[1]);

      expect(filtered[0].length).eq(0);
      expect(filtered[1].length).eq(0);
    }
  });

  it('unite', async () => {
    {
      const tokens1 = [
        PA.USDC_TOKEN,
        PA.DAI_TOKEN,
        PA.TETU_TOKEN,
      ];
      const amounts1 = [1, 2, 3];
      const tokens2: string[] = [];
      const amounts2: BigNumber[] = [];
      const united = await lib.unite(tokens1, amounts1, tokens2, amounts2);
      await lib.print(united[0], united[1]);

      expect(united[0].length).eq(3);
      expect(united[0]).deep.equal([
        _addr(PA.USDC_TOKEN),
        _addr(PA.DAI_TOKEN),
        _addr(PA.TETU_TOKEN),
      ]);
      expect(united[1][0]).eq(1);
      expect(united[1][1]).eq(2);
      expect(united[1][2]).eq(3);
    }
    {
      const tokens1 = [
        PA.USDC_TOKEN,
        PA.DAI_TOKEN,
        PA.TETU_TOKEN,
      ];
      const amounts1 = [1, 2, 3];
      const tokens2 = [
        PA.USDT_TOKEN,
        PA.DAI_TOKEN,
        PA.TETU_TOKEN,
      ];
      const amounts2 = [1, 2, 3];
      const united = await lib.unite(tokens1, amounts1, tokens2, amounts2);
      await lib.print(united[0], united[1]);

      expect(united[0].length).eq(4);
      expect(united[0]).deep.equal([
        _addr(PA.USDC_TOKEN),
        _addr(PA.DAI_TOKEN),
        _addr(PA.TETU_TOKEN),
        _addr(PA.USDT_TOKEN),
      ]);
      expect(united[1][0]).eq(1);
      expect(united[1][1]).eq(4);
      expect(united[1][2]).eq(6);
      expect(united[1][3]).eq(1);
    }
  });

});
