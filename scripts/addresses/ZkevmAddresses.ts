export class ZkevmAddresses {
  public static GOV_ADDRESS = "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94".toLowerCase();
  public static TETU_LIQUIDATOR = "0xBcda73B7184D5974F77721db79ff8BA190b342ce".toLowerCase();
  public static TETU_CONTROLLER = "0x35B0329118790B8c8FC36262812D92a4923C6795".toLowerCase();
  public static TETU_CONVERTER = "0x60E684643d546b657bfeE9c01Cb40E62EC1fe1e2".toLowerCase();
  public static TETU_CONVERTER_PRICE_ORACLE = "0xE1394fFE5e84f54DFd530C9Ea046d0A596b4ea14".toLowerCase();
  public static TETU_LIQUIDATOR_PANCAKE_V3_SWAPPER = "0xa075F8FF74941Fae5bf9Fd48736E4422474A5A66".toLowerCase();
  public static TETU_LIQUIDATOR_ALGEBRA_SWAPPER = "0x4C1EEeF74862ed6524B416809636821FBFff208C".toLowerCase();

//region ----------------------------------------------------- Assets
  public static TETU_TOKEN = "0x7C1B24c139a3EdA18Ab77C8Fa04A0F816C23e6D4".toLowerCase();
  public static MATIC_TOKEN = "0xa2036f0538221a77A3937F1379699f44945018d0".toLowerCase();
  public static USDC_TOKEN = "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035".toLowerCase();
  public static USDT_TOKEN = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d".toLowerCase();
  public static WETH_TOKEN = "0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9".toLowerCase();
  public static WBTC_TOKEN = "0xEA034fb02eB1808C2cc3adbC15f447B93CbE08e1".toLowerCase();
  public static DAI_TOKEN = "0xC5015b9d9161Dca7e18e32f6f25C4aD850731Fd4".toLowerCase();
//endregion ----------------------------------------------------- Assets

//region ----------------------------------------------------- Pools
  public static ALGEBRA_POOL_WETH_USDC = "0xc44AD482f24fd750cAeBa387d2726d8653F8c4bB".toLowerCase();
  public static ALGEBRA_POOL_USDT_USDC = "0x9591b8A30c3a52256ea93E98dA49EE43Afa136A8".toLowerCase();
  public static ALGEBRA_POOL_USDT_WETH = "0x4412c7152c658967a3360F0A1472E701bDBeca9E".toLowerCase();

  public static PANCAKE_POOL_USDT_USDC_LP = "0xca06375be938a2d6eF311dfaFab7E326d55D23Cc".toLowerCase();
  public static PANCAKE_POOL_CAKE_WETH_10000 = "0x3Fa1c450f3842C1252e4cB443e3F435b41D6f472".toLowerCase();
  public static PANCAKE_POOL_CAKE_WETH_2500 = "0x58684788c718D0CfeC837ff65ADDA6C8721FE1e9".toLowerCase();
  public static PANCAKE_POOL_USDC_ETH_LP_500 = "0xD43b9dCbB61e6ccFbCFef9f21e1BB5064F1CB33f".toLowerCase();
  public static PANCAKE_POOL_TETU_USDC_100 = "0x7bB24BDF5f16c71FA67b0734416D6730C5a694bf".toLowerCase();

//endregion ----------------------------------------------------- Pools


//region ----------------------------------------------------- 0vix
  /** https://docs.0vix.com/developers/contract-addresses/mainnet-1 */
  public static ZEROVIX_COMPTROLLER = "0x6EA32f626e3A5c41547235ebBdf861526e11f482".toLowerCase(); // impl: "0x91e9e99AC7C39d5c057F83ef44136dFB1e7adD7d";
  public static ZEROVIX_PRICE_ORACLE = "0x65D53619b2BbBb69f8F895Be08758e796952101f".toLowerCase(); // "0xBC81104207C160cFE48585cC8D753aD2c7031FF7";
  public static ZEROVIX_ADMIN = "0x14cc958d41a377d46da4b939c8147bc46426e9af".toLowerCase();
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

//endregion ----------------------------------------------------- PancakeSwap

//region ----------------------------------------------------- Aggregators
  /** https://docs.openocean.finance/dev/contracts-of-chains */
  public static AGG_OPENOCEAN_ROUTER = "0x6dd434082EAB5Cd134B33719ec1FF05fE985B97b".toLowerCase();
//endregion ----------------------------------------------------- Aggregators

//region ----------------------------------------------------- Keom
  public static KEOM_COMPTROLLER = "0x6ea32f626e3a5c41547235ebbdf861526e11f482".toLowerCase();
  public static KEOM_PRICE_ORACLE = "0x19194261d8f0599bd079c52623c80c5150f010cf".toLowerCase();

  public static KEOM_NATIVE = "0xee1727f5074E747716637e1776B7F7C7133f16b1".toLowerCase();
  public static KEOM_MATIC = "0x8903Dc1f4736D2FcB90C1497AebBABA133DaAC76".toLowerCase();
  public static KEOM_USDC = "0x68d9baA40394dA2e2c1ca05d30BF33F52823ee7B".toLowerCase();
  public static KEOM_USDT = "0xad41C77d99E282267C1492cdEFe528D7d5044253".toLowerCase();
  public static KEOM_WBTC = "0x503deabad9641c5B4015041eEb0F1263E415715D".toLowerCase();
  public static KEOM_WETH = "0xbC59506A5Ce024B892776d4F7dd450B0FB3584A2".toLowerCase();
//endregion ----------------------------------------------------- Keom

}
