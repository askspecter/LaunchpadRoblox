// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPonsFeeEscrow {
    function balanceOf(address recipient) external view returns (uint256);
    function claim() external;
}

interface IPonsCurve {
    function sweepFees(uint256 minBuybackTokensOut) external;
}

interface IPonsMemeHook {
    function sweepPoolFees(
        bytes32 poolId,
        uint256 minConversionQuoteOut,
        uint256 minBuybackTokensOut
    ) external;
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

/// @title ClaimToRBLXAdapter
/// @notice Receives Pons V2 creator fees in native ETH, then swaps each claim
///         into a configured ERC-20 through Uniswap V3 and sends the output
///         directly to an immutable treasury.
/// @dev Use this contract as TokenParams.creatorFeeRecipient when launching a
///      native-ETH Pons V2 token. The owner is the only address allowed to set
///      slippage protection and execute the claim, preventing a third party
///      from forcing an intentionally poor swap.
contract ClaimToRBLXAdapter is Ownable, ReentrancyGuard {
    address public immutable ponsFeeEscrow;
    address public immutable ponsMemeHook;
    address public immutable swapRouter;
    address public immutable wrappedNative;
    address public immutable targetToken;
    address public immutable treasury;
    uint24 public immutable poolFee;

    error ZeroAddress();
    error InvalidPoolFee();
    error DeadlineExpired();
    error MinimumOutputRequired();
    error NothingToClaim();
    error NothingClaimed();
    error UnauthorizedNativeSender();

    event ClaimedAndBought(
        address indexed caller,
        address indexed treasury,
        uint256 ethClaimed,
        uint256 tokensReceived
    );

    constructor(
        address owner_,
        address ponsFeeEscrow_,
        address ponsMemeHook_,
        address swapRouter_,
        address wrappedNative_,
        address targetToken_,
        address treasury_,
        uint24 poolFee_
    ) Ownable(owner_) {
        if (
            owner_ == address(0) ||
            ponsFeeEscrow_ == address(0) ||
            ponsMemeHook_ == address(0) ||
            swapRouter_ == address(0) ||
            wrappedNative_ == address(0) ||
            targetToken_ == address(0) ||
            treasury_ == address(0)
        ) revert ZeroAddress();
        if (poolFee_ == 0) revert InvalidPoolFee();

        ponsFeeEscrow = ponsFeeEscrow_;
        ponsMemeHook = ponsMemeHook_;
        swapRouter = swapRouter_;
        wrappedNative = wrappedNative_;
        targetToken = targetToken_;
        treasury = treasury_;
        poolFee = poolFee_;
    }

    receive() external payable {
        if (msg.sender != ponsFeeEscrow && msg.sender != swapRouter) {
            revert UnauthorizedNativeSender();
        }
    }

    function claimable() external view returns (uint256) {
        return IPonsFeeEscrow(ponsFeeEscrow).balanceOf(address(this));
    }

    /// @notice Claims all native ETH currently owed to this adapter and swaps
    ///         exactly the newly claimed amount to targetToken.
    /// @param amountOutMinimum Minimum target tokens the treasury must receive.
    /// @param deadline Unix timestamp after which the transaction must revert.
    function claimAndBuy(uint256 amountOutMinimum, uint256 deadline)
        external
        onlyOwner
        nonReentrant
        returns (uint256 amountIn, uint256 amountOut)
    {
        return _claimAndBuy(amountOutMinimum, deadline);
    }

    /// @notice Sweeps pre-graduation curve fees, then claims and swaps the
    ///         resulting escrow balance in the same transaction.
    function sweepCurveClaimAndBuy(
        address curve,
        uint256 minBuybackTokensOut,
        uint256 amountOutMinimum,
        uint256 deadline
    ) external onlyOwner nonReentrant returns (uint256 amountIn, uint256 amountOut) {
        if (curve == address(0)) revert ZeroAddress();
        IPonsCurve(curve).sweepFees(minBuybackTokensOut);
        return _claimAndBuy(amountOutMinimum, deadline);
    }

    /// @notice Sweeps post-graduation pool fees, then claims and swaps the
    ///         resulting escrow balance in the same transaction.
    /// @dev Pons may require its trusted sweep operator when an internal
    ///      conversion or buyback is necessary; this function will then revert
    ///      atomically and no balances are lost.
    function sweepPoolClaimAndBuy(
        bytes32 poolId,
        uint256 minConversionQuoteOut,
        uint256 minBuybackTokensOut,
        uint256 amountOutMinimum,
        uint256 deadline
    ) external onlyOwner nonReentrant returns (uint256 amountIn, uint256 amountOut) {
        IPonsMemeHook(ponsMemeHook).sweepPoolFees(
            poolId,
            minConversionQuoteOut,
            minBuybackTokensOut
        );
        return _claimAndBuy(amountOutMinimum, deadline);
    }

    function _claimAndBuy(uint256 amountOutMinimum, uint256 deadline)
        internal
        returns (uint256 amountIn, uint256 amountOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountOutMinimum == 0) revert MinimumOutputRequired();
        if (IPonsFeeEscrow(ponsFeeEscrow).balanceOf(address(this)) == 0) {
            revert NothingToClaim();
        }

        uint256 balanceBefore = address(this).balance;
        IPonsFeeEscrow(ponsFeeEscrow).claim();
        amountIn = address(this).balance - balanceBefore;
        if (amountIn == 0) revert NothingClaimed();

        amountOut = ISwapRouter02(swapRouter).exactInputSingle{value: amountIn}(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: wrappedNative,
                tokenOut: targetToken,
                fee: poolFee,
                recipient: treasury,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );

        emit ClaimedAndBought(msg.sender, treasury, amountIn, amountOut);
    }
}
