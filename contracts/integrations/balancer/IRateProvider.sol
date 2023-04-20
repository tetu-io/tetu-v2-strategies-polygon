// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

interface IRateProvider {
  /**
   * @dev Returns an 18 decimal fixed point number that is the exchange rate of the token to some other underlying
     * token. The meaning of this rate depends on the context.
     */
  function getRate() external view returns (uint256);
}
