// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITradeEscrow} from "../src/ITradeEscrow.sol";

// Zodiac Roles Modifier v2.1.1, the master copy at 0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5.
// Source: gnosisguild/zodiac-modifier-roles, branch v2, commit 218a5164 ("v2.1.1 (#486)"),
// packages/evm/contracts. packages/evm/mastercopies.json at that commit lists Roles 2.1.1 at this
// address (2.1.0, commit a19c0ebd, is 0x9646fDAD06d3e24444381f44362a3B0eB343D337), and the
// independent review matched the on-chain runtime byte for byte against the 2.1.1 artifact.
// 2.1.0 to 2.1.1 only changes PermissionChecker._arraySome and _bitmask, which Keel does not use,
// and patches the zodiac SignatureChecker at build time (scripts/patch-zodiac-signature-checker.js).
// The repository HEAD (d50a1b2b, "contracts-v3") is a different, newer contract.
// Only what Keel uses is mirrored here. Numeric values of the enums are part of the ABI.

/// @dev Types.sol at 218a5164: enum ParameterType.
enum ParameterType {
    None,
    Static,
    Dynamic,
    Tuple,
    Array,
    Calldata,
    AbiEncoded
}

/// @dev Types.sol at 218a5164: enum Operator. Only the values Keel uses are named constants below.
library RolesOperator {
    uint8 internal constant Pass = 0;
    uint8 internal constant Matches = 5;
    uint8 internal constant EqualTo = 16;
    uint8 internal constant WithinAllowance = 28;
}

/// @dev Types.sol at 218a5164: enum ExecutionOptions.
enum ExecutionOptions {
    None,
    Send,
    DelegateCall,
    Both
}

/// @dev Types.sol at 218a5164: struct ConditionFlat (BFS-flattened condition tree; `parent` is the
/// index of the parent node, the root is its own parent). `operator` is the Operator enum value.
struct ConditionFlat {
    uint8 parent;
    ParameterType paramType;
    uint8 operator;
    bytes compValue;
}

/// @dev PermissionChecker.sol at 218a5164: enum Status, the first field of ConditionViolation.
library RolesStatus {
    uint8 internal constant Ok = 0;
    uint8 internal constant DelegateCallNotAllowed = 1;
    uint8 internal constant TargetAddressNotAllowed = 2;
    uint8 internal constant FunctionNotAllowed = 3;
    uint8 internal constant SendNotAllowed = 4;
    uint8 internal constant ParameterNotAllowed = 7;
    uint8 internal constant ParameterNotAMatch = 10;
    uint8 internal constant AllowanceExceeded = 17;
}

/// @notice The slice of Zodiac Roles v2 that Keel calls.
/// @dev Signatures from Roles.sol, PermissionBuilder.sol, Core.sol and PermissionChecker.sol at
/// 218a5164; Modifier from the gnosis.pm zodiac package 3.4.1 (gnosisguild/zodiac v3.4.1,
/// contracts/core/Modifier.sol), with the build-time SignatureChecker patch of 2.1.1. All builders are onlyOwner (the Safe).
interface IZodiacRolesV2 {
    // PermissionChecker.sol at 218a5164
    error NoMembership();
    error ConditionViolation(uint8 status, bytes32 info);
    // Roles.sol at 218a5164
    error ModuleTransactionFailed();
    // zodiac v3.4.1 Modifier.sol: moduleOnly reverts with this for a sender that is not an enabled module
    error NotAuthorized(address sender);

    function setUp(bytes memory initParams) external;
    function owner() external view returns (address);
    function avatar() external view returns (address);
    function target() external view returns (address);
    function isModuleEnabled(address module) external view returns (bool);

    function assignRoles(address module, bytes32[] calldata roleKeys, bool[] calldata memberOf) external;
    function scopeTarget(bytes32 roleKey, address targetAddress) external;
    function allowFunction(bytes32 roleKey, address targetAddress, bytes4 selector, ExecutionOptions options) external;
    function scopeFunction(
        bytes32 roleKey,
        address targetAddress,
        bytes4 selector,
        ConditionFlat[] memory conditions,
        ExecutionOptions options
    ) external;
    /// @dev maxRefill = 0 means type(uint128).max; timestamp = 0 means block.timestamp.
    function setAllowance(
        bytes32 key,
        uint128 balance,
        uint128 maxRefill,
        uint128 refill,
        uint64 period,
        uint64 timestamp
    ) external;
    /// @dev Core.sol at 218a5164: public mapping, Types.sol field order.
    function allowances(bytes32 key)
        external
        view
        returns (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance, uint64 timestamp);

    /// @dev operation: 0 = Call, 1 = DelegateCall (Enum.Operation of zodiac).
    function execTransactionWithRole(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        bytes32 roleKey,
        bool shouldRevert
    ) external returns (bool success);
}

/// @title TradeRolesConfig
/// @notice The Zodiac Roles configuration of a Keel Trade importer Safe (T1.2), as an ordered list
/// of calls the Safe makes on its own Roles instance. The fork tests (T1.7) and the deployment
/// script (T1.8) apply this same list, and `configHash` is the candidate for `rolesConfigHash`.
/// @dev For each of the two roles (AGENT for tier 1, AGENT_COSIGNED for tier 3, used by the gate
/// only with the cosignature), with its own allowance key:
///   scopeTarget(role, token)
///   scopeFunction(role, token, approve, Matches(Calldata)[EqualTo(Static, escrow), WithinAllowance(Static, key)], None)
///   scopeTarget(role, escrow)
///   allowFunction(role, escrow, fund, None)
///   setAllowance(key, cap, cap, cap, period, 0)
/// then assignRoles(gate, [AGENT, AGENT_COSIGNED], [true, true]). Nothing targets the gate,
/// nothing allows transfer, value or delegatecall. EqualTo's compValue is the 32-byte ABI word;
/// Roles stores its keccak (BufferPacker.sol at 218a5164). WithinAllowance's compValue is the key.
library TradeRolesConfig {
    struct Params {
        address token;
        address escrow;
        address gate;
        bytes32 agentRole;
        bytes32 cosignedRole;
        bytes32 agentAllowanceKey;
        bytes32 cosignedAllowanceKey;
        uint128 agentCap;
        uint128 cosignedCap;
        uint64 period;
    }

    struct Call {
        address to;
        bytes data;
    }

    bytes4 internal constant APPROVE = IERC20.approve.selector;
    bytes4 internal constant FUND = ITradeEscrow.fund.selector;

    /// @notice The condition tree of `approve(spender, amount)`: spender is the escrow and amount
    /// is within the allowance `key`.
    function approveConditions(address escrow, bytes32 key) internal pure returns (ConditionFlat[] memory c) {
        c = new ConditionFlat[](3);
        c[0] = ConditionFlat({
            parent: 0, paramType: ParameterType.Calldata, operator: RolesOperator.Matches, compValue: ""
        });
        c[1] = ConditionFlat({
            parent: 0, paramType: ParameterType.Static, operator: RolesOperator.EqualTo, compValue: abi.encode(escrow)
        });
        c[2] = ConditionFlat({
            parent: 0,
            paramType: ParameterType.Static,
            operator: RolesOperator.WithinAllowance,
            compValue: abi.encode(key)
        });
    }

    /// @notice The calls the Safe executes on `roles`, in order.
    function calls(Params memory p) internal pure returns (Call[] memory list) {
        list = new Call[](11);
        uint256 i;
        (i, list) = _role(list, i, p.agentRole, p.agentAllowanceKey, p.agentCap, p);
        (i, list) = _role(list, i, p.cosignedRole, p.cosignedAllowanceKey, p.cosignedCap, p);
        bytes32[] memory keys = new bytes32[](2);
        keys[0] = p.agentRole;
        keys[1] = p.cosignedRole;
        bool[] memory on = new bool[](2);
        on[0] = true;
        on[1] = true;
        list[i] = Call(address(0), abi.encodeCall(IZodiacRolesV2.assignRoles, (p.gate, keys, on)));
    }

    /// @notice keccak256 of the ABI encoding of the ordered calls (target left as zero: the Roles
    /// instance of each Safe). Candidate definition of rolesConfigHash, to agree with Area 2.
    function configHash(Params memory p) internal pure returns (bytes32) {
        return keccak256(abi.encode(calls(p)));
    }

    function _role(Call[] memory list, uint256 i, bytes32 role, bytes32 key, uint128 cap, Params memory p)
        private
        pure
        returns (uint256, Call[] memory)
    {
        list[i++] = Call(address(0), abi.encodeCall(IZodiacRolesV2.scopeTarget, (role, p.token)));
        list[i++] = Call(
            address(0),
            abi.encodeCall(
                IZodiacRolesV2.scopeFunction,
                (role, p.token, APPROVE, approveConditions(p.escrow, key), ExecutionOptions.None)
            )
        );
        list[i++] = Call(address(0), abi.encodeCall(IZodiacRolesV2.scopeTarget, (role, p.escrow)));
        list[i++] = Call(
            address(0), abi.encodeCall(IZodiacRolesV2.allowFunction, (role, p.escrow, FUND, ExecutionOptions.None))
        );
        list[i++] = Call(address(0), abi.encodeCall(IZodiacRolesV2.setAllowance, (key, cap, cap, cap, p.period, 0)));
        return (i, list);
    }
}
