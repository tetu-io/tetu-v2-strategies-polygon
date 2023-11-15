import { ethers } from 'hardhat';
import { IBVault, IBVault__factory, IERC20__factory } from '../../typechain';
import { RunHelper } from './RunHelper';
import { BaseAddresses } from '../addresses/BaseAddresses';
import { parseUnits } from 'ethers/lib/utils';
import { txParams2 } from '../../deploy_constants/deploy-helpers';
import { Misc } from './Misc';

const tUSDbC = '0x68f0a05FDc8773d9a5Fd1304ca411ACc234ce22c';
const POOL = '0x0C316e55f987Ef2d467F18852301492bcA7E8a69';
const POOL_ID = '0x0c316e55f987ef2d467f18852301492bca7e8a690000000000000000000000bc';

async function main() {
  const [signer] = await ethers.getSigners();

  const vault = IBVault__factory.connect('0xBA12222222228d8Ba445958a75a0704d566BF2C8', signer);

  const amount1 = parseUnits('1', 6);

  const userData = ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256[]'], [0, [0, amount1, amount1]]);

  const joinReq: IBVault.JoinPoolRequestStruct = {
    assets: [POOL, tUSDbC, BaseAddresses.USDbC_TOKEN],
    maxAmountsIn: [Misc.MAX_UINT, Misc.MAX_UINT, Misc.MAX_UINT],
    userData,
    fromInternalBalance: false,
  };

  const params = await txParams2();

  const token0 = IERC20__factory.connect(tUSDbC, signer);
  const token1 = IERC20__factory.connect(BaseAddresses.USDbC_TOKEN, signer);

  if ((await token0.allowance(signer.address, vault.address)).lt(amount1)) {
    await RunHelper.runAndWaitAndSpeedUp(ethers.provider, () => token0.approve(vault.address, Misc.MAX_UINT, { ...params }));
  }

  if ((await token1.allowance(signer.address, vault.address)).lt(amount1)) {
    await RunHelper.runAndWaitAndSpeedUp(ethers.provider, () => token1.approve(vault.address, Misc.MAX_UINT, { ...params }));
  }

  const gas = await vault.estimateGas.joinPool(
    POOL_ID,
    signer.address,
    signer.address,
    joinReq,
  );

  await RunHelper.runAndWaitAndSpeedUp(ethers.provider, () => vault.joinPool(
    POOL_ID,
    signer.address,
    signer.address,
    joinReq,
    { ...params, gasLimit: gas.add(1_000_000) },
  ));


}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
