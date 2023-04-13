// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC4626.sol";
import "../../integrations/balancer/IRateProvider.sol";

/// @dev Rete provider which uses external rate provider to calculate rate.
///      It is used to calculate rate for tokens like stMatic. We have external rate for MATIC/stMatic.
/// @author AlehNat
contract ExternalRateProvider is IRateProvider {

  // underlying asset
  address public immutable asset;

  // ERC4626 vault
  address public immutable vault;

  // external rate provider
  address public immutable externalRateProvider;

  constructor(address _asset, address _vault, address _externalRateProvider) {
    require(_asset != address(0) && _vault != address(0) && _externalRateProvider != address(0), 'mandatory params');
    asset = _asset;
    vault = _vault;
    externalRateProvider = _externalRateProvider;
  }

  function getRate() external view override returns (uint256) {
    uint assetPrecision = 10 ** IERC20Metadata(asset).decimals();
    return IERC4626(vault).convertToAssets(assetPrecision) * IRateProvider(externalRateProvider).getRate() / assetPrecision;
  }

}
