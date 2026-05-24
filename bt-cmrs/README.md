# BT-CMRS Prototype

Research prototype for **BT-CMRS: Blockchain-Based Trustworthy Conflict Mineral Traceability and Reacquisition System** with a region-based ZKP provenance flow.

## Stack

- Solidity (`^0.8.19`) + Hardhat
- OpenZeppelin Contracts v5
- Circom + snarkjs (Groth16, BN254)
- Node.js scripts for deployment, workflow, and metric export

## Project Layout

- `contracts/`: registry, core BT-CMRS logic, verifier interface and generated verifier contract
- `circuits/`: region proof circuit and compile script
- `scripts/`: end-to-end operational scripts (`00` to `09`)
- `test/`: unit + integration tests
- `data/`: sample stakeholders, regions, and batches
- `docs/`: generated artifacts for Section 4 tables

## Setup

1. Install dependencies:
   - `npm install`
2. Copy environment file:
   - `cp .env.example .env`
3. (Optional) Add Sepolia RPC and private key for testnet deployment.

## Local Run

1. Start local chain:
   - `npx hardhat node`
2. In a second terminal:
   - `npx hardhat compile`
   - `npx hardhat run scripts/01_deploy.js --network localhost`
   - `npx hardhat run scripts/02_registerStakeholders.js --network localhost`
   - `npx hardhat run scripts/03_createBatches.js --network localhost`
   - `npx hardhat run scripts/06_lifecycleUpdates.js --network localhost`
   - `npx hardhat run scripts/07_reacquisitionFlow.js --network localhost`
   - `npx hardhat run scripts/08_measurePerformance.js --network localhost`
   - `npx hardhat run scripts/09_exportEventLogs.js --network localhost`

## ZKP Verifier Generation (Real Snark Verifier)

1. Install `circom` binary globally (or on PATH).
2. Download `powersOfTau28_hez_final_12.ptau` to `circuits/`.
3. Run:
   - `npm run circuits:compile`

This regenerates:
- `contracts/RegionProofVerifier.sol`
- `circuits/regionProof_final.zkey`
- `circuits/verification_key.json`

## Testing

- Run all tests: `npm test`
- Coverage: `npm run coverage`

Note: tests use `contracts/mocks/MockRegionProofVerifier.sol` for deterministic unit/integration behavior. Production deployments use `RegionProofVerifier`.

## Data Exports for Paper

- Gas and latency results: `docs/GAS_ANALYSIS.md`, `docs/PERFORMANCE_RESULTS.json`
- Event/block/transaction metadata: `docs/EVENT_LOGS.md`, `docs/EVENT_LOGS.json`
- Use optional `ETH_USD_PRICE` to include USD costs.
