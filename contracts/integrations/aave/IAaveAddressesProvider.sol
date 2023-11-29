// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice restored from 0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb (no events)
interface IAaveAddressesProvider {
  /**
   * @notice Returns the address of the ACL admin.
   * @return The address of the ACL admin
   */
  function getACLAdmin() external view returns (address);

  /**
   * @notice Returns the address of the ACL manager.
   * @return The address of the ACLManager
   */
  function getACLManager() external view returns (address);

  /**
   * @notice Returns an address by its identifier.
   * @dev The returned address might be an EOA or a contract, potentially proxied
   * @dev It returns ZERO if there is no registered address with the given id
   * @param id The id
   * @return The address of the registered for the specified id
   */
  function getAddress(bytes32 id) external view returns (address);

  /**
   * @notice Returns the id of the Aave market to which this contract points to.
   * @return The market id
   **/
  function getMarketId() external view returns (string memory);

  /**
   * @notice Returns the address of the Pool proxy.
   * @return The Pool proxy address
   **/
  function getPool() external view returns (address);

  /**
   * @notice Returns the address of the PoolConfigurator proxy.
   * @return The PoolConfigurator proxy address
   **/
  function getPoolConfigurator() external view returns (address);

  /**
   * @notice Returns the address of the data provider.
   * @return The address of the DataProvider
   */
  function getPoolDataProvider() external view returns (address);

  /**
   * @notice Returns the address of the price oracle.
   * @return The address of the PriceOracle
   */
  function getPriceOracle() external view returns (address);

  /**
   * @notice Returns the address of the price oracle sentinel.
   * @return The address of the PriceOracleSentinel
   */
  function getPriceOracleSentinel() external view returns (address);

  function owner() external view returns (address);

  function renounceOwnership() external;

  function setACLAdmin(address newAclAdmin) external;

  function setACLManager(address newAclManager) external;

  function setAddress(bytes32 id, address newAddress) external;

  function setAddressAsProxy(bytes32 id, address newImplementationAddress)
  external;

  function setMarketId(string memory newMarketId) external;

  function setPoolConfiguratorImpl(address newPoolConfiguratorImpl) external;

  function setPoolDataProvider(address newDataProvider) external;

  function setPoolImpl(address newPoolImpl) external;

  function setPriceOracle(address newPriceOracle) external;

  function setPriceOracleSentinel(address newPriceOracleSentinel) external;

  function transferOwnership(address newOwner) external;
}
