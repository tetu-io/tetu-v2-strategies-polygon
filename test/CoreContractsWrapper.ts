import {
  IBribe,
  IController, IERC20,
  IForwarder,
  IGauge,
  IPlatformVoter,
  IVeDistributor, IVeTetu, IVoter, VaultFactory,
} from "../typechain";

export interface ICoreContractsWrapper {
  tetu: IERC20;
  controller: IController;
  ve: IVeTetu;
  veDist: IVeDistributor;
  gauge: IGauge;
  bribe: IBribe;
  tetuVoter: IVoter;
  platformVoter: IPlatformVoter;
  forwarder: IForwarder;
  vaultFactory: VaultFactory;
}
