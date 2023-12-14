/* tslint:disable:variable-name */
export class BaseAddresses {
    public static GOV_ADDRESS = "0x3f5075195b96B60d7D26b5cDe93b64A6D9bF33e2".toLowerCase()
    public static TETU_CONVERTER = "0x51002Cad5e6FbE3856311f431E1c41c46Acc5D47".toLowerCase()
    public static TETU_CONVERTER_PRICE_ORACLE = "0x2783E44E629617194F93AB67355028865c9117b4".toLowerCase()

    public static TETU_LIQUIDATOR = "0x22e2625F9d8c28CB4BcE944E9d64efb4388ea991".toLowerCase()
    public static TETU_LIQUIDATOR_UNIV3_SWAPPER = "0x00379dD90b2A337C4652E286e4FBceadef940a21".toLowerCase()
    public static TETU_LIQUIDATOR_DYSTOPIA_SWAPPER = "0x60BF9c1FC8b93B6400608c82107a852C54aD110F".toLowerCase()

    // tokens
    public static WETH_TOKEN = "0x4200000000000000000000000000000000000006".toLowerCase()
    public static USDbC_TOKEN = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA".toLowerCase()
    public static DAI_TOKEN = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb".toLowerCase()
    public static USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase()
    public static WELL_TOKEN = "0xff8adec2221f9f4d8dfbafa6b9a297d17603493d".toLowerCase()

    // UNISWAP V3
    public static UNISWAPV3_QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'.toLowerCase()

    // AERODROME
    public static AERODROME_WETH_WELL_VOLATILE_AMM = "0xffA3F8737C39e36dec4300B162c2153c67c8352f".toLowerCase();

    // stable pools
    public static UNISWAPV3_USDC_USDbC_100 = '0x06959273E9A65433De71F5A452D529544E07dDD0'.toLowerCase()
    public static UNISWAPV3_DAI_USDbC_100 = '0x22F9623817F152148B4E080E98Af66FBE9C5AdF8'.toLowerCase()

//region ----------------------------------------------------- Moonwell: https://docs.moonwell.fi/moonwell/protocol-information/contracts
    public static MOONWELL_COMPTROLLER = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C".toLowerCase();
    public static MOONWELL_DAI = "0x73b06D8d18De422E269645eaCe15400DE7462417".toLowerCase();
    public static MOONWELL_USDC = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22".toLowerCase();
    public static MOONWELL_USDBC = "0x703843C3379b52F9FF486c9f5892218d2a065cC8".toLowerCase();
    public static MOONWELL_WETH = "0x628ff693426583D9a7FB391E54366292F509D457".toLowerCase();
    public static MOONWELL_CBETH = "0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5".toLowerCase();
//endregion ----------------------------------------------------- Moonwell

//region ----------------------------------------------------- PancakeSwap
    public static PANCAKE_SWAP_TOKEN = "0x3055913c90Fcc1A6CE9a358911721eEb942013A1".toLowerCase();
    public static PANCAKE_MASTER_CHEF_V3 = "0xC6A2Db661D5a5690172d8eB0a7DEA2d3008665A3".toLowerCase();
    public static PANCAKE_NONFUNGIBLE_POSITION_MANAGER = "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364".toLowerCase();
    /** From list of transactions: https://basescan.org/address/0x3af75af6f056d4d72c1675da919aebf908a109d6 */
    public static PANCAKE_QUOTER_V2 = "0x864ED564875BdDD6F421e226494a0E7c071C06f8".toLowerCase(); // todo 0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997
    /** From list of transactions: https://basescan.org/address/0x3af75af6f056d4d72c1675da919aebf908a109d6 */
    public static PANCAKE_SMART_ROUTER = "0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86".toLowerCase();
    /** From list of transactions: https://basescan.org/address/0x3af75af6f056d4d72c1675da919aebf908a109d6 */
    public static PANCAKE_MIXED_ROUTE_QUOTER_V1 = "0x4c650FB471fe4e0f476fD3437C3411B1122c4e3B".toLowerCase();
    /** From list of transactions: https://basescan.org/address/0x3af75af6f056d4d72c1675da919aebf908a109d6 */
    public static PANCAKE_SMART_ROUTER_HELPER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4".toLowerCase();
    /** From list of transactions: https://basescan.org/address/0x3af75af6f056d4d72c1675da919aebf908a109d6 */
    public static PANCAKE_SWAP_ROUTER = "0x1b81D678ffb9C0263b24A97847620C99d213eB14".toLowerCase();

    public static PANCAKE_POOL_USDC_USDbC = "0x29Ed55B18Af0Add137952CB3E29FB77B32fCE426".toLowerCase();
    public static PANCAKE_POOL_DAI_USDbC_LP = "0xe4eFf19c7AcE186ba39fD3eD639B2D34171f7efF".toLowerCase();

    public static TETU_PANCAKE_3_SWAPPER = "0x8aAc356B49e75DAbd4384689b00A02DA68cde62B".toLowerCase();

//endregion ----------------------------------------------------- PancakeSwap

}
