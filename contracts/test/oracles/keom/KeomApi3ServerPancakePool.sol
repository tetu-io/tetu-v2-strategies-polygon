// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@tetu_io/tetu-contracts-v2/contracts/interfaces/IERC20Metadata.sol";
import "@tetu_io/tetu-contracts-v2/contracts/openzeppelin/Math.sol";
import "../../../integrations/pancake/IPancakeV3Pool.sol";
import "../../../integrations/keom/IKeomPriceOracle.sol";
import "../../../integrations/keom/IKeomApi3Server.sol";
import "hardhat/console.sol";

contract KeomApi3ServerPancakePool is IKeomApi3Server {
  uint private constant TWO_96 = 2 ** 96;

  IKeomPriceOracle public keomPriceOracle;
  address public stableKToken;
  address public volatileKToken;
  address public tokenIn;
  address public pool;

  constructor (
    address keomPriceOracle_,
    address stableKToken_,
    address volatileKToken_,
    address pool_,
    address variableAsset_
  ) {
    pool = pool_;
    keomPriceOracle = IKeomPriceOracle(keomPriceOracle_);
    stableKToken = stableKToken_;
    volatileKToken = volatileKToken_;
    tokenIn = variableAsset_;
  }

  /// @return value Price with decimals 18
  function readDataFeedWithId(bytes32 dataFeedId) external view returns (int224 value, uint32 timestamp) {
    console.log("readDataFeedWithId");
    bytes32 feedStable = keomPriceOracle.feeds(stableKToken);
    bytes32 feedVariable = keomPriceOracle.feeds(volatileKToken);
    if (dataFeedId == feedStable) {
      (value, timestamp) = IKeomApi3Server(keomPriceOracle.api3Server()).readDataFeedWithId(dataFeedId);
      console.log("readDataFeedWithId.1.real.value");console.logInt(value);
      console.log("readDataFeedWithId.1.real.timestamp", timestamp);
      console.log("readDataFeedWithId.1.price", 1e18);
      console.log("readDataFeedWithId.1.timestamp", timestamp);
      timestamp = uint32(block.timestamp);
      value = int224(1e18); // price of the stable token
    } else if (dataFeedId == feedVariable) {
      (value, timestamp) = IKeomApi3Server(keomPriceOracle.api3Server()).readDataFeedWithId(dataFeedId);
      console.log("readDataFeedWithId.2.real.value");console.logInt(value);
      console.log("readDataFeedWithId.2.real.timestamp", timestamp);
      timestamp = uint32(block.timestamp);
      uint price = getPrice() * 10**10;
      console.log("readDataFeedWithId.2.price", price);
      console.log("readDataFeedWithId.2.timestamp", timestamp);
      value = int224(int(price));
    } else {
      (value, timestamp) = IKeomApi3Server(keomPriceOracle.api3Server()).readDataFeedWithId(dataFeedId);
      console.log("readDataFeedWithId.3.value");console.logInt(value);
      console.log("readDataFeedWithId.3.timestamp", timestamp);
    }
  }

  /// @return price with decimals 8
  function getPrice() public view returns (uint) {
    address token0 = IPancakeV3Pool(pool).token0();
    address token1 = IPancakeV3Pool(pool).token1();

    uint256 tokenInDecimals = tokenIn == token0 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    uint256 tokenOutDecimals = tokenIn == token1 ? IERC20Metadata(token0).decimals() : IERC20Metadata(token1).decimals();
    (uint160 sqrtPriceX96,,,,,,) = IPancakeV3Pool(pool).slot0();

    uint divider = tokenOutDecimals < 18 ? Math.max(10 ** tokenOutDecimals / 10 ** tokenInDecimals, 1) : 1;

    uint priceDigits = _countDigits(uint(sqrtPriceX96));
    uint purePrice;
    uint precision;
    if (tokenIn == token0) {
      precision = 10 ** ((priceDigits < 29 ? 29 - priceDigits : 0) + tokenInDecimals);
      uint part = uint(sqrtPriceX96) * precision / TWO_96;
      purePrice = part * part;
    } else {
      precision = 10 ** ((priceDigits > 29 ? priceDigits - 29 : 0) + tokenInDecimals);
      uint part = TWO_96 * precision / uint(sqrtPriceX96);
      purePrice = part * part;
    }
    uint price = purePrice / divider / precision / (precision > 1e18 ? (precision / 1e18) : 1);

    if (tokenOutDecimals > 8) {
      price = price / 10 ** (tokenOutDecimals - 8);
    } else if (tokenOutDecimals < 8) {
      price = price * 10 ** (8 - tokenOutDecimals);
    }
    // console.log("getPrice.price", price);
    return price;
  }

  function _countDigits(uint n) internal pure returns (uint) {
    if (n == 0) {
      return 0;
    }
    uint count = 0;
    while (n != 0) {
      n = n / 10;
      ++count;
    }
    return count;
  }
}