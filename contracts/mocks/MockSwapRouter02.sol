// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";

contract MockSwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    MockERC20 public immutable targetToken;
    uint256 public immutable rate;

    constructor(MockERC20 targetToken_, uint256 rate_) {
        targetToken = targetToken_;
        rate = rate_;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        require(msg.value == params.amountIn, "BAD_VALUE");
        require(params.tokenOut == address(targetToken), "BAD_TARGET");
        amountOut = msg.value * rate;
        require(amountOut >= params.amountOutMinimum, "TOO_LITTLE_RECEIVED");
        targetToken.mint(params.recipient, amountOut);
    }
}
