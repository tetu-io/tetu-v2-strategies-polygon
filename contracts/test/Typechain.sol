// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

// import contracts here from node_moules to include it in to typechain
import "@tetu_io/tetu-contracts-v2/contracts/test/MockToken.sol";
import "@tetu_io/tetu-contracts-v2/contracts/proxy/ProxyControlled.sol";
import "@tetu_io/tetu-contracts-v2/contracts/test/Multicall.sol";

// for hardhat chain quick tests
import "@tetu_io/tetu-contracts-v2/contracts/test/ControllerMinimal.sol";
import "@tetu_io/tetu-contracts-v2/contracts/test/MockGauge.sol";
import "@tetu_io/tetu-contracts-v2/contracts/test/MockStrategy.sol";
import "@tetu_io/tetu-contracts-v2/contracts/test/MockStrategySimple.sol";
import "@tetu_io/tetu-contracts-v2/contracts/test/MockSplitter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/vault/TetuVaultV2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/vault/VaultInsurance.sol";
import "@tetu_io/tetu-contracts-v2/contracts/vault/StrategySplitterV2.sol";

// for TokenUtils / Tests
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IVeTetu.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IPlatformVoter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IVeDistributor.sol";

//
import "@tetu_io/tetu-contracts-v2/contracts/vault/VaultFactory.sol";
import "@tetu_io/tetu-contracts-v2/contracts/infrastructure/ForwarderV3.sol";
import "@tetu_io/tetu-contracts-v2/contracts/infrastructure/ControllerV2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/infrastructure/PlatformVoter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/infrastructure/InvestFundV2.sol";
import "@tetu_io/tetu-contracts-v2/contracts/ve/VeTetu.sol";
import "@tetu_io/tetu-contracts-v2/contracts/ve/VeDistributor.sol";
import "@tetu_io/tetu-contracts-v2/contracts/ve/TetuVoter.sol";
import "@tetu_io/tetu-contracts-v2/contracts/reward/MultiGauge.sol";
import "@tetu_io/tetu-contracts-v2/contracts/reward/MultiBribe.sol";


contract ___typechain___ {}
