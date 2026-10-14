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
