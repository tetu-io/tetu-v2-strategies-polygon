import {ethers} from "hardhat";
import {
  ERC20__factory,
  IController__factory,
  IERC20__factory, IERC20Extended__factory,
  IERC721Enumerable__factory,
  ISmartVault__factory,
  IWmatic__factory
} from "../typechain";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../scripts/addresses/MaticAddresses";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {DeployerUtilsLocal} from "../scripts/deploy/DeployerUtilsLocal";
import {Misc} from "../scripts/utils/tools/Misc";
import {parseUnits} from "ethers/lib/utils";

const {expect} = chai;
chai.use(chaiAsPromised);

export class TokenUtils {

  // use the most neutral place, some contracts (like swap pairs) can be used in tests and direct transfer ruin internal logic
  public static TOKEN_HOLDERS = new Map<string, string>([
    [MaticAddresses.WMATIC_TOKEN, '0x8df3aad3a84da6b69a4da8aec3ea40d9091b2ac4'.toLowerCase()], // aave
    [MaticAddresses.WETH_TOKEN, '0x28424507fefb6f7f8e9d3860f56504e4e5f5f390'.toLowerCase()], // aave
    [MaticAddresses.WBTC_TOKEN, '0x5c2ed810328349100a66b82b78a1791b101c9d61'.toLowerCase()], // aave v2
    // [MaticAddresses.WBTC_TOKEN, '0xba12222222228d8ba445958a75a0704d566bf2c8'.toLowerCase()], // bal
    // [MaticAddresses.USDC_TOKEN, '0xBA12222222228d8Ba445958a75a0704d566BF2C8'.toLowerCase()], // bal
    [MaticAddresses.USDC_TOKEN, '0x1a13f4ca1d028320a707d99520abfefca3998b7f'.toLowerCase()], // aave
    [MaticAddresses.USDT_TOKEN, '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe'.toLowerCase()], // adr
    [MaticAddresses.QUICK_TOKEN, '0xdB74C5D4F154BBD0B8e0a28195C68ab2721327e5'.toLowerCase()], // dquick
    [MaticAddresses.FRAX_TOKEN, '0x45c32fa6df82ead1e2ef74d17b76547eddfaff89'.toLowerCase()], // frax
    [MaticAddresses.TETU_TOKEN, '0x7ad5935ea295c4e743e4f2f5b4cda951f41223c2'.toLowerCase()], // fund keeper
    [MaticAddresses.AAVE_TOKEN, '0x1d2a0e5ec8e5bbdca5cb219e649b565d8e5c3360'.toLowerCase()], // aave
    [MaticAddresses.SUSHI_TOKEN, '0x0f0c716b007c289c0011e470cc7f14de4fe9fc80'.toLowerCase()], // peggy
    [MaticAddresses.pBREW_TOKEN, '0x000000000000000000000000000000000000dead'.toLowerCase()], // burned
    [MaticAddresses.DINO_TOKEN, '0x000000000000000000000000000000000000dead'.toLowerCase()], // burned
    [MaticAddresses.ICE_TOKEN, '0xb1bf26c7b43d2485fa07694583d2f17df0dde010'.toLowerCase()], // blueIce
    [MaticAddresses.IRON_TOKEN, '0xCaEb732167aF742032D13A9e76881026f91Cd087'.toLowerCase()], // ironSwap
    // [MaticAddresses.DAI_TOKEN, '0x9b17bAADf0f21F03e35249e0e59723F34994F806'.toLowerCase()], // anyswap
    [MaticAddresses.DAI_TOKEN, '0xBA12222222228d8Ba445958a75a0704d566BF2C8'.toLowerCase()], // balancer
    [MaticAddresses.LINK_TOKEN, '0xBA12222222228d8Ba445958a75a0704d566BF2C8'.toLowerCase()], // balancer
    [MaticAddresses.CRV_TOKEN, '0x98B5F32dd9670191568b661a3e847Ed764943875'.toLowerCase()], // qi
    [MaticAddresses.DINO_TOKEN, '0x000000000000000000000000000000000000dead'.toLowerCase()], //
    [MaticAddresses.FXS_TOKEN, '0x1a3acf6d19267e2d3e7f898f42803e90c9219062'.toLowerCase()], // itself
    [MaticAddresses.AM3CRV_TOKEN, '0xbf3bc2f3d279466686174261bfccd0ac07576e59'.toLowerCase()], // wallet
    [MaticAddresses.USD_BTC_ETH_CRV_TOKEN, '0x25eeb8ab4e2f369c8f0e171d0701c06fa6a709dd'.toLowerCase()], // wallet
    [MaticAddresses.BTCCRV_TOKEN, '0xffbACcE0CC7C19d46132f1258FC16CF6871D153c'.toLowerCase()], // gauge
    [MaticAddresses.IRON_IS3USD, '0x1fD1259Fa8CdC60c6E8C86cfA592CA1b8403DFaD'.toLowerCase()], // chef
    [MaticAddresses.IRON_IRON_IS3USD, '0x1fD1259Fa8CdC60c6E8C86cfA592CA1b8403DFaD'.toLowerCase()], // chef
    [MaticAddresses.BAL_TOKEN, '0xBA12222222228d8Ba445958a75a0704d566BF2C8'.toLowerCase()], // balancer
    [MaticAddresses.miMATIC_TOKEN, '0x25864a712C80d33Ba1ad7c23CffA18b46F2fc00c'.toLowerCase()],
    [MaticAddresses.KLIMA_TOKEN, '0x65A5076C0BA74e5f3e069995dc3DAB9D197d995c'.toLowerCase()], // gnosis
    [MaticAddresses.PSP_TOKEN, '0x2ee05fad3b206a232e985acbda949b215c67f00e'.toLowerCase()], // wallet
    [MaticAddresses.VSQ_TOKEN, '0x2f3e9e54bd4513d1b49a6d915f9a83310638cfc2'.toLowerCase()], // VSQStaking
    [MaticAddresses.NSHARE_TOKEN, '0xfb6935ef307e08cb9e9d4bfdbdc57e671d3b19a6'.toLowerCase()], // nacho treasury Fund
    [MaticAddresses.NACHO_TOKEN, '0xfb6935ef307e08cb9e9d4bfdbdc57e671d3b19a6'.toLowerCase()], // nacho treasury Fund
    [MaticAddresses.QI_TOKEN, '0x3FEACf904b152b1880bDE8BF04aC9Eb636fEE4d8'.toLowerCase()], // qidao gov
    [MaticAddresses.UNT_TOKEN, '0x125ecc7e5771f47eac0cb5ada151d72be828ff34'.toLowerCase()], // gov
    [MaticAddresses.cxDOGE_TOKEN, '0x2d187a560cfbd28e1eb2f68534754b0f120459a9'.toLowerCase()],
    [MaticAddresses.cxADA_TOKEN, '0x41318419cfa25396b47a94896ffa2c77c6434040'.toLowerCase()],
    [MaticAddresses.cxETH_TOKEN, '0x4f6742badb049791cd9a37ea913f2bac38d01279'.toLowerCase()],
    [MaticAddresses.SPHERE_TOKEN, '0x20d61737f972eecb0af5f0a85ab358cd083dd56a'.toLowerCase()],
    [MaticAddresses.BALANCER_BAL_ETH_POOL, '0xBA12222222228d8Ba445958a75a0704d566BF2C8'.toLowerCase()],// balancer vault
    [MaticAddresses.SPHEREV2_TOKEN, '0x7754d8b057CC1d2D857d897461DAC6C3235B4aAe'.toLowerCase()], // sphere owner
    [MaticAddresses.UMA_TOKEN, '0x1b72bac3772050fdcaf468cce7e20deb3cb02d89'.toLowerCase()],
    [MaticAddresses.CLAM2_TOKEN, '0x820f92c1b3ad8e962e6c6d9d7caf2a550aec46fb'.toLowerCase()],
    [MaticAddresses.xTETU, '0x352f9fa490a86f625f53e581f0ec3bd649fd8bc9'.toLowerCase()],
    [MaticAddresses.SPHEREV3_TOKEN, '0x7754d8b057CC1d2D857d897461DAC6C3235B4aAe'.toLowerCase()], // sphere owner
    [MaticAddresses.MESH_TOKEN, '0x176b29289f66236c65c7ac5db2400abb5955df13'.toLowerCase()], // vMESH
    [MaticAddresses.BALANCER_POOL_MATIC_USDC_WETH_BAL, '0x068Ff98072d3eB848D012e3390703BB507729ed6'.toLowerCase()], // gauge
    [MaticAddresses.BALANCER_POOL_tetuBAL_BPT, '0xaa59736b80cf77d1e7d56b7bba5a8050805f5064'.toLowerCase()], // gauge
    [MaticAddresses.DF_TOKEN, '0x80ab3817c0026d31e5ecac7675450f510f016efb'.toLowerCase()], // gov
    [MaticAddresses.DYSTOPIA_TETU_USDPlus, '0x17274fa0e56421f620b993596fc34e77c1706885'.toLowerCase()], // dyst gauge
    [MaticAddresses.USDPlus_TOKEN, '0x421a018cc5839c4c0300afb21c725776dc389b1a'.toLowerCase()], // dyst gauge
    [MaticAddresses.oZEMIT_TOKEN, '0x0fbe132a5eb95f287740a7b0affbfc8d14354548'.toLowerCase()],
    [MaticAddresses.MaticX_TOKEN, '0xba12222222228d8ba445958a75a0704d566bf2c8'.toLowerCase()],
  ]);

  public static async balanceOf(tokenAddress: string, account: string): Promise<BigNumber> {
    return ERC20__factory.connect(tokenAddress, ethers.provider).balanceOf(account);
  }

  public static async totalSupply(tokenAddress: string): Promise<BigNumber> {
    return ERC20__factory.connect(tokenAddress, ethers.provider).totalSupply();
  }

  public static async approve(tokenAddress: string, signer: SignerWithAddress, spender: string, amount: string) {
    console.log('approve', await TokenUtils.tokenSymbol(tokenAddress), amount);
    return ERC20__factory.connect(tokenAddress, signer).approve(spender, BigNumber.from(amount));
  }

  public static async approveNFT(tokenAddress: string, signer: SignerWithAddress, spender: string, id: string) {
    console.log('approve', await TokenUtils.tokenSymbol(tokenAddress), id);
    await TokenUtils.checkNftBalance(tokenAddress, signer.address, id);
    return ERC20__factory.connect(tokenAddress, signer).approve(spender, id);
  }

  public static async allowance(tokenAddress: string, signer: SignerWithAddress, spender: string): Promise<BigNumber> {
    return ERC20__factory.connect(tokenAddress, signer).allowance(signer.address, spender);
  }

  public static async transfer(tokenAddress: string, signer: SignerWithAddress, destination: string, amount: string) {
    console.log('transfer', await TokenUtils.tokenSymbol(tokenAddress), amount);
    return ERC20__factory.connect(tokenAddress, signer).transfer(destination, BigNumber.from(amount))
  }

  public static async wrapNetworkToken(signer: SignerWithAddress, amount: string) {
    const token = IWmatic__factory.connect(await DeployerUtilsLocal.getNetworkTokenAddress(), signer);
    return token.deposit({value: parseUnits(amount), from: signer.address});
  }

  public static async decimals(tokenAddress: string): Promise<number> {
    return ERC20__factory.connect(tokenAddress, ethers.provider).decimals();
  }

  public static async tokenName(tokenAddress: string): Promise<string> {
    return ERC20__factory.connect(tokenAddress, ethers.provider).name();
  }

  public static async tokenSymbol(tokenAddress: string): Promise<string> {
    return ERC20__factory.connect(tokenAddress, ethers.provider).symbol();
  }

  public static async checkBalance(tokenAddress: string, account: string, amount: string) {
    const bal = await TokenUtils.balanceOf(tokenAddress, account);
    expect(bal.gt(BigNumber.from(amount))).is.eq(true, 'Balance less than amount');
    return bal;
  }

  public static async tokenOfOwnerByIndex(tokenAddress: string, account: string, index: number) {
    return IERC721Enumerable__factory.connect(tokenAddress, ethers.provider).tokenOfOwnerByIndex(account, index);
  }

  public static async checkNftBalance(tokenAddress: string, account: string, id: string) {
    const nftCount = (await TokenUtils.balanceOf(tokenAddress, account)).toNumber();
    let found = false;
    let tokenId;
    for (let i = 0; i < nftCount; i++) {
      tokenId = await TokenUtils.tokenOfOwnerByIndex(tokenAddress, account, i);
      console.log('NFT', tokenId)
      if (tokenId.toString() === id) {
        found = true;
        break;
      }
    }
    expect(found).is.eq(true);
    return tokenId;
  }

  public static async getToken(token: string, to: string, amount?: BigNumber) {
    const start = Date.now();
    console.log('transfer token from biggest holder', token, amount?.toString());

    if (token.toLowerCase() === await DeployerUtilsLocal.getNetworkTokenAddress()) {
      await IWmatic__factory.connect(token, await DeployerUtilsLocal.impersonate(to)).deposit({value: amount});
      return amount;
    }
    const owner = await DeployerUtilsLocal.impersonate(to);
    if ((await IController__factory.connect(MaticAddresses.CONTROLLER_ADDRESS, owner).isValidVault(token))) {
      const vault = ISmartVault__factory.connect(token, owner);
      const underlying = await vault.underlying();
      const ppfs = await vault.getPricePerFullShare();
      const dec = await IERC20Extended__factory.connect(token, owner).decimals();
      const a = amount?.mul(ppfs).div(parseUnits('1', dec)).mul(2) || BigNumber.from(Misc.MAX_UINT);
      await TokenUtils.getToken(underlying, to, a);
      await IERC20__factory.connect(underlying, owner).approve(token, Misc.MAX_UINT);
      await vault.deposit(a);
      return a;
    }

    const holder = TokenUtils.TOKEN_HOLDERS.get(token.toLowerCase()) as string;
    if (!holder) {
      throw new Error('Please add holder for ' + token);
    }
    const signer = await DeployerUtilsLocal.impersonate(holder);
    const balance = (await TokenUtils.balanceOf(token, holder)).div(100);
    console.log('holder balance', balance.toString());
    if (amount) {
      await TokenUtils.transfer(token, signer, to, amount.toString());
    } else {
      await TokenUtils.transfer(token, signer, to, balance.toString());
    }
    Misc.printDuration('getToken completed', start);
    return balance;
  }

}
