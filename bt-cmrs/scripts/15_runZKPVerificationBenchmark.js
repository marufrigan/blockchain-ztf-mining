/**
 * GeoZK-Miner — 50-run on-chain region ZKP verification benchmark (local Hardhat).
 *
 * Run: npx hardhat run scripts/15_runZKPVerificationBenchmark.js --network hardhat
 *
 * Reuses one valid Groth16 proof for 50 batches sharing the same geo commitment
 * and approved region hash (valid per circuit constraints).
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const circomlibjs = require("circomlibjs");
const snarkjs = require("snarkjs");
const { mean, stddev, median, min, max } = require("./evalStats");

const ROOT = path.join(__dirname, "..");
const RUNS = 50;
const FRAMEWORK = "GeoZK-Miner";

function hrtimeMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function proofToSolidityArgs(proof, publicSignals) {
  const proofA = [proof.pi_a[0], proof.pi_a[1]];
  const proofB = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]]
  ];
  const proofC = [proof.pi_c[0], proof.pi_c[1]];
  const signals = publicSignals.map((s) => BigInt(s));
  return { proofA, proofB, proofC, signals };
}

async function deploySystem() {
  const [admin, mine, logistics, smelter, manufacturer, auditor] = await hre.ethers.getSigners();

  const Registry = await hre.ethers.getContractFactory("StakeholderRegistry");
  const registry = await Registry.deploy(admin.address);
  await registry.waitForDeployment();

  const Verifier = await hre.ethers.getContractFactory("RegionProofVerifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();

  const BTCMRS = await hre.ethers.getContractFactory("BTCMRS");
  const btcMrs = await BTCMRS.deploy(await registry.getAddress(), await verifier.getAddress());
  await btcMrs.waitForDeployment();

  const roles = {
    MINE: await registry.MINE_ROLE(),
    LOGISTICS: await registry.LOGISTICS_ROLE(),
    SMELTER: await registry.SMELTER_ROLE(),
    MANUFACTURER: await registry.MANUFACTURER_ROLE(),
    AUDITOR: await registry.AUDITOR_ROLE()
  };

  await (await registry.registerStakeholder(mine.address, roles.MINE, "Mine", "ipfs://m")).wait();
  await (await registry.registerStakeholder(logistics.address, roles.LOGISTICS, "Logistics", "ipfs://l")).wait();
  await (await registry.registerStakeholder(smelter.address, roles.SMELTER, "Smelter", "ipfs://s")).wait();
  await (await registry.registerStakeholder(manufacturer.address, roles.MANUFACTURER, "Manufacturer", "ipfs://f")).wait();
  await (await registry.registerStakeholder(auditor.address, roles.AUDITOR, "Auditor", "ipfs://a")).wait();

  return { registry, verifier, btcMrs, mine, auditor };
}

async function main() {
  const poseidon = await circomlibjs.buildPoseidon();
  const region = { minX: 100, maxX: 250, minY: 300, maxY: 450 };
  const x = 150;
  const y = 350;
  const r = 1000;

  const regionField = poseidon.F.toString(
    poseidon([BigInt(region.minX), BigInt(region.maxX), BigInt(region.minY), BigInt(region.maxY)])
  );
  const regionHash = hre.ethers.toBeHex(BigInt(regionField), 32);
  const commitmentField = poseidon.F.toString(poseidon([BigInt(x), BigInt(y), BigInt(r)]));
  const geoCommitment = hre.ethers.toBeHex(BigInt(commitmentField), 32);

  const wasmPath = path.join(ROOT, "circuits", "build", "regionProof", "regionProof_js", "regionProof.wasm");
  const zkeyPath = path.join(ROOT, "circuits", "regionProof_final.zkey");
  if (!fs.existsSync(wasmPath)) throw new Error(`Missing wasm: ${wasmPath}. Run npm run circuits:compile.`);
  if (!fs.existsSync(zkeyPath)) throw new Error(`Missing zkey: ${zkeyPath}. Run npm run circuits:compile.`);

  const witnessInput = {
    x: String(x),
    y: String(y),
    r: String(r),
    minX: String(region.minX),
    maxX: String(region.maxX),
    minY: String(region.minY),
    maxY: String(region.maxY),
    regionHash: BigInt(regionHash).toString(),
    commitment: BigInt(geoCommitment).toString()
  };

  console.log(`[${FRAMEWORK}] Generating one Groth16 proof for witness (off-chain, before benchmark)...`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(witnessInput, wasmPath, zkeyPath);
  const offchainOk = await snarkjs.groth16.verify(
    JSON.parse(fs.readFileSync(path.join(ROOT, "circuits", "verification_key.json"), "utf8")),
    publicSignals,
    proof
  );
  if (!offchainOk) throw new Error("Off-chain snarkjs verification failed before benchmark.");
  const solArgs = proofToSolidityArgs(proof, publicSignals);

  const { btcMrs, mine, auditor } = await deploySystem();
  await (await btcMrs.connect(auditor).approveRegion(regionHash)).wait();

  const runs = [];
  const latencies = [];
  const gasUsedArr = [];

  for (let i = 0; i < RUNS; i++) {
    const certHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`geozk-bench-cert-${i}`));
    const txCreate = await btcMrs
      .connect(mine)
      .createBatch(0, certHash, geoCommitment, regionHash, `ipfs://geozk-bench-${i}`);
    const rcCreate = await txCreate.wait();
    const parsed = rcCreate.logs
      .map((l) => {
        try {
          return btcMrs.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "BatchCreated");
    const batchId = parsed.args.batchId;

    const t0 = process.hrtime.bigint();
    const txV = await btcMrs.connect(auditor).verifyAndRegisterBatch(
      batchId,
      solArgs.proofA,
      solArgs.proofB,
      solArgs.proofC,
      solArgs.signals
    );
    const rcV = await txV.wait();
    const latencyMs = hrtimeMs(t0);

    const effectiveGasPrice = rcV.gasPrice ?? rcV.effectiveGasPrice ?? 0n;
    const feeWei = rcV.gasUsed * effectiveGasPrice;
    const feeEth = hre.ethers.formatEther(feeWei);

    const zkpLog = rcV.logs
      .map((l) => {
        try {
          return btcMrs.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "ZKPVerified");

    const result = zkpLog ? Boolean(zkpLog.args.result) : null;

    const row = {
      run: i + 1,
      batchId,
      transactionHash: rcV.hash,
      blockNumber: rcV.blockNumber,
      gasUsed: Number(rcV.gasUsed),
      transactionFeeEth: feeEth,
      verificationResult: result,
      timestamp: new Date().toISOString(),
      network: hre.network.name,
      chainId: Number((await hre.ethers.provider.getNetwork()).chainId)
    };
    runs.push(row);
    latencies.push(latencyMs);
    gasUsedArr.push(Number(rcV.gasUsed));
  }

  const summary = {
    framework: FRAMEWORK,
    experiment: "On-chain region ZKP verification (Groth16, RegionProofVerifier)",
    disclaimer:
      "Region compliance is verified with ZKP; certification is hash-only in the main path. Results are from a local Hardhat network.",
    timestamp: new Date().toISOString(),
    environment: { network: hre.network.name, chainId: runs[0]?.chainId ?? null },
    numberOfRuns: RUNS,
    successCount: runs.filter((r) => r.verificationResult === true).length,
    failureCount: runs.filter((r) => r.verificationResult !== true).length,
    gas: {
      average: mean(gasUsedArr),
      minimum: min(gasUsedArr),
      maximum: max(gasUsedArr),
      median: median(gasUsedArr),
      standardDeviation: stddev(gasUsedArr)
    },
    latencyMs: {
      average: mean(latencies),
      minimum: min(latencies),
      maximum: max(latencies),
      standardDeviation: stddev(latencies)
    },
    runs
  };

  const docsJson = path.join(ROOT, "docs", "ZKP_VERIFICATION_50_RUNS.json");
  const tableJson = path.join(ROOT, "table", "zkp_verification_50_runs_summary.json");
  fs.mkdirSync(path.dirname(docsJson), { recursive: true });
  fs.mkdirSync(path.dirname(tableJson), { recursive: true });
  fs.writeFileSync(docsJson, JSON.stringify(summary, null, 2));
  fs.writeFileSync(tableJson, JSON.stringify(summary, null, 2));

  const md = `# GeoZK-Miner — Extended ZKP Verification Benchmark (50 runs)

**Framework:** ${FRAMEWORK}  
**Environment:** ${summary.environment.network} (chainId ${summary.environment.chainId})  
**Generated:** ${summary.timestamp}

## Scope

On-chain \`verifyAndRegisterBatch\` calls using **RegionProofVerifier** and a single valid **Groth16** proof reused across batches that share the same **geo commitment** and **approved region hash** (per circuit binding). **Certification** remains a **hash-only** field and is **not** ZK-proven in this path.

## Summary statistics

| Metric | Value |
|--------|------:|
| Runs | ${summary.numberOfRuns} |
| Success (ZKP result true) | ${summary.successCount} |
| Failure | ${summary.failureCount} |
| Average gas | ${summary.gas.average.toFixed(2)} |
| Min gas | ${summary.gas.minimum} |
| Max gas | ${summary.gas.maximum} |
| Median gas | ${summary.gas.median.toFixed(2)} |
| Gas stdev | ${summary.gas.standardDeviation != null ? summary.gas.standardDeviation.toFixed(4) : "n/a"} |
| Avg latency (ms) | ${summary.latencyMs.average.toFixed(4)} |
| Min latency (ms) | ${summary.latencyMs.minimum.toFixed(4)} |
| Max latency (ms) | ${summary.latencyMs.maximum.toFixed(4)} |
| Latency stdev (ms) | ${summary.latencyMs.standardDeviation != null ? summary.latencyMs.standardDeviation.toFixed(4) : "n/a"} |

## Per-run excerpt (first 5)

${runs
  .slice(0, 5)
  .map(
    (r) =>
      `- Run ${r.run}: gas=${r.gasUsed}, tx=${r.transactionHash}, block=${r.blockNumber}, feeETH=${r.transactionFeeEth}, ok=${r.verificationResult}`
  )
  .join("\n")}

Full rows: \`docs/ZKP_VERIFICATION_50_RUNS.json\`.
`;

  fs.writeFileSync(path.join(ROOT, "docs", "ZKP_VERIFICATION_50_RUNS.md"), md);

  console.log("\n========== GeoZK-Miner — ZKP verification benchmark (50 runs) ==========");
  console.log(`Network: ${hre.network.name}`);
  console.log(`Success: ${summary.successCount} / ${RUNS}`);
  console.log(`Gas avg / min / max / median: ${summary.gas.average.toFixed(0)} / ${summary.gas.minimum} / ${summary.gas.maximum} / ${summary.gas.median.toFixed(0)}`);
  console.log(`Gas stdev: ${summary.gas.standardDeviation != null ? summary.gas.standardDeviation.toFixed(4) : "n/a"}`);
  console.log(`Latency avg (ms): ${summary.latencyMs.average.toFixed(3)}`);
  console.log(`Written: docs/ZKP_VERIFICATION_50_RUNS.json`);
  console.log(`Written: docs/ZKP_VERIFICATION_50_RUNS.md`);
  console.log(`Written: table/zkp_verification_50_runs_summary.json`);
  console.log("========================================================================\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
