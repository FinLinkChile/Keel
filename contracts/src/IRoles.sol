// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @notice Minimal slice of the Zodiac Roles Modifier v2 interface used by PDRGate.
/// @dev Matches `execTransactionWithRole` in zodiac-modifier-roles v2.
interface IRoles {
    enum Operation {
        Call,
        DelegateCall
    }

    function execTransactionWithRole(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        bytes32 roleKey,
        bool shouldRevert
    ) external returns (bool success);
}
