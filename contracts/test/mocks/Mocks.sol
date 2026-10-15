// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IRoles} from "../../src/IRoles.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// @notice Minimal Safe: holds funds, lets enabled modules execute, lets the owner call out.
contract MockSafe {
    address public owner;
    mapping(address => bool) public isModule;

    constructor(address owner_) {
        owner = owner_;
    }

    function enableModule(address m) external {
        require(msg.sender == owner, "owner");
        isModule[m] = true;
    }

    function exec(address to, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == owner, "owner");
        (bool ok, bytes memory ret) = to.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 op)
        external
        returns (bool ok)
    {
        require(isModule[msg.sender], "not module");
        require(op == 0, "no delegatecall");
        (ok,) = to.call{value: value}(data);
    }
}

/// @notice Emulates the subset of Zodiac Roles v2 semantics that the AGENTE role relies on:
/// membership, single target, single selector, recipient allowlist, per-period allowance,
/// no value, no delegatecall. Errors mirror the real contract (NoMembership,
/// ConditionViolation(Status, info)) so tests port to the Base Sepolia fork (T1.7).
/// The exact Status the real Roles returns for each case must be confirmed on the fork.
contract MockRoles is IRoles {
    // Subset of Zodiac Roles v2 PermissionChecker.Status, same numeric order as the real enum
    uint8 constant TargetAddressNotAllowed = 2;
    uint8 constant FunctionNotAllowed = 3;
    uint8 constant SendNotAllowed = 4;
    uint8 constant DelegateCallNotAllowed = 1;
    uint8 constant OrViolation = 5;
    uint8 constant AllowanceExceeded = 17;

    error NoMembership();
    error ConditionViolation(uint8 status, bytes32 info);
    error ModuleTransactionFailed();

    MockSafe public immutable avatar;
    address public immutable token;
    bytes4 constant TRANSFER = 0xa9059cbb;

    mapping(bytes32 => mapping(address => bool)) public members;
    mapping(address => bool) public allowlist;
    uint256 public allowance; // remaining in current period
    uint256 public refill;
    uint256 public period;
    uint256 public periodStart;

    constructor(MockSafe avatar_, address token_, uint256 refill_, uint256 period_) {
        avatar = avatar_;
        token = token_;
        refill = refill_;
        allowance = refill_;
        period = period_;
        periodStart = block.timestamp;
    }

    modifier onlyAvatar() {
        require(msg.sender == address(avatar), "only avatar");
        _;
    }

    function assignRole(bytes32 role, address m, bool on) external onlyAvatar {
        members[role][m] = on;
    }

    function setAllowlisted(address a, bool on) external onlyAvatar {
        allowlist[a] = on;
    }

    function execTransactionWithRole(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        bytes32 roleKey,
        bool shouldRevert
    ) external returns (bool success) {
        if (!members[roleKey][msg.sender]) revert NoMembership();
        if (to != token) revert ConditionViolation(TargetAddressNotAllowed, 0);
        if (operation != Operation.Call) revert ConditionViolation(DelegateCallNotAllowed, 0);
        if (value != 0) revert ConditionViolation(SendNotAllowed, 0);
        if (data.length != 68 || bytes4(data[:4]) != TRANSFER) revert ConditionViolation(FunctionNotAllowed, 0);
        (address recipient, uint256 amount) = abi.decode(data[4:], (address, uint256));
        if (!allowlist[recipient]) revert ConditionViolation(OrViolation, 0);
        if (block.timestamp >= periodStart + period) {
            periodStart = block.timestamp;
            allowance = refill;
        }
        if (amount > allowance) revert ConditionViolation(AllowanceExceeded, 0);
        allowance -= amount;
        success = avatar.execTransactionFromModule(to, 0, data, 0);
        if (shouldRevert && !success) revert ModuleTransactionFailed();
    }
}

/// @notice Roles that reports failure by returning false instead of reverting, to show the
/// gate does not rely on Roles reverting on its own.
contract MockRolesReturnsFalse is IRoles {
    function execTransactionWithRole(address, uint256, bytes calldata, Operation, bytes32, bool)
        external
        pure
        returns (bool)
    {
        return false;
    }
}

/// @notice ERC-1271 smart-wallet cosigner, to show a Safe can be the cosigner.
contract Mock1271 {
    address public signer;

    constructor(address s) {
        signer = s;
    }

    function isValidSignature(bytes32 h, bytes calldata sig) external view returns (bytes4) {
        (bytes32 r, bytes32 s, uint8 v) = abi.decode(sig, (bytes32, bytes32, uint8));
        return ecrecover(h, v, r, s) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

/// @notice Emulates the subset of Zodiac Roles v2 semantics the Trade roles rely on (AGENT and
/// AGENT_COSIGNED, docs/trabajo/area-1-contratos.md T1.2): membership per role, a per-period
/// allowance per role spent by the approve amount, only `token.approve(escrow, amount)` and
/// `escrow.fund(orderId)`, no value, no delegatecall. Errors mirror the real contract
/// (NoMembership, ConditionViolation(Status, info)); the exact Status the real Roles returns
/// for each case must be confirmed on the fork (T1.7). Separate from MockRoles so the Personal
/// mock and the PDRGate tests stay byte for byte as they were.
contract MockTradeRoles is IRoles {
    // Subset of Zodiac Roles v2 PermissionChecker.Status, same numeric order as the real enum
    uint8 constant DelegateCallNotAllowed = 1;
    uint8 constant TargetAddressNotAllowed = 2;
    uint8 constant FunctionNotAllowed = 3;
    uint8 constant SendNotAllowed = 4;
    uint8 constant ParameterNotAMatch = 10;
    uint8 constant AllowanceExceeded = 17;

    error NoMembership();
    error ConditionViolation(uint8 status, bytes32 info);
    error ModuleTransactionFailed();

    struct Allowance {
        uint256 balance;
        uint256 refill;
        uint256 period;
        uint256 start;
    }

    MockSafe public immutable avatar;
    address public immutable token;
    address public immutable escrow;
    bytes4 constant APPROVE = 0x095ea7b3;
    bytes4 constant FUND = bytes4(keccak256("fund(bytes32)"));

    mapping(bytes32 => mapping(address => bool)) public members;
    mapping(bytes32 => Allowance) public allowances;
    /// @dev Test switch: report failure by returning false (without executing) for this target.
    address public returnFalseFor;

    constructor(MockSafe avatar_, address token_, address escrow_) {
        avatar = avatar_;
        token = token_;
        escrow = escrow_;
    }

    modifier onlyAvatar() {
        require(msg.sender == address(avatar), "only avatar");
        _;
    }

    function assignRole(bytes32 role, address m, bool on) external onlyAvatar {
        members[role][m] = on;
    }

    function setAllowance(bytes32 role, uint256 refill, uint256 period) external onlyAvatar {
        allowances[role] = Allowance(refill, refill, period, block.timestamp);
    }

    function setReturnFalseFor(address target) external {
        returnFalseFor = target;
    }

    function remaining(bytes32 role) external view returns (uint256) {
        return allowances[role].balance;
    }

    function execTransactionWithRole(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        bytes32 roleKey,
        bool shouldRevert
    ) external returns (bool success) {
        if (!members[roleKey][msg.sender]) revert NoMembership();
        if (operation != Operation.Call) revert ConditionViolation(DelegateCallNotAllowed, 0);
        if (value != 0) revert ConditionViolation(SendNotAllowed, 0);
        if (to == token) {
            if (data.length != 68 || bytes4(data[:4]) != APPROVE) revert ConditionViolation(FunctionNotAllowed, 0);
            (address spender, uint256 amount) = abi.decode(data[4:], (address, uint256));
            if (spender != escrow) revert ConditionViolation(ParameterNotAMatch, 0);
            Allowance storage a = allowances[roleKey];
            if (block.timestamp >= a.start + a.period) {
                a.start = block.timestamp;
                a.balance = a.refill;
            }
            if (amount > a.balance) revert ConditionViolation(AllowanceExceeded, 0);
            a.balance -= amount;
        } else if (to == escrow) {
            if (data.length != 36 || bytes4(data[:4]) != FUND) revert ConditionViolation(FunctionNotAllowed, 0);
        } else {
            revert ConditionViolation(TargetAddressNotAllowed, 0);
        }
        if (to == returnFalseFor) return false;
        success = avatar.execTransactionFromModule(to, 0, data, 0);
        if (shouldRevert && !success) revert ModuleTransactionFailed();
    }
}
