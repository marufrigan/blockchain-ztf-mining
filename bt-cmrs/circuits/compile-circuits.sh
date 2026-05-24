#!/usr/bin/env bash
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

if [[ ! -f "$PTAU_FILE" ]]; then
  echo "Missing $PTAU_FILE, generating local ptau for prototype..."
  "$SNARKJS_BIN" powersoftau new bn128 12 "$BUILD_DIR/pot12_0000.ptau" -v
  "$SNARKJS_BIN" powersoftau contribute "$BUILD_DIR/pot12_0000.ptau" "$BUILD_DIR/pot12_0001.ptau" --name="bt-cmrs" -v -e="entropy-btcmrs"
  "$SNARKJS_BIN" powersoftau prepare phase2 "$BUILD_DIR/pot12_0001.ptau" "$BUILD_DIR/pot12_final.ptau" -v
  PTAU_FILE="$BUILD_DIR/pot12_final.ptau"
fi

echo "[1/6] Compiling circuit..."
"$CIRCOM_BIN" "$ROOT_DIR/circuits/regionProof.circom" -l "$ROOT_DIR/node_modules" --r1cs --wasm --sym -o "$BUILD_DIR"

echo "[2/6] Groth16 setup..."
"$SNARKJS_BIN" groth16 setup "$BUILD_DIR/regionProof.r1cs" "$PTAU_FILE" "$BUILD_DIR/regionProof_0000.zkey"

echo "[3/6] Contributing entropy..."
"$SNARKJS_BIN" zkey contribute "$BUILD_DIR/regionProof_0000.zkey" "$BUILD_DIR/regionProof_final.zkey" --name="bt-cmrs" -v -e="bt-cmrs-entropy"

echo "[4/6] Exporting verification key..."
"$SNARKJS_BIN" zkey export verificationkey "$BUILD_DIR/regionProof_final.zkey" "$BUILD_DIR/verification_key.json"

echo "[5/6] Exporting Solidity verifier..."
"$SNARKJS_BIN" zkey export solidityverifier "$BUILD_DIR/regionProof_final.zkey" "$CONTRACTS_DIR/RegionProofVerifier.sol"
# Keep filename + contract name aligned with project conventions.
sed -i.bak 's/contract Groth16Verifier/contract RegionProofVerifier/g' "$CONTRACTS_DIR/RegionProofVerifier.sol"
rm -f "$CONTRACTS_DIR/RegionProofVerifier.sol.bak"

echo "[6/6] Exporting proving artifacts..."
cp "$BUILD_DIR/regionProof_final.zkey" "$ROOT_DIR/circuits/regionProof_final.zkey"
cp "$BUILD_DIR/verification_key.json" "$ROOT_DIR/circuits/verification_key.json"

echo "Done. Generated contracts/RegionProofVerifier.sol and proving artifacts."
