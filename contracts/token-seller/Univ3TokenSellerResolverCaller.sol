// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

interface IResolver {
  function checker()
  external
  view
  returns (bool canExec, bytes memory execPayload);
}

contract Univ3TokenSellerResolverCaller {
  enum LastCallResults {
    NOT_CALLED_0,
    SUCCESS_1,
    FAILED_2
  }

  address public resolver;
  LastCallResults public lastCallResults;

  constructor(address resolver_) {
    resolver = resolver_;
  }

  function callChecker() external {
    (
      bool canExecOut,
      bytes memory execPayloadOut
    ) = IResolver(resolver).checker();

    if (canExecOut) {
      (bool success,) = address(resolver).call(execPayloadOut);
      lastCallResults = success
        ? LastCallResults.SUCCESS_1
        : LastCallResults.FAILED_2;
    } else {
      lastCallResults = LastCallResults.NOT_CALLED_0;
    }
  }
}