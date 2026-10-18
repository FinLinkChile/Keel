// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {FundingGate} from "../src/FundingGate.sol";
import {PDRVerifier} from "../src/PDRVerifier.sol";
import {IDelay110} from "./KeelExternal.sol";
import {DeploymentsFile} from "./DeploymentsFile.sol";

/// @title SetTradePolicy
/// @notice Sets the policy hash of the Trade gate to the value Area 2 delivers, through the Delay
/// (decision D5): the owner queues FundingGate.setPolicyHash and, after the Delay cooldown
/// (180 s) and before it expires (1 day later), anyone executes it. The Delay calls the Safe,
/// and the Safe calls the gate, which accepts it because it comes from the Safe.
///
///   1. forge script script/SetTradePolicy.s.sol --sig "queue()"   --rpc-url base_sepolia --broadcast
///   2. after 180 s:
///      forge script script/SetTradePolicy.s.sol --sig "execute()" --rpc-url base_sepolia --broadcast
///
/// Env: POLICY_HASH (the value from Area 2), OWNER_PRIVATE_KEY (queue, demo only: the owner is a
/// Delay module; in production the owner sends queueCall() from their own wallet), EXECUTOR_PRIVATE_KEY (execute; defaults to OWNER_PRIVATE_KEY: executeNextTx is open to
/// anyone), KEEL_DEPLOYMENTS_FILE (default ./deployments/84532.json).
///
/// @dev Why there is a second step at all: the gate's constructor takes a policyHash, but Area 2's
/// policy hash commits to rolesConfigHash, which commits to the gate address. So DeployTrade
/// deploys the gate with a placeholder and this script sets the real value.
/// The Delay executes its queue in order: if another transaction was queued before this one,
/// execute() fails until that one runs or the owner skips it (Delay.setTxNonce, which vetoes every
/// transaction before the new nonce at once). An expired transaction ahead in the queue can be
/// cleared by anyone with Delay.skipExpired().
/// Declared risk: without a ConfigGuard (T1.5) an owner of the Safe can call
/// FundingGate.setPolicyHash directly through a Safe transaction and skip the Delay. The cooldown is
/// a convention the owner keeps, not something the contracts enforce.
contract SetTradePolicy is Script {
    function queue() external {
        (FundingGate gate, IDelay110 delay) = _load();
        queueWith(gate, delay, vm.envBytes32("POLICY_HASH"), vm.envUint("OWNER_PRIVATE_KEY"));
    }

    function execute() external {
        (FundingGate gate, IDelay110 delay) = _load();
        // Not envOr(EXECUTOR, envUint(OWNER)): the default would be read (and required) eagerly
        uint256 key =
            vm.envExists("EXECUTOR_PRIVATE_KEY") ? vm.envUint("EXECUTOR_PRIVATE_KEY") : vm.envUint("OWNER_PRIVATE_KEY");
        executeWith(gate, delay, vm.envBytes32("POLICY_HASH"), key);
    }

    function call(bytes32 policyHash) public pure returns (bytes memory) {
        return abi.encodeCall(PDRVerifier.setPolicyHash, (policyHash));
    }

    /// @notice The queue transaction for an owner who signs from their own wallet instead of
    /// OWNER_PRIVATE_KEY: send `data` to `to` from the owner address (a Delay module). Same Delay
    /// path, nothing is skipped.
    function queueCall(bytes32 policyHash) external view returns (address to, bytes memory data) {
        (FundingGate gate, IDelay110 delay) = _load();
        return
            (
                address(delay),
                abi.encodeCall(IDelay110.execTransactionFromModule, (address(gate), 0, call(policyHash), 0))
            );
    }

    /// @notice Queues setPolicyHash(policyHash) on the Delay, signed by an enabled Delay module.
    function queueWith(FundingGate gate, IDelay110 delay, bytes32 policyHash, uint256 ownerKey) public {
        require(delay.isModuleEnabled(vm.addr(ownerKey)), "the key is not a module of the Delay");
        require(policyHash != bytes32(0), "POLICY_HASH is empty");
        uint256 queued = delay.queueNonce();
        vm.startBroadcast(ownerKey);
        require(delay.execTransactionFromModule(address(gate), 0, call(policyHash), 0), "queue failed");
        vm.stopBroadcast();
        console2.log("queued at Delay nonce", queued);
        console2.log("executable after (s)", delay.txCooldown());
    }

    /// @notice Executes the queued setPolicyHash once the cooldown passed, and checks the result.
    function executeWith(FundingGate gate, IDelay110 delay, bytes32 policyHash, uint256 executorKey) public {
        bytes memory data = call(policyHash);
        uint256 next = delay.txNonce();
        require(next < delay.queueNonce(), "nothing queued in the Delay");
        require(
            delay.getTxHash(next) == delay.getTransactionHash(address(gate), 0, data, 0),
            "the next Delay transaction is not this setPolicyHash"
        );
        // Checked here, before broadcasting, with the same rules as Delay.executeNextTx
        uint256 created = delay.txCreatedAt(next);
        require(block.timestamp - created >= delay.txCooldown(), "the Delay cooldown has not passed");
        require(
            delay.txExpiration() == 0 || created + delay.txCooldown() + delay.txExpiration() >= block.timestamp,
            "the queued transaction expired"
        );
        vm.startBroadcast(executorKey);
        delay.executeNextTx(address(gate), 0, data, 0);
        vm.stopBroadcast();
        require(gate.currentPolicyHash() == policyHash, "policy hash not set");
        console2.logBytes32(policyHash);
    }

    function _load() private view returns (FundingGate gate, IDelay110 delay) {
        string memory json = vm.readFile(vm.envOr("KEEL_DEPLOYMENTS_FILE", DeploymentsFile.defaultPath(block.chainid)));
        require(vm.parseJsonUint(json, ".chainId") == block.chainid, "deployments file is for another chain");
        gate = FundingGate(vm.parseJsonAddress(json, ".fundingGate"));
        delay = IDelay110(vm.parseJsonAddress(json, ".delay"));
        require(address(gate).code.length > 0 && address(delay).code.length > 0, "gate or delay without code");
        // The Delay must act on the gate's Safe, or execute() would fail only after the cooldown
        require(
            delay.avatar() == gate.safe() && delay.target() == gate.safe(), "the Delay does not act on the gate's Safe"
        );
    }
}
