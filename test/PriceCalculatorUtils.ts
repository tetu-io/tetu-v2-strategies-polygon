import {BigNumber, utils} from "ethers";
import {TokenUtils} from "./TokenUtils";
import {expect} from "chai";
import {ethers} from "hardhat";
import {Logger} from "tslog";
import logSettings from "../log_settings";
import {DeployerUtilsLocal} from "../scripts/deploy/DeployerUtilsLocal";
import {IPriceCalculator, IPriceCalculator__factory} from "../typechain";
import {parseUnits} from "ethers/lib/utils";

const log: Logger = new Logger(logSettings);

export class PriceCalculatorUtils {

  public static async getFormattedPrice(
    calculator: IPriceCalculator,
    token: string,
    outputToken: string
  ): Promise<number> {
    const price = +utils.formatUnits(await calculator.getPrice(token, outputToken));
    const name = await TokenUtils.tokenName(token);
    const outputName = await TokenUtils.tokenName(outputToken);
    console.log('price', name, 'against', outputName, price);
    expect(price).is.not.eq(0, name + " doesn't calculated");
    return price;
  }

  // keep this method for possible implement caches
  public static async getPriceCached(token: string, calculator: IPriceCalculator | null = null): Promise<BigNumber> {
    console.log('get price for', token);
    // todo remove
    if (token.toLowerCase() === '0xdcb8f34a3ceb48782c9f3f98df6c12119c8d168a'.toLowerCase()) {
      return parseUnits('1');
    }
    // todo remove
    if (token.toLowerCase() === '0xcf40352253de7a0155d700a937Dc797D681c9867'.toLowerCase()) {
      return parseUnits('1');
    }
    const net = await ethers.provider.getNetwork();
    let network = ''
    if (net.chainId === 137) {
      network = 'MATIC';
    } else if (net.chainId === 250) {
      network = 'FANTOM';
    } else if (net.chainId === 1) {
      network = '';
    } else {
      throw Error('Wrong network ' + net.chainId);
    }
    // if (network !== '') {
    //   const response = await axios.get(`https://api.tetu.io/api/v1/price/longTTL/?token=${token}&network=${network}`);
    //   log.info('price for', token, response?.data?.result);
    //   if (response?.data?.result) {
    //     return BigNumber.from(response?.data?.result);
    //   }
    // }
    if (calculator == null) {
      const tools = await DeployerUtilsLocal.getToolsAddresses();
      calculator = IPriceCalculator__factory.connect(tools.calculator, ethers.provider);
    }
    if (net.chainId === 137 || net.chainId === 250 || net.chainId === 1) {
      return calculator.getPriceWithDefaultOutput(token);
    } else {
      throw Error('No config for ' + net.chainId);
    }
  }

}
