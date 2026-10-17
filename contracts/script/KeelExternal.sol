// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Third-party contracts Keel Trade deploys against on Base Sepolia (chainId 84532), with the source
// of each address and interface. Shared by the deployment scripts and the fork tests.

/// @notice Addresses on Base Sepolia. Each one is checked for code before use.
library BaseSepolia {
    uint256 internal constant CHAIN_ID = 84532;
    // contracts/CLAUDE.md, section 14 (cast code on Base Sepolia)
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address internal constant SAFE_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67; // SafeProxyFactory 1.4.1
    address internal constant SAFE_L2 = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762; // SafeL2 1.4.1 singleton
    address internal constant MODULE_FACTORY = 0x000000000000aDdB49795b0f9bA5BC298cDda236; // zodiac ModuleProxyFactory
    // Roles 2.1.1: gnosisguild/zodiac-modifier-roles branch v2, commit 218a5164,
    // packages/evm/mastercopies.json ("Roles/2.1.1/address"); on-chain runtime matches that artifact.
    address internal constant ROLES_MASTER = 0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5;
    // Delay 1.1.0: gnosisguild/zodiac-modifier-delay, mastercopies.json at commit f02c09a
    // ("Delay/1.1.0/address"); the on-chain runtime at Base Sepolia block 48173000 is a byte-exact
    // substring of that artifact's init code (and of neither 1.0.0 nor 1.0.1). Source: tag v1.1.0
    // (commit 515737f6), contracts/Delay.sol; the functions Keel calls are unchanged at HEAD.
    address internal constant DELAY_MASTER = 0x01F8cabB808D7dE0dF4202D4B60C8310d2f1339b;
    // Safe 1.4.1 CompatibilityFallbackHandler: safe-global/safe-deployments commit 382117f5,
    // src/assets/v1.4.1/compatibility_fallback_handler.json (84532: canonical). Gives the Safe
    // ERC-1271 (it signs purchase orders as the importer).
    address internal constant FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;

    // safe-smart-account v1.4.1: contracts/base/OwnerManager.sol and ModuleManager.sol (SENTINEL),
    // contracts/base/FallbackManager.sol and GuardManager.sol (storage slots)
    address internal constant SENTINEL = address(0x1);
    bytes32 internal constant FALLBACK_HANDLER_SLOT =
        0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5;
    bytes32 internal constant GUARD_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;
    // contracts/handler/CompatibilityFallbackHandler.sol
    bytes32 internal constant SAFE_MSG_TYPEHASH = 0x60b3cbf8b4a223d68d641b3b6ddf9a298e7f33710cf3d3a9d1146b5a6150fbca;
}

/// @dev Safe 1.4.1, safe-global/safe-smart-account tag v1.4.1 (commit bf943f80): contracts/Safe.sol,
/// contracts/base/ModuleManager.sol, contracts/base/OwnerManager.sol.
interface ISafe141 {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);
    function enableModule(address module) external;
    function isModuleEnabled(address module) external view returns (bool);
    function getModulesPaginated(address start, uint256 pageSize)
        external
        view
        returns (address[] memory array, address next);
    function swapOwner(address prevOwner, address oldOwner, address newOwner) external;
    function addOwnerWithThreshold(address owner, uint256 threshold) external;
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function isOwner(address owner) external view returns (bool);
    function nonce() external view returns (uint256);
    function domainSeparator() external view returns (bytes32);
    function getStorageAt(uint256 offset, uint256 length) external view returns (bytes memory);
}

/// @dev contracts/proxies/SafeProxyFactory.sol at v1.4.1.
interface ISafeProxyFactory141 {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

/// @dev gnosisguild/zodiac v3.4.1, contracts/factory/ModuleProxyFactory.sol.
interface IModuleProxyFactory {
    function deployModule(address masterCopy, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

/// @dev Delay 1.1.0, gnosisguild/zodiac-modifier-delay tag v1.1.0 (commit 515737f6) contracts/Delay.sol, on
/// the zodiac Modifier (owner, avatar, target, module list). execTransactionFromModule queues
/// (moduleOnly); executeNextTx runs the next queued transaction after txCooldown and before
/// txCooldown + txExpiration (anyone); setTxNonce (onlyOwner) skips every transaction before it.
interface IDelay110 {
    function setUp(bytes memory initParams) external;
    function owner() external view returns (address);
    function avatar() external view returns (address);
    function target() external view returns (address);
    function txCooldown() external view returns (uint256);
    function txExpiration() external view returns (uint256);
    function txNonce() external view returns (uint256);
    function queueNonce() external view returns (uint256);
    function getTxHash(uint256 nonce) external view returns (bytes32);
    function txCreatedAt(uint256 nonce) external view returns (uint256);
    function getTransactionHash(address to, uint256 value, bytes memory data, uint8 operation)
        external
        pure
        returns (bytes32);
    function enableModule(address module) external;
    function isModuleEnabled(address module) external view returns (bool);
    function getModulesPaginated(address start, uint256 pageSize)
        external
        view
        returns (address[] memory array, address next);
    function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        returns (bool success);
    function executeNextTx(address to, uint256 value, bytes calldata data, uint8 operation) external;
    function setTxNonce(uint256 _txNonce) external;
}

/// @dev Circle FiatToken admin functions (USDC proxy on Base Sepolia, version() = "2").
interface IFiatTokenAdmin {
    function blacklister() external view returns (address);
    function blacklist(address account) external;
    function isBlacklisted(address account) external view returns (bool);
    function pauser() external view returns (address);
    function pause() external;
}
