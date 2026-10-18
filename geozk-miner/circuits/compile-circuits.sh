#!/usr/bin/env bash
# Compiles the GeoZK-Miner region circuit and runs a Groth16 setup.
#
# Phase 1 uses powersOfTau28_hez_final_12.ptau from the public Hermez ceremony if it
# is present in circuits/. Otherwise a local Powers of Tau is generated with two
# random contributions and a beacon. A locally generated ptau is suitable for a
# research prototype only; production deployments must use a public multi-party
# ceremony for both phases.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/circuits/build/regionProof"
PTAU_FILE="$ROOT_DIR/circuits/powersOfTau28_hez_final_12.ptau"
CONTRACTS_DIR="$ROOT_DIR/contracts"
SNARKJS_BIN="$ROOT_DIR/node_modules/.bin/snarkjs"
if [[ ! -x "$SNARKJS_BIN" ]]; then
  echo "snarkjs binary not found at $SNARKJS_BIN"
  exit 1
fi

mkdir -p "$BUILD_DIR"

if command -v circom >/dev/null 2>&1; then
  CIRCOM_BIN="circom"
elif [[ -x "$ROOT_DIR/node_modules/.bin/circom2" ]]; then
  CIRCOM_BIN="$ROOT_DIR/node_modules/.bin/circom2"
else
  echo "circom not found. Install globally or add dev dependency circom2."
  exit 1
fi

rand() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

if [[ ! -f "$PTAU_FILE" ]]; then
  echo "Hermez ptau not found; generating a local Powers of Tau (prototype only)..."
  PTAU_DIR="$BUILD_DIR/ptau"
  mkdir -p "$PTAU_DIR"
  "$SNARKJS_BIN" powersoftau new bn128 12 "$PTAU_DIR/pot12_0000.ptau"
  "$SNARKJS_BIN" powersoftau contribute "$PTAU_DIR/pot12_0000.ptau" "$PTAU_DIR/pot12_0001.ptau" --name="contribution-1" -e="$(rand)"
  "$SNARKJS_BIN" powersoftau contribute "$PTAU_DIR/pot12_0001.ptau" "$PTAU_DIR/pot12_0002.ptau" --name="contribution-2" -e="$(rand)"
  "$SNARKJS_BIN" powersoftau beacon "$PTAU_DIR/pot12_0002.ptau" "$PTAU_DIR/pot12_beacon.ptau" "$(rand)" 10 -n="final-beacon"
  "$SNARKJS_BIN" powersoftau prepare phase2 "$PTAU_DIR/pot12_beacon.ptau" "$PTAU_DIR/pot12_final.ptau"
  "$SNARKJS_BIN" powersoftau verify "$PTAU_DIR/pot12_final.ptau"
  PTAU_FILE="$PTAU_DIR/pot12_final.ptau"
fi

echo "[1/6] Compiling circuit..."
"$CIRCOM_BIN" "$ROOT_DIR/circuits/regionProof.circom" -l "$ROOT_DIR/node_modules" --r1cs --wasm --sym -o "$BUILD_DIR"
"$SNARKJS_BIN" r1cs info "$BUILD_DIR/regionProof.r1cs"

echo "[2/6] Groth16 setup (phase 2)..."
"$SNARKJS_BIN" groth16 setup "$BUILD_DIR/regionProof.r1cs" "$PTAU_FILE" "$BUILD_DIR/regionProof_0000.zkey"

echo "[3/6] Contributing entropy and applying beacon..."
"$SNARKJS_BIN" zkey contribute "$BUILD_DIR/regionProof_0000.zkey" "$BUILD_DIR/regionProof_0001.zkey" --name="phase2-contribution-1" -e="$(rand)"
"$SNARKJS_BIN" zkey beacon "$BUILD_DIR/regionProof_0001.zkey" "$BUILD_DIR/regionProof_final.zkey" "$(rand)" 10 -n="phase2-beacon"
"$SNARKJS_BIN" zkey verify "$BUILD_DIR/regionProof.r1cs" "$PTAU_FILE" "$BUILD_DIR/regionProof_final.zkey"

echo "[4/6] Exporting verification key..."
"$SNARKJS_BIN" zkey export verificationkey "$BUILD_DIR/regionProof_final.zkey" "$BUILD_DIR/verification_key.json"

echo "[5/6] Exporting Solidity verifier..."
"$SNARKJS_BIN" zkey export solidityverifier "$BUILD_DIR/regionProof_final.zkey" "$CONTRACTS_DIR/RegionProofVerifier.sol"
sed -i.bak 's/contract Groth16Verifier/contract RegionProofVerifier/g' "$CONTRACTS_DIR/RegionProofVerifier.sol"
rm -f "$CONTRACTS_DIR/RegionProofVerifier.sol.bak"

echo "[6/6] Exporting proving artifacts..."
cp "$BUILD_DIR/regionProof_final.zkey" "$ROOT_DIR/circuits/regionProof_final.zkey"
cp "$BUILD_DIR/verification_key.json" "$ROOT_DIR/circuits/verification_key.json"

echo "Done. Generated contracts/RegionProofVerifier.sol and proving artifacts."
