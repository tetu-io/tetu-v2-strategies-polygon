import { loadFixture, mine } from "@nomicfoundation/hardhat-network-helpers"
import chai, { expect } from "chai"
import chaiAsPromised from "chai-as-promised"
import { config as dotEnvConfig } from "dotenv"
import { ERC4626Strict, TetuV1SingleTokenStrictStrategy } from "../../../../typechain"
import { ethers } from "hardhat"
import { BigNumber } from "ethers"

dotEnvConfig()
// tslint:disable-next-line:no-var-requires
const argv = require("yargs/yargs")()
  .env("TETU")
  .options({
    disableStrategyTests: {
      type: "boolean",
      default: false
    },
    hardhatChainId: {
      type: "number",
      default: 137
    }
  }).argv

chai.use(chaiAsPromised)

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
const USDC_BIG_HOLDER_ADDRESS = "0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245"
const TETU_ADDRESS = "0x255707B70BF90aa112006E1b07B9AeA6De021424"
const TETU_BIG_HOLDER_ADDRESS = "0x8d7e07b1a346ac29e922ac01fa34cb2029f536b9"
const X_TETU_ADDRESS = "0x225084D30cc297F3b177d9f93f5C3Ab8fb6a1454"
const X_TETU_BIG_HOLDER_ADDRESS = "0x10feb6f3111197336bc64ad3d0a123f22719d58a"

const X_USDC_VAULT_ADDRESS = "0xeE3B4Ce32A6229ae15903CDa0A5Da92E739685f7"
const LIQUIDATOR_ADDRESS = "0xC737eaB847Ae6A92028862fE38b828db41314772"
const TETU_V1_CONTROLLER_ADDRESS = "0x6678814c273d5088114B6E40cC49C8DB04F9bC29"


async function simulateRewards(strategy: TetuV1SingleTokenStrictStrategy, rewardTokes: string[], amount: BigNumber) {
  for (const rewardToken of rewardTokes) {
    const rt = await ethers.getContractAt("IERC20", rewardToken)
    await rt.transfer(strategy.address, amount)
  }

}


describe("TetuV1 Single Token Strict Strategy tests", async () => {
  if (argv.disableStrategyTests || argv.hardhatChainId !== 137) {
    return
  }

  async function deployContracts() {

    const [owner, otherAccount] = await ethers.getSigners()

    // configure base contracts
    const StrategyFactory = await ethers.getContractFactory("TetuV1SingleTokenStrictStrategy")
    const strategy = await StrategyFactory.deploy(X_USDC_VAULT_ADDRESS, LIQUIDATOR_ADDRESS, X_TETU_ADDRESS) as TetuV1SingleTokenStrictStrategy
    const StrictVault = await ethers.getContractFactory("ERC4626Strict")
    const strictVault = await StrictVault.deploy(USDC_ADDRESS, "strUSDC", "strUSDC", strategy.address, 0) as ERC4626Strict
    await strategy.init(strictVault.address)
    const smartVault = await ethers.getContractAt("ISmartVault", X_USDC_VAULT_ADDRESS)

    // whitelist strategy
    const controller = await ethers.getContractAt("ITetuV1Controller", TETU_V1_CONTROLLER_ADDRESS)
    await owner.sendTransaction({ to: await controller.governance(), value: ethers.utils.parseEther("10") })
    const impersonatedGovernance = await ethers.getImpersonatedSigner(await controller.governance())
    await controller.connect(impersonatedGovernance).changeWhiteListStatus([strategy.address], true)

    // transfer some TETU to owner
    const tetu = await ethers.getContractAt("IERC20", TETU_ADDRESS)
    let impersonatedSigner = await ethers.getImpersonatedSigner(TETU_BIG_HOLDER_ADDRESS)
    await tetu.connect(impersonatedSigner).transfer(owner.address, ethers.utils.parseUnits("1000", 18))

    // transfer some xTETU to owner
    const xtetu = await ethers.getContractAt("IERC20", X_TETU_ADDRESS)
    impersonatedSigner = await ethers.getImpersonatedSigner(X_TETU_BIG_HOLDER_ADDRESS)
    await xtetu.connect(impersonatedSigner).transfer(owner.address, ethers.utils.parseUnits("1000", 18))


    // transfer some USDC to owner
    const usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS)
    impersonatedSigner = await ethers.getImpersonatedSigner(USDC_BIG_HOLDER_ADDRESS)
    await usdc.connect(impersonatedSigner).transfer(owner.address, ethers.utils.parseUnits("1000000", 6))
    await usdc.connect(owner)

    // send some USDC to otherAccount
    await usdc.transfer(otherAccount.address, ethers.utils.parseUnits("1000", 6))

    return { strictVault, strategy, smartVault, owner, otherAccount, usdc }
  }

  describe("Common tests", function() {
    it("Smoke test", async function() {
      const { strictVault, strategy } = await loadFixture(deployContracts)
      expect(await strictVault.strategy()).to.equal(strategy.address)
      expect(await strictVault.asset()).to.equal(USDC_ADDRESS)
      expect(await strictVault.name()).to.equal("strUSDC")
    })
  })

  describe("Deposit tests", function() {
    it("Simple deposit test", async function() {
      const { strictVault, strategy, smartVault, owner, usdc } = await loadFixture(deployContracts)
      const depositAmount = ethers.utils.parseUnits("1000", 6)
      await usdc.approve(strictVault.address, depositAmount)
      await strictVault.deposit(depositAmount, owner.address)
      expect(await strictVault.balanceOf(owner.address)).to.equal(depositAmount)
      expect(await strictVault.totalAssets()).approximately(depositAmount, 1)
      expect(await smartVault.underlyingBalanceWithInvestmentForHolder(strategy.address)).approximately(depositAmount, 1)
    })
  })

  describe("withdraw tests", function() {
    it("Simple withdraw test", async function() {
      const { strictVault, strategy, smartVault, owner, otherAccount, usdc } = await loadFixture(deployContracts)
      const depositAmount = ethers.utils.parseUnits("1000", 6)

      await usdc.approve(strictVault.address, depositAmount)
      await strictVault.deposit(depositAmount, owner.address)

      const ownerBalance = await strictVault.balanceOf(owner.address)
      const maxWithdrawAmount = await strictVault.maxWithdraw(owner.address)
      expect(maxWithdrawAmount).approximately(ownerBalance, 1)

      const balanceBefore = await usdc.balanceOf(owner.address)

      // rounding issues need to check maxWithdrawAmount
      await strictVault.withdraw(maxWithdrawAmount, owner.address, owner.address)
      const balanceAfter = await usdc.balanceOf(owner.address)
      expect(balanceAfter.sub(balanceBefore)).approximately(depositAmount, 1)
      expect(await smartVault.underlyingBalanceWithInvestmentForHolder(strategy.address)).approximately(0, 1)
    })
  })

  describe("hardwork test", function() {
    it("Simple hardwork test with TETU only rewards", async function() {
      const { strictVault, strategy, smartVault, owner, usdc } = await loadFixture(deployContracts)
      const depositAmount = ethers.utils.parseUnits("1000", 6)
      await usdc.approve(strictVault.address, depositAmount)
      await strictVault.deposit(depositAmount, owner.address)
      const rewardTokens = await smartVault.rewardTokens()
      await mine(1000)
      const usdcStrategyBalanceBefore = await smartVault.underlyingBalanceWithInvestmentForHolder(strategy.address)
      await strategy.doHardWork()
      const usdcStrategyBalanceAfter = await smartVault.underlyingBalanceWithInvestmentForHolder(strategy.address)
      expect(usdcStrategyBalanceAfter).gt(usdcStrategyBalanceBefore)
      console.log("Profit", usdcStrategyBalanceAfter.sub(usdcStrategyBalanceBefore).toString())

      for (const rewardToken of rewardTokens) {
        const rt = await ethers.getContractAt("IERC20", rewardToken)
        expect(await rt.balanceOf(strategy.address)).eq(0)
      }
    })

    it("Simple hardwork test with TETU and xTETU rewards", async function() {
      const { strictVault, strategy, smartVault, owner, otherAccount, usdc } = await loadFixture(deployContracts)
      const depositAmount = ethers.utils.parseUnits("1000", 6)

      await usdc.approve(strictVault.address, depositAmount)
      await strictVault.deposit(depositAmount, owner.address)
      const rewardTokens = await smartVault.rewardTokens()
      await simulateRewards(strategy, rewardTokens, ethers.utils.parseUnits("100", 18))
      const usdcStrategyBalanceBefore = await smartVault.underlyingBalanceWithInvestmentForHolder(strategy.address)
      await strategy.doHardWork()
      const usdcStrategyBalanceAfter = await smartVault.underlyingBalanceWithInvestmentForHolder(strategy.address)
      const usdcInStrategy = await usdc.balanceOf(strategy.address)
      expect(usdcInStrategy).is.eq(0)
      const usdcInStrictVault = await usdc.balanceOf(strictVault.address)
      expect(usdcInStrictVault).is.eq(0)

      expect(usdcStrategyBalanceAfter).gt(usdcStrategyBalanceBefore)
      for (const rewardToken of rewardTokens) {
        const rt = await ethers.getContractAt("IERC20", rewardToken)
        expect(await rt.balanceOf(strategy.address)).eq(0)
      }
      const ownerBalanceUsdcBefore = await usdc.balanceOf(owner.address)
      await strictVault.withdrawAll()
      const ownerBalanceUsdcAfter = await usdc.balanceOf(owner.address)
      expect(ownerBalanceUsdcAfter.sub(ownerBalanceUsdcBefore)).gt(depositAmount)
      expect(await smartVault.underlyingBalanceWithInvestmentForHolder(strategy.address)).approximately(0, 1)
      expect(await strictVault.totalSupply()).approximately(0, 1)
    })

  })

})
