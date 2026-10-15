// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Token that burns 1% of every transfer, to show `fund` rejects a short deposit.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @notice Token that calls back into the escrow on every transfer out of it, to show
/// the reentrancy guard holds. The callback is set by the test.
contract ReentrantToken is ERC20 {
    address public escrow;
    bytes public callback;

    constructor() ERC20("Reentrant Token", "RE") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function arm(address escrow_, bytes calldata callback_) external {
        escrow = escrow_;
        callback = callback_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from == escrow && escrow != address(0) && callback.length != 0) {
            (bool ok, bytes memory ret) = escrow.call(callback);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}

/// @notice Smart-contract wallet that signs with ERC-1271 (like a company Safe) and can
/// execute calls, so it can open, approve and fund an order as the importer.
contract MockSafe1271 {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 h, bytes calldata sig) external view returns (bytes4) {
        (bytes32 r, bytes32 s, uint8 v) = abi.decode(sig, (bytes32, bytes32, uint8));
        return ecrecover(h, v, r, s) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function exec(address to, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == owner, "not owner");
        (bool ok, bytes memory ret) = to.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
}

/// @notice Token that reverts on zero-amount transfers, to show the escrow skips them.
contract ZeroRevertToken is ERC20 {
    error ZeroTransfer();

    constructor() ERC20("Zero Revert Token", "ZR") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (value == 0) revert ZeroTransfer();
        super._update(from, to, value);
    }
}

/// @notice Token that records the payout balance at the moment the deposit reaches the
/// escrow and reverts if the escrow pays the payout address before receiving the deposit,
/// to show that fund pulls (and checks) the total before the advance leaves.
contract OrderingToken is ERC20 {
    error AdvanceBeforeDeposit();

    address public escrow;
    address public payout;
    bool public armed;
    bool public depositReceived;
    uint256 public payoutBalanceAtDeposit;

    constructor() ERC20("Ordering Token", "ORD") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function arm(address escrow_, address payout_) external {
        escrow = escrow_;
        payout = payout_;
        armed = true;
        depositReceived = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (armed && from == escrow && to == payout && !depositReceived) revert AdvanceBeforeDeposit();
        super._update(from, to, value);
        if (armed && to == escrow && from != address(0)) {
            depositReceived = true;
            payoutBalanceAtDeposit = balanceOf(payout);
        }
    }
}
