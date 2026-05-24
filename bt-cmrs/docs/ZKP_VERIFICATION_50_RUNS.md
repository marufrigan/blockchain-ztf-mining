# GeoZK-Miner — Extended ZKP Verification Benchmark (50 runs)

**Framework:** GeoZK-Miner  
**Environment:** hardhat (chainId 31337)  
**Generated:** 2026-05-04T17:47:50.536Z

## Scope

On-chain `verifyAndRegisterBatch` calls using **RegionProofVerifier** and a single valid **Groth16** proof reused across batches that share the same **geo commitment** and **approved region hash** (per circuit binding). **Certification** remains a **hash-only** field and is **not** ZK-proven in this path.

## Summary statistics

| Metric | Value |
|--------|------:|
| Runs | 50 |
| Success (ZKP result true) | 50 |
| Failure | 0 |
| Average gas | 293534.32 |
| Min gas | 293524 |
| Max gas | 293536 |
| Median gas | 293536.00 |
| Gas stdev | 4.2061 |
| Avg latency (ms) | 5.1524 |
| Min latency (ms) | 4.5383 |
| Max latency (ms) | 8.9433 |
| Latency stdev (ms) | 0.7351 |

## Per-run excerpt (first 5)

- Run 1: gas=293536, tx=0x9b27a964464eece0be1ba4c63696b6d32118ceb79c6f08fc79d92ba5d733832d, block=11, feeETH=0.00036273175643568, ok=true
- Run 2: gas=293536, tx=0x74e67a1d9dfdc05b455584e0594f46fc5c4b7e86d5f01354fe07dd21cfde5740, block=13, feeETH=0.000346651430783232, ok=true
- Run 3: gas=293536, tx=0xf76af940bc8800a13b343aaa99d964a878dac4cf33020dcbec270a863a4d5726, block=15, feeETH=0.000334307996587136, ok=true
- Run 4: gas=293536, tx=0xe984f3cb9e5cb7c479a0765b7a216446d1a9b3dc279efd7592dc94476789b12a, block=17, feeETH=0.000324833039039296, ok=true
- Run 5: gas=293536, tx=0x016493862c95d2b0c58b72028f24bca39aa1c8b84356d8ad59f76c75f529a1ae, block=19, feeETH=0.000317559956082944, ok=true

Full rows: `docs/ZKP_VERIFICATION_50_RUNS.json`.
