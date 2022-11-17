import {
  IAnnouncer,
  IBookkeeper,
  IController,
  IFeeRewardForwarder,
  IFundKeeper,
  IMintHelper,
  IRewardToken,
  ISmartVault,
  IStrategy,
  IVaultController,
} from "../typechain";

export class CoreContractsWrapper {
  public controller: IController;
  public controllerLogic: string;
  public feeRewardForwarder: IFeeRewardForwarder;
  public feeRewardForwarderLogic: string;
  public bookkeeper: IBookkeeper;
  public bookkeeperLogic: string;
  public mintHelper: IMintHelper;
  public mintHelperLogic: string;
  public rewardToken: IRewardToken;
  public psVault: ISmartVault;
  public psVaultLogic: string;
  public psEmptyStrategy: IStrategy;
  public fundKeeper: IFundKeeper;
  public fundKeeperLogic: string;
  public announcer: IAnnouncer;
  public announcerLogic: string;
  public vaultController: IVaultController;
  public vaultControllerLogic: string;


  constructor(controller: IController, controllerLogic: string, feeRewardForwarder: IFeeRewardForwarder, feeRewardForwarderLogic: string, bookkeeper: IBookkeeper, bookkeeperLogic: string, mintHelper: IMintHelper, mintHelperLogic: string, rewardToken: IRewardToken, psVault: ISmartVault, psVaultLogic: string, psEmptyStrategy: IStrategy, fundKeeper: IFundKeeper, fundKeeperLogic: string, announcer: IAnnouncer, announcerLogic: string, vaultController: IVaultController, vaultControllerLogic: string) {
    this.controller = controller;
    this.controllerLogic = controllerLogic;
    this.feeRewardForwarder = feeRewardForwarder;
    this.feeRewardForwarderLogic = feeRewardForwarderLogic;
    this.bookkeeper = bookkeeper;
    this.bookkeeperLogic = bookkeeperLogic;
    this.mintHelper = mintHelper;
    this.mintHelperLogic = mintHelperLogic;
    this.rewardToken = rewardToken;
    this.psVault = psVault;
    this.psVaultLogic = psVaultLogic;
    this.psEmptyStrategy = psEmptyStrategy;
    this.fundKeeper = fundKeeper;
    this.fundKeeperLogic = fundKeeperLogic;
    this.announcer = announcer;
    this.announcerLogic = announcerLogic;
    this.vaultController = vaultController;
    this.vaultControllerLogic = vaultControllerLogic;
  }

}
