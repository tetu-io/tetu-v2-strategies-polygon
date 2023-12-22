export class ZkevmAddresses {
  public static TETU_LIQUIDATOR = "0xBcda73B7184D5974F77721db79ff8BA190b342ce";
  public static TETU_CONTROLLER = "0x35B0329118790B8c8FC36262812D92a4923C6795";
  public static TETU_CONVERTER = "";

//region ----------------------------------------------------- Assets
  public static MATIC = "0xa2036f0538221a77A3937F1379699f44945018d0".toLowerCase();
  public static USDC = "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035".toLowerCase();
  public static USDT = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d".toLowerCase();
  public static WETH = "0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9".toLowerCase();
  public static WBTC = "0xEA034fb02eB1808C2cc3adbC15f447B93CbE08e1".toLowerCase();
  public static DAI = "0xC5015b9d9161Dca7e18e32f6f25C4aD850731Fd4".toLowerCase();
//endregion ----------------------------------------------------- Assets

//region ----------------------------------------------------- 0vix
  /** https://docs.0vix.com/developers/contract-addresses/mainnet-1 */
  public static ZEROVIX_COMPTROLLER = "0x6EA32f626e3A5c41547235ebBdf861526e11f482"; // impl: "0x91e9e99AC7C39d5c057F83ef44136dFB1e7adD7d";
  public static ZEROVIX_PRICE_ORACLE = "0x65D53619b2BbBb69f8F895Be08758e796952101f"; // "0xBC81104207C160cFE48585cC8D753aD2c7031FF7";
  public static ZEROVIX_ADMIN = "0x14cc958d41a377d46da4b939c8147bc46426e9af";
//endregion ----------------------------------------------------- 0vix

//region ----------------------------------------------------- PancakeSwap
  public static PANCAKE_SWAP_TOKEN = "0x0d1e753a25ebda689453309112904807625befbe".toLowerCase();
  public static PANCAKE_MASTER_CHEF_V3 = "0xe9c7f3196ab8c09f6616365e8873daeb207c0391".toLowerCase();
  public static PANCAKE_NONFUNGIBLE_POSITION_MANAGER = "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364".toLowerCase();
  /** From https://pancakeswap.finance/farms?chain=polygonZkEVM */
  public static PANCAKE_QUOTER_V2 = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997".toLowerCase();
  // /** From list of transactions: https://basescan.org/address/0x3af75af6F056d4D72c1675dA919aebF908A109D6 (creator of Quoter2) */
  // public static PANCAKE_SMART_ROUTER = "".toLowerCase();
  // /** From list of transactions: https://basescan.org/address/0x3af75af6F056d4D72c1675dA919aebF908A109D6 (creator of Quoter2) */
  // public static PANCAKE_MIXED_ROUTE_QUOTER_V1 = "".toLowerCase();
  // /** From list of transactions: https://basescan.org/address/0x3af75af6f056d4d72c1675da919aebf908a109d6 (creator of Quoter2) */
  // public static PANCAKE_SMART_ROUTER_HELPER = "".toLowerCase();
  // /** From list of transactions: https://basescan.org/address/0x3af75af6f056d4d72c1675da919aebf908a109d6 (creator of Quoter2) */
  // public static PANCAKE_SWAP_ROUTER = "".toLowerCase();

  public static PANCAKE_POOL_USDT_USDC_LP = "0xca06375be938a2d6eF311dfaFab7E326d55D23Cc".toLowerCase();

  public static TETU_PANCAKE3_SWAPPER = "0xa075F8FF74941Fae5bf9Fd48736E4422474A5A66".toLowerCase();

//endregion ----------------------------------------------------- PancakeSwap

  public static AGG_ONEINCH_V5 = "TODO".toLowerCase();

}
