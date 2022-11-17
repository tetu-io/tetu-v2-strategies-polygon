import {IPriceCalculator} from "../typechain";


export class ToolsContractsWrapper {
  public readonly calculator: IPriceCalculator;

  constructor(calculator: IPriceCalculator) {
    this.calculator = calculator;
  }
}
