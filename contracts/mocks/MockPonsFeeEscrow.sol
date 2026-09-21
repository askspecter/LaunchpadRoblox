// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockPonsFeeEscrow {
    mapping(address => uint256) public balanceOf;

    function credit(address recipient) external payable {
        balanceOf[recipient] += msg.value;
    }

    function claim() external {
        uint256 amount = balanceOf[msg.sender];
        balanceOf[msg.sender] = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "NATIVE_TRANSFER_FAILED");
    }
}
