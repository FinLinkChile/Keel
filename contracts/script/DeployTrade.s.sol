// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {FundingGate} from "../src/FundingGate.sol";
import {IRoles} from "../src/IRoles.sol";
import {ITradeEscrow} from "../src/ITradeEscrow.sol";
import {TradeEscrow} from "../src/TradeEscrow.sol";
import {IZodiacRolesV2, TradeRolesConfig} from "./TradeRolesConfig.sol";
import {BaseSepolia, IDelay110, IModuleProxyFactory, ISafe141, ISafeProxyFactory141} from "./KeelExternal.sol";
import {DeploymentsFile} from "./DeploymentsFile.sol";

/// @title DeployTrade
/// @notice Deploys Keel Trade for one importer on Base Sepolia (T1.8): a Safe 1.4.1, its Zodiac
/// Roles 2.1.1 and Delay 1.1.0 instances, TradeEscrow and FundingGate, applies the Roles
/// configuration of TradeRolesConfig (the same source as the fork tests) and hands the Safe to
/// OWNER_ADDRESS. `record` then re-checks the deployment against the chain and only then writes the
/// shared deployments file.
///
/// Procedure (three commands; the first one sends nothing):
///   1. Simulate:  forge script script/DeployTrade.s.sol --rpc-url base_sepolia
///   2. Send:      forge script script/DeployTrade.s.sol --rpc-url base_sepolia --broadcast --slow [--verify]
///      --slow waits for each receipt before sending the next transaction, so a failed transaction
///      stops the run instead of letting the later ones (for example swapOwner) land without it.
///      --verify needs BASESCAN_API_KEY set to an Etherscan API key (Foundry uses the Etherscan V2
///      API for chain 84532); it verifies TradeEscrow and FundingGate, the proxies point at
///      already verified master copies.
///   3. Record:    forge script script/DeployTrade.s.sol --rpc-url base_sepolia --sig "record(address,uint256)" <safe> <deployBlock>
///      No broadcast: it rebuilds every address from the Safe on the real chain, runs every final
///      check against it and writes deployments/84532.json only if they all pass.
///      run() checks the same things in its local simulation before sending, but never writes the
///      file: a simulated or half-sent run must not publish addresses to the other areas.
///
/// Env (from .env, never in the repo): DEPLOYER_PRIVATE_KEY, DEPLOYER_ADDRESS (must match the key),
/// OWNER_ADDRESS, POLICY_SIGNER_ADDRESS, COSIGNER_ADDRESS, RELAYER_ADDRESS, GUARDIAN_ADDRESS (all required, all
/// distinct), REFUND_GRACE, CONFIG_DELAY, AGENT_CAP, COSIGNED_CAP, ALLOWANCE_PERIOD, and optionally
/// SECOND_OWNER_ADDRESS and THIRD_OWNER_ADDRESS (optional extra Safe owners), INITIAL_POLICY_HASH, SALT_NONCE,
/// KEEL_DEPLOYMENTS_FILE (default ./deployments/84532.json).
///
/// @dev Path "temporary owner = deployer": the Safe is created with the deployer as its only owner,
/// so the deployer can sign (v = 1, msg.sender is the owner) the Safe transactions that enable Roles
/// and Delay, configure Roles, add OWNER_ADDRESS as a Delay module, and finally swap itself for
/// OWNER_ADDRESS. After the last transaction the deployer has no right over any contract.
///
/// If a broadcast fails half way, the Safe of that run stays with the deployer as owner and is
/// abandoned: run again with another SALT_NONCE (every address depends on it). `record` refuses a
/// half-built Safe (its checks fail), so only a complete deployment reaches the deployments file.
///
/// policyHash and its circularity: the gate takes a policyHash in its constructor, but the policy
/// hash of Area 2 commits to rolesConfigHash, which commits to the gate address (TradeRolesConfig
/// assigns the roles to it). So the gate is deployed with INITIAL_POLICY_HASH (or a placeholder) and
/// the real value is set afterwards by the Safe through the Delay (SetTradePolicy.s.sol). Until then
/// every PDR signed for another hash reverts with StalePolicy.
///
/// Declared risk (demo): the Safe has OWNER_ADDRESS plus SECOND_OWNER_ADDRESS and THIRD_OWNER_ADDRESS
/// when set (the importer keys of the apps of Area 4 and Area 3, which sign orders through
/// ERC-1271), up to three owners, all test keys, with threshold 1. Any one of them alone controls
/// the Safe: it reconfigures Roles, the gate registries, the guardian and the policy hash, moves
/// the Safe's USDC directly, removes the other owners and disables the Delay; through the Safe's
/// ERC-1271 it also signs for the importer everywhere TradeEscrow checks po.importer (open,
/// approveBalance, cancel). Production uses a higher threshold. Without a ConfigGuard (T1.5) any
/// owner skips the Delay with a direct Safe transaction; OWNER_ADDRESS being the only Delay module
/// is not a mitigation. The extra owners must be keys generated on the user's device (the apps'
/// local signers), never server keys (docs/flujo/principios.md); nothing here can enforce that.
/// The JSON lists owners as [OWNER_ADDRESS, SECOND_OWNER_ADDRESS, THIRD_OWNER_ADDRESS] (those set);
/// Safe.getOwners() returns them in another order (addOwnerWithThreshold inserts at the head).
contract DeployTrade is Script {
    bytes32 public constant AGENT = keccak256("AGENT");
    bytes32 public constant AGENT_COSIGNED = keccak256("AGENT_COSIGNED");
    bytes32 public constant AGENT_KEY = keccak256("keel.trade.allowance.agent");
    bytes32 public constant COSIGNED_KEY = keccak256("keel.trade.allowance.cosigned");
    uint256 public constant DELAY_COOLDOWN = 180;
    uint256 public constant DELAY_EXPIRATION = 1 days;

    struct Config {
        uint256 deployerKey;
        address owner;
        address policySigner;
        address cosigner;
        address relayer;
        uint64 refundGrace;
        uint64 configDelay;
        uint128 agentCap;
        uint128 cosignedCap;
        uint64 period;
        bytes32 initialPolicyHash;
        uint256 saltNonce;
        /// @dev Pause-only key of the gate (FundingGate.setGuardian), set before the owner handover.
        address guardian;
        /// @dev Optional extra Safe owners (the importer keys of the apps of Area 4 and Area 3);
        /// address(0) for none. Each one is optional on its own.
        address secondOwner;
        address thirdOwner;
    }

    struct Deployed {
        address deployer;
        ISafe141 safe;
        IZodiacRolesV2 roles;
        IDelay110 delay;
        TradeEscrow escrow;
        FundingGate gate;
        uint256 deployBlock;
        TradeRolesConfig.Params params;
    }

    // ================================================================== entry point

    /// @notice Deploys and checks in the local simulation. Never writes the deployments file.
    function run() external returns (Deployed memory d) {
        d = deploy(configFromEnv());
    }

    /// @notice After the send: rebuilds the deployment from `safe` on the real chain, runs every
    /// final check against it and only then writes the deployments file. Sends nothing.
    /// @param deployBlock The block of the first deployment transaction (from the broadcast output).
    function record(address safe, uint256 deployBlock) external returns (Deployed memory d) {
        d = recordTo(
            _settingsFromEnv(),
            safe,
            vm.envAddress("DEPLOYER_ADDRESS"),
            deployBlock,
            vm.envOr("KEEL_DEPLOYMENTS_FILE", DeploymentsFile.defaultPath(block.chainid))
        );
    }

    /// @notice `record` without the environment: checks first, writes `path` only if every check passed.
    function recordTo(Config memory c, address safe, address deployer, uint256 deployBlock, string memory path)
        public
        returns (Deployed memory d)
    {
        d = deployedAt(safe, deployer, deployBlock, c);
        checkDeployment(c, d);
        writeDeployment(path, c, d);
    }

    /// @notice The deployment as the chain holds it, found from the Safe: its two modules (the one
    /// with a cooldown is the Delay), the only module of Roles (the gate), and the gate's escrow.
    /// Whether it is the expected deployment is up to checkDeployment.
    function deployedAt(address safe, address deployer, uint256 deployBlock, Config memory c)
        public
        view
        returns (Deployed memory d)
    {
        require(block.chainid == BaseSepolia.CHAIN_ID, "DeployTrade only targets Base Sepolia (84532)");
        require(safe.code.length > 0, "no Safe at that address");
        require(deployBlock > 0 && deployBlock <= block.number, "deployBlock out of range");
        d.deployer = deployer;
        d.safe = ISafe141(safe);
        d.deployBlock = deployBlock;
        address[] memory mods = _modules(safe);
        require(mods.length == 2, "Safe modules must be exactly Roles and Delay");
        (bool isDelay,) = mods[0].staticcall(abi.encodeCall(IDelay110.txCooldown, ()));
        (address delayAddr, address rolesAddr) = isDelay ? (mods[0], mods[1]) : (mods[1], mods[0]);
        d.delay = IDelay110(delayAddr);
        d.roles = IZodiacRolesV2(rolesAddr);
        address[] memory gates = _modules(rolesAddr);
        require(gates.length == 1, "Roles modules must be exactly the gate");
        d.gate = FundingGate(gates[0]);
        d.escrow = d.gate.escrow();
        d.params = paramsFor(c, d);
    }

    function configFromEnv() public view returns (Config memory c) {
        c = _settingsFromEnv();
        c.deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(
            vm.addr(c.deployerKey) == vm.envAddress("DEPLOYER_ADDRESS"),
            "DEPLOYER_ADDRESS does not match DEPLOYER_PRIVATE_KEY"
        );
    }

    /// @dev Everything but the deployer key (record does not need it). Integers are checked before
    /// narrowing: a value that does not fit fails instead of wrapping around.
    function _settingsFromEnv() private view returns (Config memory c) {
        address declared = vm.envAddress("DEPLOYER_ADDRESS");
        c.owner = vm.envAddress("OWNER_ADDRESS");
        c.policySigner = vm.envAddress("POLICY_SIGNER_ADDRESS");
        c.cosigner = vm.envAddress("COSIGNER_ADDRESS");
        c.relayer = vm.envAddress("RELAYER_ADDRESS");
        c.refundGrace = _u64(vm.envUint("REFUND_GRACE"), "REFUND_GRACE");
        c.configDelay = _u64(vm.envUint("CONFIG_DELAY"), "CONFIG_DELAY");
        c.agentCap = _u128(vm.envUint("AGENT_CAP"), "AGENT_CAP");
        c.cosignedCap = _u128(vm.envUint("COSIGNED_CAP"), "COSIGNED_CAP");
        c.period = _u64(vm.envUint("ALLOWANCE_PERIOD"), "ALLOWANCE_PERIOD");
        c.initialPolicyHash = vm.envOr("INITIAL_POLICY_HASH", keccak256("keel-trade/initial-policy-placeholder"));
        c.saltNonce = vm.envOr("SALT_NONCE", uint256(keccak256(abi.encode(declared, "keel-trade"))));
        c.guardian = vm.envAddress("GUARDIAN_ADDRESS");
        c.secondOwner = vm.envOr("SECOND_OWNER_ADDRESS", address(0));
        c.thirdOwner = vm.envOr("THIRD_OWNER_ADDRESS", address(0));
    }

    function _u64(uint256 v, string memory name) private pure returns (uint64) {
        require(v <= type(uint64).max, string.concat(name, " does not fit in uint64"));
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(v); // checked on the line above
    }

    function _u128(uint256 v, string memory name) private pure returns (uint128) {
        require(v <= type(uint128).max, string.concat(name, " does not fit in uint128"));
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(v); // checked on the line above
    }

    // ================================================================== deployment

    /// @notice The whole deployment for config `c`. Public so the fork test runs exactly this code.
    function deploy(Config memory c) public returns (Deployed memory d) {
        require(block.chainid == BaseSepolia.CHAIN_ID, "DeployTrade only targets Base Sepolia (84532)");
        d.deployer = vm.addr(c.deployerKey);
        _validate(c, d.deployer);
        _requireCode();

        vm.startBroadcast(c.deployerKey);
        d.deployBlock = block.number;

        // 1. Safe 1.4.1, deployer as the only owner for now, with the ERC-1271 compatibility handler
        address[] memory owners = new address[](1);
        owners[0] = d.deployer;
        bytes memory init = abi.encodeCall(
            ISafe141.setup,
            (owners, 1, address(0), "", BaseSepolia.FALLBACK_HANDLER, address(0), 0, payable(address(0)))
        );
        d.safe = ISafe141(
            ISafeProxyFactory141(BaseSepolia.SAFE_FACTORY).createProxyWithNonce(BaseSepolia.SAFE_L2, init, c.saltNonce)
        );
        // Clear message instead of a GS013 from setGuardian or addOwnerWithThreshold later on
        require(
            c.guardian != address(d.safe) && c.secondOwner != address(d.safe) && c.thirdOwner != address(d.safe),
            "the guardian and the extra owners cannot be the Safe"
        );

        // 2. Roles and Delay from their master copies: owner = avatar = target = Safe
        address s = address(d.safe);
        d.roles = IZodiacRolesV2(
            IModuleProxyFactory(BaseSepolia.MODULE_FACTORY)
                .deployModule(
                    BaseSepolia.ROLES_MASTER, abi.encodeCall(IZodiacRolesV2.setUp, (abi.encode(s, s, s))), c.saltNonce
                )
        );
        d.delay = IDelay110(
            IModuleProxyFactory(BaseSepolia.MODULE_FACTORY)
                .deployModule(
                    BaseSepolia.DELAY_MASTER,
                    abi.encodeCall(IDelay110.setUp, (abi.encode(s, s, s, DELAY_COOLDOWN, DELAY_EXPIRATION))),
                    c.saltNonce
                )
        );

        // 3. Keel Trade contracts
        d.escrow = new TradeEscrow(IERC20(BaseSepolia.USDC), c.refundGrace);
        d.gate = new FundingGate(
            s,
            IRoles(address(d.roles)),
            d.escrow,
            AGENT,
            AGENT_COSIGNED,
            c.policySigner,
            c.cosigner,
            c.initialPolicyHash,
            c.configDelay
        );

        // 4. Safe transactions signed by the temporary owner
        _exec(d.safe, d.deployer, s, abi.encodeCall(ISafe141.enableModule, (address(d.roles))));
        _exec(d.safe, d.deployer, s, abi.encodeCall(ISafe141.enableModule, (address(d.delay))));
        d.params = paramsFor(c, d);
        TradeRolesConfig.Call[] memory cfg = TradeRolesConfig.calls(d.params);
        for (uint256 i; i < cfg.length; i++) {
            _exec(d.safe, d.deployer, address(d.roles), cfg[i].data);
        }
        _exec(d.safe, d.deployer, address(d.delay), abi.encodeCall(IDelay110.enableModule, (c.owner)));
        _exec(d.safe, d.deployer, address(d.gate), abi.encodeCall(FundingGate.setGuardian, (c.guardian)));
        // Extra owners are added while the deployer can still sign. addOwnerWithThreshold inserts at
        // the head of the Safe's owner list, so the first one added stays right before the deployer:
        // it is the previous entry swapOwner needs (SENTINEL when there is none).
        address[] memory extra = extraOwnersOf(c);
        address prevOfDeployer = extra.length == 0 ? BaseSepolia.SENTINEL : extra[0];
        for (uint256 i; i < extra.length; i++) {
            _exec(d.safe, d.deployer, s, abi.encodeCall(ISafe141.addOwnerWithThreshold, (extra[i], 1)));
        }
        // Last: hand the Safe to its real owner; the deployer keeps no right
        _exec(d.safe, d.deployer, s, abi.encodeCall(ISafe141.swapOwner, (prevOfDeployer, d.deployer, c.owner)));
        vm.stopBroadcast();

        checkDeployment(c, d);
        console2.log("Safe", s);
        console2.log("Roles", address(d.roles));
        console2.log("Delay", address(d.delay));
        console2.log("TradeEscrow", address(d.escrow));
        console2.log("FundingGate", address(d.gate));
        console2.logBytes32(TradeRolesConfig.configHash(d.params));
    }

    function paramsFor(Config memory c, Deployed memory d) public pure returns (TradeRolesConfig.Params memory) {
        return TradeRolesConfig.Params({
            token: BaseSepolia.USDC,
            escrow: address(d.escrow),
            gate: address(d.gate),
            agentRole: AGENT,
            cosignedRole: AGENT_COSIGNED,
            agentAllowanceKey: AGENT_KEY,
            cosignedAllowanceKey: COSIGNED_KEY,
            agentCap: c.agentCap,
            cosignedCap: c.cosignedCap,
            period: c.period
        });
    }

    /// @dev One-owner Safe transaction with the pre-validated signature of safe-smart-account v1.4.1
    /// (Safe.checkNSignatures, v = 1: r is the owner and msg.sender is that owner). With safeTxGas =
    /// gasPrice = 0 a failing inner call reverts the whole Safe transaction (GS013).
    function _exec(ISafe141 safe, address owner, address to, bytes memory data) private {
        bytes memory sig = abi.encodePacked(bytes32(uint256(uint160(owner))), bytes32(0), uint8(1));
        require(safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), sig), "Safe tx failed");
    }

    // ================================================================== checks

    function _validate(Config memory c, address deployer) private pure {
        // Every role is a different address; the extra owners are optional (zero means none)
        address[8] memory a =
            [deployer, c.owner, c.secondOwner, c.thirdOwner, c.policySigner, c.cosigner, c.relayer, c.guardian];
        string[8] memory n =
            ["deployer", "owner", "second owner", "third owner", "policy signer", "cosigner", "relayer", "guardian"];
        for (uint256 i; i < 8; i++) {
            bool optional = i == 2 || i == 3;
            if (optional && a[i] == address(0)) continue;
            require(a[i] != address(0), string.concat(n[i], " address is zero"));
            for (uint256 j = i + 1; j < 8; j++) {
                if ((j == 2 || j == 3) && a[j] == address(0)) continue;
                require(a[i] != a[j], string.concat(n[i], " and ", n[j], " must be different addresses"));
            }
        }
        // Sanity bounds of the demo and of production (contracts/CLAUDE.md, docs)
        require(c.refundGrace > 0 && c.refundGrace <= 30 days, "REFUND_GRACE must be in (0, 30 days]");
        require(c.configDelay >= 60 && c.configDelay <= 30 days, "CONFIG_DELAY must be in [60 s, 30 days]");
        require(c.agentCap > 0 && c.cosignedCap > c.agentCap, "need 0 < AGENT_CAP < COSIGNED_CAP");
        require(c.period >= 1 hours && c.period <= 366 days, "ALLOWANCE_PERIOD must be in [1 hour, 366 days]");
    }

    function _requireCode() private view {
        address[7] memory a = [
            BaseSepolia.USDC,
            BaseSepolia.SAFE_FACTORY,
            BaseSepolia.SAFE_L2,
            BaseSepolia.MODULE_FACTORY,
            BaseSepolia.ROLES_MASTER,
            BaseSepolia.DELAY_MASTER,
            BaseSepolia.FALLBACK_HANDLER
        ];
        for (uint256 i; i < a.length; i++) {
            require(a[i].code.length > 0, string.concat("no code at ", vm.toString(a[i])));
        }
    }

    /// @notice Final on-chain checks; any failure reverts the script. The membership probes are
    /// pranked calls made after vm.stopBroadcast(): they only run in the local simulation and are
    /// never sent.
    function checkDeployment(Config memory c, Deployed memory d) public {
        address s = address(d.safe);
        // The same distinctness and bounds as deploy(): record() gets its config from the env, and
        // a repeated address there (for example SECOND_OWNER_ADDRESS = OWNER_ADDRESS) would let the
        // owner check pass while hiding a real owner from the deployments file.
        _validate(c, d.deployer);
        require(
            c.guardian != s && c.secondOwner != s && c.thirdOwner != s,
            "the guardian and the extra owners cannot be the Safe"
        );

        // Roles and Delay are owned by, and act on, the Safe
        require(d.roles.owner() == s && d.roles.avatar() == s && d.roles.target() == s, "Roles owner/avatar/target");
        require(d.delay.owner() == s && d.delay.avatar() == s && d.delay.target() == s, "Delay owner/avatar/target");
        require(d.delay.txCooldown() == DELAY_COOLDOWN && d.delay.txExpiration() == DELAY_EXPIRATION, "Delay timing");
        _requireModules(_modules(address(d.delay)), c.owner, address(0), "Delay modules must be exactly OWNER_ADDRESS");
        _requireModules(
            _modules(address(d.roles)), address(d.gate), address(0), "Roles modules must be exactly the gate"
        );

        // The Safe: exactly Roles and Delay as modules, owner and threshold, no guard, the handler
        _requireModules(_modules(s), address(d.roles), address(d.delay), "Safe modules must be exactly Roles and Delay");
        // Exact set: same size and every configured owner is one (they are distinct, see _validate)
        address[] memory expectedOwners = ownersOf(c);
        require(d.safe.getOwners().length == expectedOwners.length, "Safe owners must be exactly the configured owners");
        for (uint256 i; i < expectedOwners.length; i++) {
            require(d.safe.isOwner(expectedOwners[i]), "Safe owners must be exactly the configured owners");
        }
        require(d.safe.getThreshold() == 1, "Safe threshold must be 1");
        require(!d.safe.isOwner(d.deployer), "deployer is still an owner");
        require(_slot(d.safe, BaseSepolia.GUARD_SLOT) == address(0), "Safe has a guard");
        require(_slot(d.safe, BaseSepolia.FALLBACK_HANDLER_SLOT) == BaseSepolia.FALLBACK_HANDLER, "fallback handler");

        // Allowances: refill == maxRefill == cap, full balance, the period asked for
        _requireAllowance(d.roles, AGENT_KEY, c.agentCap, c.period);
        _requireAllowance(d.roles, COSIGNED_KEY, c.cosignedCap, c.period);

        // The gate
        require(d.gate.policySigner() != d.gate.cosigner(), "policy signer equals cosigner");
        require(d.gate.policySigner() == c.policySigner && d.gate.cosigner() == c.cosigner, "gate signers");
        require(d.gate.safe() == s && address(d.gate.roles()) == address(d.roles), "gate safe/roles");
        require(
            address(d.gate.escrow()) == address(d.escrow) && address(d.gate.token()) == BaseSepolia.USDC,
            "gate escrow/token"
        );
        require(d.gate.configDelay() == c.configDelay, "gate configDelay");
        // The guardian: the configured one, and a key that holds no other role here
        address g = d.gate.guardian();
        require(g == c.guardian, "gate guardian is not GUARDIAN_ADDRESS");
        require(
            g != s && g != c.policySigner && g != c.cosigner && g != c.relayer && g != d.deployer,
            "guardian must differ from the Safe, the signers, the relayer and the deployer"
        );
        require(d.gate.agentRoleKey() == AGENT && d.gate.cosignedRoleKey() == AGENT_COSIGNED, "gate role keys");
        require(!d.gate.paused(), "gate paused");
        // Fresh deployment: nothing happened after the script (record runs right after the send)
        require(d.gate.currentPolicyHash() == c.initialPolicyHash, "gate policy hash is not the initial one");
        require(d.gate.changeCount() == 0, "gate registries already used");
        require(d.delay.queueNonce() == 0 && d.delay.txNonce() == 0, "Delay queue not empty");
        // 2 enableModule + 11 Roles calls + Delay enableModule + setGuardian + swapOwner + one
        // addOwnerWithThreshold per extra owner
        require(d.safe.nonce() == 16 + extraOwnersOf(c).length, "Safe nonce: unexpected Safe transactions");
        // Roles 2.1.1 and Delay 1.1.0 sit on the zodiac 3.4.1 Module, which is only FactoryFriendly
        // (no Guardable): they have no guard to check, unlike the Safe.
        require(address(d.escrow.token()) == BaseSepolia.USDC && d.escrow.refundGrace() == c.refundGrace, "escrow");

        // Membership, by simulation (Roles v2 cannot list members). A harmless call, fund of an order
        // that does not exist with shouldRevert = false: a member passes authorization and gets false
        // back; anyone else reverts with NotAuthorized or NoMembership.
        bytes memory probe = abi.encodeCall(ITradeEscrow.fund, (bytes32(0)));
        bytes memory otherSpender = abi.encodeCall(IERC20.approve, (c.relayer, 1));
        bytes32[2] memory keys = [AGENT, AGENT_COSIGNED];
        address[4] memory outsiders = [c.relayer, c.cosigner, d.deployer, c.guardian];
        for (uint256 k; k < 2; k++) {
            vm.prank(address(d.gate));
            bool ok = d.roles.execTransactionWithRole(address(d.escrow), 0, probe, 0, keys[k], false);
            require(!ok, "probe: fund of an unknown order should fail inside the Safe");
            // The approve scope: any spender other than the escrow is rejected (ParameterNotAllowed)
            vm.prank(address(d.gate));
            try d.roles.execTransactionWithRole(BaseSepolia.USDC, 0, otherSpender, 0, keys[k], false) {
                revert("a Trade role can approve a spender other than the escrow");
            } catch (bytes memory reason) {
                require(
                    keccak256(reason)
                        == keccak256(
                            abi.encodeWithSelector(IZodiacRolesV2.ConditionViolation.selector, uint8(7), bytes32(0))
                        ),
                    "approve probe reverted for another reason"
                );
            }
            for (uint256 o; o < 4; o++) {
                vm.prank(outsiders[o]);
                try d.roles.execTransactionWithRole(address(d.escrow), 0, probe, 0, keys[k], false) {
                    revert("an outsider is a member of a Trade role");
                } catch (bytes memory reason) {
                    bytes4 sel = bytes4(reason);
                    require(
                        sel == IZodiacRolesV2.NotAuthorized.selector || sel == IZodiacRolesV2.NoMembership.selector,
                        "outsider probe reverted for another reason"
                    );
                }
            }
        }
    }

    /// @notice The extra owners that are set, in order: SECOND_OWNER_ADDRESS, THIRD_OWNER_ADDRESS.
    function extraOwnersOf(Config memory c) public pure returns (address[] memory list) {
        uint256 n = (c.secondOwner == address(0) ? 0 : 1) + (c.thirdOwner == address(0) ? 0 : 1);
        list = new address[](n);
        uint256 i;
        if (c.secondOwner != address(0)) list[i++] = c.secondOwner;
        if (c.thirdOwner != address(0)) list[i++] = c.thirdOwner;
    }

    /// @notice The Safe owners the deployment ends with: OWNER_ADDRESS, then each extra owner set.
    function ownersOf(Config memory c) public pure returns (address[] memory list) {
        address[] memory extra = extraOwnersOf(c);
        list = new address[](1 + extra.length);
        list[0] = c.owner;
        for (uint256 i; i < extra.length; i++) {
            list[i + 1] = extra[i];
        }
    }

    function _modules(address modifierOrSafe) private view returns (address[] memory list) {
        (list,) = ISafe141(modifierOrSafe).getModulesPaginated(BaseSepolia.SENTINEL, 10);
    }

    function _requireModules(address[] memory list, address a, address b, string memory why) private pure {
        uint256 expected = b == address(0) ? 1 : 2;
        require(list.length == expected, why);
        for (uint256 i; i < list.length; i++) {
            require(list[i] == a || list[i] == b, why);
        }
        if (expected == 2) require(list[0] != list[1], why);
    }

    function _requireAllowance(IZodiacRolesV2 roles, bytes32 key, uint128 cap, uint64 period) private view {
        (uint128 refill, uint128 maxRefill, uint64 p, uint128 balance,) = roles.allowances(key);
        require(refill == maxRefill, "allowance maxRefill != refill");
        require(refill == cap && balance == cap && p == period, "allowance values");
    }

    function _slot(ISafe141 safe, bytes32 slot) private view returns (address) {
        return abi.decode(safe.getStorageAt(uint256(slot), 1), (address));
    }

    // ================================================================== deployments file

    /// @notice Writes this deployment into `path`, keeping every key another script owns (the
    /// Personal gate under `pdrGate` and `personal`). `pdrGate` is written as null only if absent.
    function writeDeployment(string memory path, Config memory c, Deployed memory d) public {
        string memory root = "trade-root";
        string memory existing = DeploymentsFile.load(vm, root, path, block.chainid, BaseSepolia.USDC);

        TradeRolesConfig.Call[] memory cfg = TradeRolesConfig.calls(d.params);
        bytes[] memory calls = new bytes[](cfg.length);
        for (uint256 i; i < cfg.length; i++) {
            calls[i] = cfg[i].data;
        }

        string memory t = "trade-extra";
        vm.serializeAddress(t, "owner", c.owner);
        vm.serializeAddress(t, "relayer", c.relayer);
        vm.serializeBytes32(t, "agentRoleKey", AGENT);
        vm.serializeBytes32(t, "cosignedRoleKey", AGENT_COSIGNED);
        vm.serializeBytes32(t, "agentAllowanceKey", AGENT_KEY);
        vm.serializeBytes32(t, "cosignedAllowanceKey", COSIGNED_KEY);
        vm.serializeUint(t, "agentCap", c.agentCap);
        vm.serializeUint(t, "cosignedCap", c.cosignedCap);
        vm.serializeUint(t, "allowancePeriod", c.period);
        vm.serializeUint(t, "delayCooldown", DELAY_COOLDOWN);
        vm.serializeUint(t, "delayExpiration", DELAY_EXPIRATION);
        vm.serializeBytes32(t, "initialPolicyHash", c.initialPolicyHash);
        vm.serializeUint(t, "saltNonce", c.saltNonce);
        vm.serializeAddress(t, "rolesMaster", BaseSepolia.ROLES_MASTER);
        vm.serializeAddress(t, "delayMaster", BaseSepolia.DELAY_MASTER);
        vm.serializeAddress(t, "moduleFactory", BaseSepolia.MODULE_FACTORY);
        vm.serializeAddress(t, "safeFactory", BaseSepolia.SAFE_FACTORY);
        vm.serializeAddress(t, "safeSingleton", BaseSepolia.SAFE_L2);
        string memory extra = vm.serializeAddress(t, "fallbackHandler", BaseSepolia.FALLBACK_HANDLER);

        bool noPdrGate = !vm.keyExistsJson(existing, ".pdrGate");
        // Placeholder, replaced below by a JSON null (serializeString would leave the text "null")
        if (noPdrGate) vm.serializeString(root, "pdrGate", "null");
        vm.serializeUint(root, "deployBlock", d.deployBlock);
        vm.serializeAddress(root, "safe", address(d.safe));
        vm.serializeAddress(root, "roles", address(d.roles));
        vm.serializeAddress(root, "delay", address(d.delay));
        vm.serializeAddress(root, "tradeEscrow", address(d.escrow));
        vm.serializeAddress(root, "fundingGate", address(d.gate));
        vm.serializeAddress(root, "policySigner", c.policySigner);
        vm.serializeAddress(root, "cosigner", c.cosigner);
        vm.serializeAddress(root, "guardian", c.guardian);
        vm.serializeAddress(root, "owners", ownersOf(c));
        vm.serializeUint(root, "refundGrace", c.refundGrace);
        vm.serializeUint(root, "configDelay", c.configDelay);
        vm.serializeBytes32(root, "rolesConfigHash", TradeRolesConfig.configHash(d.params));
        vm.serializeBytes(root, "rolesConfigCalls", calls);
        string memory json = vm.serializeString(root, "trade", extra);
        vm.writeJson(json, path);
        if (noPdrGate) vm.writeJson("null", path, ".pdrGate");
    }
}
