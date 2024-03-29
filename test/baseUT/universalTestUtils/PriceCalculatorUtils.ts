import { BigNumber, utils } from 'ethers';
import { TokenUtils } from '../../../scripts/utils/TokenUtils';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Logger } from 'tslog';
import logSettings from '../../../log_settings';
import { IController__factory, ITetuLiquidator, ITetuLiquidator__factory } from '../../../typechain';
import { parseUnits } from 'ethers/lib/utils';
import { Addresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/addresses';
import { PolygonAddresses } from '@tetu_io/tetu-contracts-v2/dist/scripts/addresses/polygon';
import { DeployerUtilsLocal } from '../../../scripts/utils/DeployerUtilsLocal';
import { Misc } from '../../../scripts/utils/Misc';
import {BASE_NETWORK_ID, ZKEVM_NETWORK_ID} from "../utils/HardhatUtils";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";

const log: Logger<undefined> = new Logger(logSettings);

export class PriceCalculatorUtils {

  public static async getFormattedPrice(
    calculator: ITetuLiquidator,
    token: string,
    outputToken: string,
  ): Promise<number> {
    const decimals = await TokenUtils.decimals(token);
    const one = parseUnits('1', decimals.toString());
    const price = +utils.formatUnits(await calculator.getPrice(token, outputToken, one));
    const name = await TokenUtils.tokenName(token);
    const outputName = await TokenUtils.tokenName(outputToken);
    console.log('price', name, 'against', outputName, price);
    expect(price).is.not.eq(0, name + ' doesn\'t calculated');
    return price;
  }

  // keep this method for possible implement caches
  public static async getPriceCached(token: string, liquidator: ITetuLiquidator | null = null): Promise<BigNumber> {
    console.log('getPriceCached token', token);

    const chainId = Misc.getChainId();
    /*let network = '';
    if (chainId === 137) {
      network = 'MATIC';
    } else {
      throw Error('Wrong network ' + chainId);
    }*/
    // if (network !== '') {
    //   const response = await axios.get(`https://api.tetu.io/api/v1/price/longTTL/?token=${token}&network=${network}`);
    //   log.info('price for', token, response?.data?.result);
    //   if (response?.data?.result) {
    //     return BigNumber.from(response?.data?.result);
    //   }
    // }
    if (liquidator == null) {
      const controller = IController__factory.connect(Addresses.getCore().controller, (await ethers.getSigners())[0]);
      const liquidatorAddress = await controller.liquidator();
      liquidator = ITetuLiquidator__factory.connect(liquidatorAddress, ethers.provider);
    }
    if (chainId === 137) {
      const defaultToken = PolygonAddresses.USDC_TOKEN;
      // const decimals = await TokenUtils.decimals(token);
      const one = parseUnits('1'/*, decimals.toString()*/);
      if (token.toLowerCase() === defaultToken.toLowerCase()) {
        return one;
      }

      return liquidator.getPrice(token, defaultToken, one);
    } else if (chainId === BASE_NETWORK_ID) {
      const defaultToken = BaseAddresses.USDbC_TOKEN;
      const one = parseUnits('1');
      if (token.toLowerCase() === defaultToken.toLowerCase()) {
        return one;
      }

      return liquidator.getPrice(token, defaultToken, one);
    } else if (chainId === ZKEVM_NETWORK_ID) {
      const defaultToken = ZkevmAddresses.USDC_TOKEN;
      const one = parseUnits('1');
      if (token.toLowerCase() === defaultToken.toLowerCase()) {
        return one;
      }

      return liquidator.getPrice(token, defaultToken, one);
    } else {
      throw Error('No config for ' + chainId);
    }
  }

  public static async getPriceWithDefaultOutput(token: string, liquidator: ITetuLiquidator): Promise<BigNumber> {
    console.log('getPriceWithDefaultOutput token', token, liquidator?.address);
    // if (!liquidator) liquidator = await DeployerUtilsLocal.getControllerLiquidator();
    if (!liquidator) {
      liquidator = await DeployerUtilsLocal.getLiquidator();
    }
    console.log('liquidator address', liquidator.address);

    const decimals = await TokenUtils.decimals(token);
    const one = parseUnits('1', decimals.toString());
    const defaultToken = PolygonAddresses.USDC_TOKEN;
    if (token.toLowerCase() === defaultToken.toLowerCase()) {
      return one;
    }
    return liquidator.getPrice(token, defaultToken, one);
  }


}
