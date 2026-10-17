#!/usr/bin/env bash
# FORK TEST ONLY: runs the whole evidence script against a fresh DeployTrade deployment on a local
# anvil fork of Base Sepolia. Sends nothing to the real chain.
#   redteam/src/evidence/area1/fork/run.sh [out-dir]
# Needs .env at the repo root (BASE_SEPOLIA_RPC_URL, the DeployTrade variables and the demo keys).
# Keys and the RPC URL stay in this process's environment: nothing here prints them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
OUT="${1:-$(mktemp -d -t keel-evidence-fork-XXXXXX)}"
PORT="${ANVIL_PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"
TSX="${ROOT}/node_modules/.bin/tsx"
CLI="${ROOT}/redteam/src/evidence/area1/cli.ts"
PREP="${ROOT}/redteam/src/evidence/area1/fork/prepare.ts"
mkdir -p "${OUT}/evidence"

set -a
# shellcheck disable=SC1091
source "${ROOT}/.env"
set +a

if cast chain-id --rpc-url "${RPC}" >/dev/null 2>&1; then
  echo "something already listens on ${RPC}; set ANVIL_PORT" >&2
  exit 1
fi
anvil --fork-url "${BASE_SEPOLIA_RPC_URL}" --port "${PORT}" --block-time 2 >/dev/null 2>&1 &
ANVIL_PID=$!
FORK_DEPLOYMENTS=""
trap 'kill ${ANVIL_PID} 2>/dev/null || true; [ -n "${FORK_DEPLOYMENTS}" ] && rm -f "${ROOT}/contracts/${FORK_DEPLOYMENTS}"' EXIT
for _ in $(seq 1 60); do cast chain-id --rpc-url "${RPC}" >/dev/null 2>&1 && break; sleep 1; done
[ "$(cast chain-id --rpc-url "${RPC}")" = "84532" ] || { echo "the fork is not Base Sepolia" >&2; exit 1; }
echo "== anvil fork of Base Sepolia on ${RPC} (block $(cast block-number --rpc-url "${RPC}"))"

# DeployTrade: send, then record. Broadcast logs, the script cache and the deployments file go to
# OUT, so nothing under contracts/ (and no real deployment record) is touched.
cast rpc anvil_setBalance "${DEPLOYER_ADDRESS}" 0x8AC7230489E80000 --rpc-url "${RPC}" >/dev/null
export FOUNDRY_BROADCAST="${OUT}/broadcast" FOUNDRY_CACHE_PATH="${OUT}/cache"
# fs_permissions only lets scripts write under contracts/deployments; test-*.json is git-ignored
FORK_DEPLOYMENTS="deployments/test-evidence-fork-$$.json"
export SALT_NONCE="${SALT_NONCE:-$(od -An -N6 -tu8 /dev/urandom | tr -d ' ')}"
cd "${ROOT}/contracts"
echo "== DeployTrade (SALT_NONCE ${SALT_NONCE})"
forge script script/DeployTrade.s.sol --rpc-url "${RPC}" --broadcast --slow >"${OUT}/deploy.log" 2>&1 || { tail -30 "${OUT}/deploy.log"; exit 1; }
SAFE="$(grep -Eo 'Safe 0x[0-9a-fA-F]{40}' "${OUT}/deploy.log" | tail -1 | cut -d' ' -f2)"
RUN_JSON="$(ls "${OUT}"/broadcast/DeployTrade.s.sol/84532/run-latest.json)"
DEPLOY_BLOCK="$(jq -r '.receipts[0].blockNumber' "${RUN_JSON}")"
DEPLOY_BLOCK="$((DEPLOY_BLOCK))"
KEEL_DEPLOYMENTS_FILE="./${FORK_DEPLOYMENTS}" forge script script/DeployTrade.s.sol --rpc-url "${RPC}" \
  --sig "record(address,uint256)" "${SAFE}" "${DEPLOY_BLOCK}" >"${OUT}/record.log" 2>&1 || { tail -30 "${OUT}/record.log"; exit 1; }
KEEL_DEPLOYMENTS_FILE="${OUT}/deployments.json"
mv "${FORK_DEPLOYMENTS}" "${KEEL_DEPLOYMENTS_FILE}"
echo "   Safe ${SAFE}, deploy block ${DEPLOY_BLOCK}, deployments file ${KEEL_DEPLOYMENTS_FILE}"
cd "${ROOT}"

COMMON=(--rpc-url "${RPC}" --deployments "${KEEL_DEPLOYMENTS_FILE}" --out "${OUT}/evidence")

echo "== fork setup: gas, Safe USDC, second Safe owner"
"${TSX}" "${PREP}" base --rpc-url "${RPC}" --deployments "${KEEL_DEPLOYMENTS_FILE}"

echo "== phase 1"
"${TSX}" "${CLI}" phase1 "${COMMON[@]}"

echo "== fork setup: 3 real deposits with a throwaway policy key"
"${TSX}" "${PREP}" deposits --rpc-url "${RPC}" --deployments "${KEEL_DEPLOYMENTS_FILE}" --out "${OUT}"
A_ID="$(jq -r .A.orderId "${OUT}/deposits.json")"; A_TX="$(jq -r .A.fundTx "${OUT}/deposits.json")"
B_ID="$(jq -r .B.orderId "${OUT}/deposits.json")"
C_ID="$(jq -r .C.orderId "${OUT}/deposits.json")"; C_DEADLINE="$(jq -r .C.shipmentDeadline "${OUT}/deposits.json")"

echo "== phase 3"
"${TSX}" "${CLI}" phase3 repeat-deposit --tx "${A_TX}" "${COMMON[@]}"
"${TSX}" "${CLI}" phase3 exporter-dispute --order "${C_ID}" "${COMMON[@]}"
"${TSX}" "${CLI}" phase3 duplicate-bl --order "${A_ID}" --order-b "${B_ID}" "${COMMON[@]}"
# Fork only: jump past shipmentDeadline + refundGrace of order C instead of waiting
NOW="$(cast block latest --field timestamp --rpc-url "${RPC}")"
GRACE="$(cast call "$(jq -r .tradeEscrow "${KEEL_DEPLOYMENTS_FILE}")" "refundGrace()(uint64)" --rpc-url "${RPC}")"
JUMP=$((C_DEADLINE + GRACE + 5 - NOW))
if [ "${JUMP}" -gt 0 ]; then
  echo "   evm_increaseTime ${JUMP} s (fork only)"
  cast rpc evm_increaseTime "${JUMP}" --rpc-url "${RPC}" >/dev/null
  cast rpc evm_mine --rpc-url "${RPC}" >/dev/null
fi
"${TSX}" "${CLI}" phase3 late-attestation --order "${C_ID}" "${COMMON[@]}"

echo "== all cases"
"${TSX}" "${CLI}" summary --out "${OUT}/evidence"
echo "evidence files: ${OUT}/evidence"
