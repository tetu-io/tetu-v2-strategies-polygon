import {
  Controller, ControllerV2,
  IBribe,
  IController,
  IERC20,
  IForwarder,
  IGauge,
  IPlatformVoter,
  IVeDistributor,
  IVeTetu,
  IVoter,
  VaultFactory,
} from '../../../typechain';

export interface ICoreContractsWrapper {
  tetu: IERC20;
  controller: ControllerV2;
  ve: IVeTetu;
  veDist: IVeDistributor;
  gauge: IGauge;
  bribe: IBribe;
  tetuVoter: IVoter;
  platformVoter: IPlatformVoter;
  forwarder: IForwarder;
  vaultFactory: VaultFactory;
}
