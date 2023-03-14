// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20.sol";
import "@tetu_io/tetu-contracts-v2/contracts/vault/ERC4626Strict.sol";


contract DummyERC4626Strict is ERC4626Strict {
    constructor(IERC20 asset_,
        string memory _name,
        string memory _symbol,
        address _strategy,
        uint _buffer)  ERC4626Strict(asset_, _name, _symbol, _strategy, _buffer){}
}
