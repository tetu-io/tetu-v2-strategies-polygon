import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {
  IBalancerBoostedAavePool__factory,
  IBalancerBoostedAaveStablePool__factory,
  IBVault__factory, IERC20__factory,
  IERC20Extended__factory
} from "../../../../typechain";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {MaticHolders} from "../../../../scripts/MaticHolders";
import {MaticAddresses} from "../../../../scripts/MaticAddresses";
import {Misc} from "../../../../scripts/utils/Misc";

describe("BalancerComposableStablePoolTest (study)", () => {
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

    const scalingFactors = await poolBoosted.getScalingFactors();
    console.log("scalingFactors", scalingFactors);

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
    const tokenRatePoolBpt = await poolBoosted.getTokenRate("0x48e6B98ef6329f8f0A30eBB8c7C960330d648085");
    for (let i = 0; i < tokens.length; ++i) {
      console.log("Token.Balance", tokenNames[i], cashes[i]);
      console.log("Token.Rate", tokenNames[i], tokenRates[i]);
    }
    console.log("Cash", cashes);
    console.log("Managed", managed);
    console.log("tokenRatePoolBpt", tokenRatePoolBpt);

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

      const embeddedPoolScalingFactors = await pool.getScalingFactors();

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
      console.log("embeddedPoolScalingFactors", embeddedPoolScalingFactors);


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

  it("Try to enter to the pool", async () => {
    const balancerVault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
    const balancerHelper = "0x239e55F427D44C3cc793f49bFB507ebe76638a2b";

    // Balancer Boosted Aave USD pool ID
    const poolBoostedId = "0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b";

    const vault = IBVault__factory.connect(balancerVault, signer);
    const poolBoosted = IBalancerBoostedAaveStablePool__factory.connect((await vault.getPool(poolBoostedId))[0], signer);

    const amDAI = "0xEE029120c72b0607344f35B17cdD90025e647B00";
    const amUSDC = "0x221836a597948Dce8F3568E044fF123108aCc42A";
    const amUSDT = "0x19C60a251e525fa88Cd6f3768416a8024e98fC19";

    const bbAmDAI = "0x178E029173417b1F9C8bC16DCeC6f697bC323746";
    const bbAmUSDC = "0xF93579002DBE8046c43FEfE86ec78b1112247BB8";
    const bbAmUSDT = "0xFf4ce5AAAb5a627bf82f4A571AB1cE94Aa365eA6";
    const bbAmUSD = "0x48e6B98ef6329f8f0A30eBB8c7C960330d648085";

    const holderDAI = MaticHolders.HOLDER_DAI;
    const holderUSDC = MaticHolders.HOLDER_USDC;
    const holderUSDT = MaticHolders.HOLDER_USDT;

    const amountDAI = parseUnits("100", 18);
    const amountUSDC = parseUnits("100", 6);
    const amountUSDT = parseUnits("100", 6);

    const pi = await vault.getPoolTokens(poolBoostedId);
    console.log("getPoolTokens", pi);
    const MAX_INT = BigNumber.from(2).pow(255);

    // we need to calculate correct ratio for DAI:USDC:USDT using reserves
    const totalBalances = pi.balances[0].add(pi.balances[2]).add(pi.balances[3]);
    console.log("totalBalances", totalBalances);
    const amountToInvestDAI = parseUnits("10", 18);
    const amountToInvestUSDC = amountToInvestDAI
      .mul(pi.balances[2])
      .div(pi.balances[0])
      .mul(parseUnits("1", 6))
      .div(parseUnits("1", 18))
    ;
    const amountToInvestUSDT = amountToInvestDAI
      .mul(pi.balances[3])
      .div(pi.balances[0])
      .mul(parseUnits("1", 6))
      .div(parseUnits("1", 18))
    ;
    console.log("amountToInvestDAI", amountToInvestDAI);
    console.log("amountToInvestUSDC", amountToInvestUSDC);
    console.log("amountToInvestUSDT", amountToInvestUSDT);

    await IERC20__factory.connect(
      MaticAddresses.DAI_TOKEN,
      await Misc.impersonate(holderDAI)
    ).transfer(signer.address, amountDAI);
    await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, signer).approve(vault.address, MAX_INT);

    await IERC20__factory.connect(
      MaticAddresses.USDC_TOKEN,
      await Misc.impersonate(holderUSDC)
    ).transfer(signer.address, amountUSDC);
    await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, signer).approve(vault.address, MAX_INT);

    await IERC20__factory.connect(
      MaticAddresses.USDT_TOKEN,
      await Misc.impersonate(holderUSDT)
    ).transfer(signer.address, amountUSDT);
    await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).approve(vault.address, MAX_INT);

    {
      // dai
      const poolAmDai = IBalancerBoostedAavePool__factory.connect(pi.tokens[0], signer);
      console.log("start swap");
      await vault.swap(
        {
          poolId: await poolAmDai.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: MaticAddresses.DAI_TOKEN,
          assetOut: bbAmDAI,
          userData: '0x',
          amount: amountToInvestDAI
        },
        {
          sender: signer.address,
          fromInternalBalance: false,
          toInternalBalance: false,
          recipient: signer.address
        },
        1,
        Date.now() + 1000
      );
      console.log("end swap");

      const balanceDAI = await IERC20__factory.connect(MaticAddresses.DAI_TOKEN, signer).balanceOf(signer.address);
      const balanceBbAmDAI = await IERC20__factory.connect(bbAmDAI, signer).balanceOf(signer.address);
      console.log("balanceDAI", balanceDAI);
      console.log("balanceBbAmDAI", balanceBbAmDAI);

      const piDAI = await vault.getPoolTokens(await poolAmDai.getPoolId());
      console.log("piDAI", piDAI);
    }

    {
      // usdc
      const poolAmUsdc = IBalancerBoostedAavePool__factory.connect(pi.tokens[2], signer);
      console.log("start swap USDC");
      await vault.swap(
        {
          poolId: await poolAmUsdc.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: MaticAddresses.USDC_TOKEN,
          assetOut: bbAmUSDC,
          userData: '0x',
          amount: amountToInvestUSDC
        },
        {
          sender: signer.address,
          fromInternalBalance: false,
          toInternalBalance: false,
          recipient: signer.address
        },
        1,
        Date.now() + 1000
      );
      console.log("end swap USDC");

      const balanceUSDC = await IERC20__factory.connect(MaticAddresses.USDC_TOKEN, signer).balanceOf(signer.address);
      const balanceBbAmUSDC = await IERC20__factory.connect(bbAmUSDC, signer).balanceOf(signer.address);
      console.log("balanceUSDC", balanceUSDC);
      console.log("balanceAmUSDC", balanceBbAmUSDC);

      const piUSDC = await vault.getPoolTokens(await poolAmUsdc.getPoolId());
      console.log("piUSDC", piUSDC);
    }

    {
      // usdt
      const poolAmUsdc = IBalancerBoostedAavePool__factory.connect(pi.tokens[3], signer);
      console.log("start swap USDT");
      await vault.swap(
        {
          poolId: await poolAmUsdc.getPoolId(),
          kind: 0, // GIVEN_IN
          assetIn: MaticAddresses.USDT_TOKEN,
          assetOut: bbAmUSDT,
          userData: '0x',
          amount: amountToInvestUSDT
        },
        {
          sender: signer.address,
          fromInternalBalance: false,
          toInternalBalance: false,
          recipient: signer.address
        },
        1,
        Date.now() + 1000
      );
      console.log("end swap USDT");

      const balanceUSDT = await IERC20__factory.connect(MaticAddresses.USDT_TOKEN, signer).balanceOf(signer.address);
      const balanceBbAmUSDT = await IERC20__factory.connect(bbAmUSDT, signer).balanceOf(signer.address);
      console.log("balanceUSDT", balanceUSDT);
      console.log("balanceBbAmUSDT", balanceBbAmUSDT);

      const piUSDT = await vault.getPoolTokens(await poolAmUsdc.getPoolId());
      console.log("piUSDT", piUSDT);
    }


    const retDecode = defaultAbiCoder.decode(
      ["uint256", "uint256[]", "uint256"],
      "0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000001491c5f8ba4519a60000000000000000000000000000000000000000000000000000000000000003ba10000000000000000000000000000000000000000000000000000000000001ba10000000000000000000000000000000000000000000000000000000000003ba10000000000000000000000000000000000000000000000000000000000005",
      false
    );
    // 1
    // 84158459389524002386711626555386694745894712975979482213248346579970065170433
    // 84158459389524002386711626555386694745894712975979482213248346579970065170435
    // 84158459389524002386711626555386694745894712975979482213248346579970065170437
    // 1482183424449255846
    console.log("retDecode", retDecode);

    {
      const bbAmDaiBalance = await IERC20__factory.connect(bbAmDAI, signer).balanceOf(signer.address);
      const bbAmUsdcBalance = await IERC20__factory.connect(bbAmUSDC, signer).balanceOf(signer.address);
      const bbAmUsdtBalance = await IERC20__factory.connect(bbAmUSDT, signer).balanceOf(signer.address);

      await IERC20__factory.connect(bbAmDAI, signer).approve(vault.address, MAX_INT);
      await IERC20__factory.connect(bbAmUSDC, signer).approve(vault.address, MAX_INT);
      await IERC20__factory.connect(bbAmUSDT, signer).approve(vault.address, MAX_INT);

      const joinKind = 1; // EXACT_TOKENS_IN_FOR_BPT_OUT
      const initBalances = [bbAmDaiBalance, bbAmUsdcBalance, bbAmUsdtBalance];
      const abi = ['uint256', 'uint256[]', 'uint256'];
      const data = [
        joinKind,
        initBalances,
        parseUnits("0")
      ]; // [EXACT_TOKENS_IN_FOR_BPT_OUT, amountsIn, minimumBPT]
      const userDataInEncoded = defaultAbiCoder.encode(abi, data);

      await vault.joinPool(
        poolBoostedId,
        signer.address,
        signer.address,
        {
          assets: pi.tokens,
          maxAmountsIn: [
            bbAmDaiBalance.mul(1),
            parseUnits("0"),
            bbAmUsdcBalance.mul(1),
            bbAmUsdtBalance.mul(1)
          ],
          fromInternalBalance: false,
          userData: userDataInEncoded
        });
    }
    const bbAmUsdResultBalance = await IERC20__factory.connect(bbAmUSD, signer).balanceOf(signer.address);
    console.log("bbAmUsdResultBalance", bbAmUsdResultBalance);

    // { // Exit with single TOKEN
    //   const joinKind = 0; // EXACT_BPT_IN_FOR_ONE_TOKEN_OUT
    //   const abi = ['uint256', 'uint256', 'uint256'];
    //   const data = [
    //     joinKind,
    //     bbAmUsdResultBalance,
    //     await IBalancerBoostedAavePool__factory.connect(bbAmDAI, signer).getBptIndex()
    //   ]; // [EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, bptAmountIn, exitTokenIndex]
    //   const userDataOutEncoded = defaultAbiCoder.encode(abi, data);
    //
    //   await IERC20__factory.connect(bbAmUSD, signer).approve(vault.address, MAX_INT);
    //   const bpt = await poolBoosted.balanceOf(signer.address);
    //   console.log("bpt", bpt);
    //
    //   // try to exit from the pool
    //   await vault.exitPool(
    //     poolBoostedId,
    //     signer.address,
    //     signer.address,
    //     {
    //       assets: pi.tokens,
    //       minAmountsOut: [0, 0, 0, 0],
    //       toInternalBalance: false,
    //       userData: userDataOutEncoded
    //     }
    //   );
    //   console.log("vault.exitPool done");
    //
    //   const bbAmDaiBalance = await IERC20__factory.connect(bbAmDAI, signer).balanceOf(signer.address);
    //   const bbAmUsdcBalance = await IERC20__factory.connect(bbAmUSDC, signer).balanceOf(signer.address);
    //   const bbAmUsdtBalance = await IERC20__factory.connect(bbAmUSDT, signer).balanceOf(signer.address);
    //   console.log("bbAmDaiBalance", bbAmDaiBalance.toString());
    //   console.log("bbAmUsdcBalance", bbAmUsdcBalance.toString());
    //   console.log("bbAmUsdtBalance", bbAmUsdtBalance.toString());
    // }

    { // Exit with multiple TOKENs
      const joinKind = 1; // BPT_IN_FOR_EXACT_TOKENS_OUT
      const abi = ['uint256', 'uint256[]', 'uint256'];
      const data = [
        joinKind,
        [
          bbAmUsdResultBalance.div(3),
          bbAmUsdResultBalance.div(3),
          bbAmUsdResultBalance.sub(bbAmUsdResultBalance.div(3).mul(2))
        ],
        bbAmUsdResultBalance
      ]; // [BPT_IN_FOR_EXACT_TOKENS_OUT, amountsOut, maxBPTAmountIn]
      const userDataOutEncoded = defaultAbiCoder.encode(abi, data);

      // await IERC20__factory.connect(bbAmUSD, signer).approve(vault.address, MAX_INT);
      const bpt = await poolBoosted.balanceOf(signer.address);
      console.log("bpt", bpt);

      // try to exit from the pool
      await vault.exitPool(
        poolBoostedId,
        signer.address,
        signer.address,
        {
          assets: pi.tokens,
          minAmountsOut: [0, 0, 0, 0],
          toInternalBalance: false,
          userData: userDataOutEncoded
        }
      );
      console.log("vault.exitPool done");

      const bbAmDaiBalance = await IERC20__factory.connect(bbAmDAI, signer).balanceOf(signer.address);
      const bbAmUsdcBalance = await IERC20__factory.connect(bbAmUSDC, signer).balanceOf(signer.address);
      const bbAmUsdtBalance = await IERC20__factory.connect(bbAmUSDT, signer).balanceOf(signer.address);
      console.log("bbAmDaiBalance", bbAmDaiBalance.toString());
      console.log("bbAmUsdcBalance", bbAmUsdcBalance.toString());
      console.log("bbAmUsdtBalance", bbAmUsdtBalance.toString());
    }
  });

});