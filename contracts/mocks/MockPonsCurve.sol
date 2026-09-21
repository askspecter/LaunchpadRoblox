// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockPonsFeeEscrow} from "./MockPonsFeeEscrow.sol";

contract MockPonsCurve {
    MockPonsFeeEscrow public immutable escrow;
    address public immutable creatorFeeRecipient;

    constructor(MockPonsFeeEscrow escrow_, address creatorFeeRecipient_) payable {
        escrow = escrow_;
        creatorFeeRecipient = creatorFeeRecipient_;
    }

    function sweepFees(uint256) external {
        require(msg.sender == creatorFeeRecipient, "NOT_CREATOR_RECIPIENT");
        escrow.credit{value: address(this).balance}(creatorFeeRecipient);
    }
}
