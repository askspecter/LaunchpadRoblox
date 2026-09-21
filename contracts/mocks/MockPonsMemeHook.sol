// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockPonsFeeEscrow} from "./MockPonsFeeEscrow.sol";

contract MockPonsMemeHook {
    MockPonsFeeEscrow public immutable escrow;
    mapping(bytes32 => address) public creatorFeeRecipient;

    constructor(MockPonsFeeEscrow escrow_) {
        escrow = escrow_;
    }

    function register(bytes32 poolId, address recipient) external payable {
        creatorFeeRecipient[poolId] = recipient;
    }

    function sweepPoolFees(bytes32 poolId, uint256, uint256) external {
        address recipient = creatorFeeRecipient[poolId];
        require(msg.sender == recipient, "NOT_CREATOR_RECIPIENT");
        escrow.credit{value: address(this).balance}(recipient);
    }
}
