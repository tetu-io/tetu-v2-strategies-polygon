import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {
  IBalancerBoostedAavePool__factory,
  IBalancerBoostedAaveStablePool__factory,
  IBVault__factory, IERC20__factory,
  IERC20Extended__factory
} from "../../../../typechain";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";

describe("study", () => {
  let signer: SignerWithAddress;

  before(async function () {
    [signer] = await ethers.getSigners();
  });

  it("Check balances in USD", async () => {
    const balancerVault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

    // Balancer Boosted Aave USD pool ID
    const poolBoostedId = "0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b";

    const vault = IBVault__factory.connect(balancerVault, signer);
    const poolBoosted = IBalancerBoostedAaveStablePool__factory.connect((await vault.getPool(poolBoostedId))[0], signer);
    const rate = await poolBoosted.getRate();

    const actualSupply = await poolBoosted.getActualSupply();
    const poolBoostedTotalSupply = await poolBoosted.totalSupply();
    console.log("poolBoostedTotalSupply", poolBoostedTotalSupply);

    const allPoolToken = await vault.getPoolTokens(poolBoostedId); // it includes bb-am-usd, we don't need it
    console.log("PoolTokens", allPoolToken.tokens, allPoolToken.balances);

    const tokens = [
      '0x178E029173417b1F9C8bC16DCeC6f697bC323746',
      // '0x48e6B98ef6329f8f0A30eBB8c7C960330d648085', // bb-am-usd
      '0xF93579002DBE8046c43FEfE86ec78b1112247BB8',
      '0xFf4ce5AAAb5a627bf82f4A571AB1cE94Aa365eA6'
    ];
    const cashes = await Promise.all(
      tokens.map(
        async x => (await vault.getPoolTokenInfo(poolBoostedId, x)).cash
      )
    );
    const managed = await Promise.all(
      tokens.map(
        async x => (await vault.getPoolTokenInfo(poolBoostedId, x)).managed
      )
    );

    const tokenNames = await Promise.all(
      tokens.map(
        async x => IERC20Extended__factory.connect(x, signer).symbol()
      )
    );
    const tokenRates = await Promise.all(
      tokens.map(
        async x => poolBoosted.getTokenRate(x)
      )
    );
    for (let i = 0; i < tokens.length; ++i) {
      console.log("Token.Balance", tokenNames[i], cashes[i]);
      console.log("Token.Rate", tokenNames[i], tokenRates[i]);
    }
    console.log("Cash", cashes);
    console.log("Managed", managed);

    const actualSupplyUSD = actualSupply.mul(rate);
    const sumAmounts = [...Array(tokens.length).keys()].reduce(
      (prev, cur) => prev.add(cashes[cur].mul(tokenRates[cur])), BigNumber.from(0)
    );
    console.log("Pool.getRate", rate);
    console.log("Pool.actualSupply", actualSupply);

    console.log("actualSupplyUSD", actualSupplyUSD);
    console.log("sumAmounts", sumAmounts);

    const amounts: BigNumber[] = [];
    for (let i = 0; i < tokens.length; ++i) {
      const balanceTokenInPool = await IERC20__factory.connect(tokens[i], signer).balanceOf(poolBoosted.address);
      const pool = IBalancerBoostedAavePool__factory.connect(tokens[i], signer);
      const poolTotalSupply = await pool.totalSupply();
      const poolId = await pool.getPoolId();
      const poolVirtualSupply = await pool.getVirtualSupply();
      const balanceBPT = await pool.balanceOf(poolBoosted.address);

      const mainToken = await pool.getMainToken();
      const mainTokenName = await IERC20Extended__factory.connect(mainToken, signer).symbol();
      const wrappedToken = await pool.getWrappedToken();
      const wrappedTokenName = await IERC20Extended__factory.connect(wrappedToken, signer).symbol();

      const mainTokenRate = await pool.getRate();
      const wrappedTokenRate = await pool.getWrappedTokenRate();
      const mainTokenInfo = await vault.getPoolTokenInfo(poolId, mainToken);
      const wrappedTokenInfo = await vault.getPoolTokenInfo(poolId, wrappedToken);

      const tokensForPool = await vault.getPoolTokens(poolId);
      const mainTokenDecimals = await IERC20Extended__factory.connect(mainToken, signer).decimals();
      const wrappedTokenDecimals = await IERC20Extended__factory.connect(wrappedToken, signer).decimals();

      console.log("Boosted pool token", tokenNames[i]);
      console.log("BalanceBPT", balanceBPT);
      console.log("balanceTokenInPool", balanceTokenInPool);
      console.log("Total supply", poolTotalSupply);
      console.log("Virtual supply", poolVirtualSupply);
      console.log("mainToken", mainTokenName, mainToken);
      console.log("wrappedToken", wrappedTokenName, wrappedToken);
      console.log("mainToken.cash", mainTokenInfo.cash);
      console.log("mainToken.managed", mainTokenInfo.managed);
      console.log("mainTokenRate", mainTokenRate);
      console.log("wrappedToken.cash", wrappedTokenInfo.cash);
      console.log("wrappedToken.managed", wrappedTokenInfo.managed);
      console.log("wrappedTokenRate", wrappedTokenRate);
      console.log("tokensForPool", tokensForPool);
      console.log("mainTokenDecimals", mainTokenDecimals);
      console.log("wrappedTokenDecimals", wrappedTokenDecimals);

      amounts.push(
        mainTokenInfo.cash.mul(mainTokenRate).add(wrappedTokenInfo.cash.mul(wrappedTokenRate))
          .div(parseUnits("1"))
          .div(parseUnits("1", await IERC20Extended__factory.connect(mainToken, signer).decimals()))
      )
    }

    const sumAmounts2 = amounts.reduce(
      (prev, cur) => prev.add(cur), BigNumber.from(0)
    );
    console.log("amounts", amounts);
    console.log("sumAmounts2", sumAmounts2);
  });
});