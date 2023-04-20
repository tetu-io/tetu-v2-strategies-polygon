import { DeployInfo } from '../../baseUT/utils/DeployInfo';

export abstract class SpecificStrategyTest {

  abstract do(deployInfo: DeployInfo): Promise<void>;

}
