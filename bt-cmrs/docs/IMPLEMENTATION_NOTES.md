## Section 4 Notes

- Smart contracts are implemented in `contracts/` and deployed with `scripts/01_deploy.js`.
- Region-based provenance proof is implemented in `circuits/regionProof.circom`.
- Verifier contract in production is `contracts/RegionProofVerifier.sol` and should be regenerated from `snarkjs` using `circuits/compile-circuits.sh`.
- Public signal alignment for verification is:
  - `[minX, maxX, minY, maxY, regionHash, commitment]`
  - `BTCMRS.verifyAndRegisterBatch` enforces `regionHash` and `commitment` against batch state.
- Table generation:
  - Gas/latency: `scripts/08_measurePerformance.js`
  - Event/transaction/block metadata: `scripts/09_exportEventLogs.js`
- USD conversion is optional using `ETH_USD_PRICE` in `.env`.
