/**
 * GeoZK-Miner — Off-chain ZKP timing (witness → prove → snarkjs verify).
 *
 * Run: npx hardhat run scripts/16_measureProofGenerationTime.js --network hardhat
 *
 * Uses snarkjs wtns.calculate (witness binary), groth16.prove, groth16.verify with hrtime.
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const os = require("os");
const circomlibjs = require("circomlibjs");
const snarkjs = require("snarkjs");
const { mean, stddev, median, min, max } = require("./evalStats");

const ROOT = path.join(__dirname, "..");
const NUM_RUNS = 30;
const FRAMEWORK = "GeoZK-Miner";

function hrtimeMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function statsFor(values) {
  return {
    average: mean(values),
    minimum: min(values),
    maximum: max(values),
    median: median(values),
    standardDeviation: stddev(values),
    numberOfRuns: values.length
  };
}

async function main() {
  const wasmPath = path.join(ROOT, "circuits", "build", "regionProof", "regionProof_js", "regionProof.wasm");
  const zkeyPath = path.join(ROOT, "circuits", "regionProof_final.zkey");
  const vkPath = path.join(ROOT, "circuits", "verification_key.json");
  if (!fs.existsSync(wasmPath)) throw new Error(`Missing wasm: ${wasmPath}`);
  if (!fs.existsSync(zkeyPath)) throw new Error(`Missing zkey: ${zkeyPath}`);
  if (!fs.existsSync(vkPath)) throw new Error(`Missing vk: ${vkPath}`);

  const vkey = JSON.parse(fs.readFileSync(vkPath, "utf8"));
  const poseidon = await circomlibjs.buildPoseidon();
  const region = { minX: 100, maxX: 250, minY: 300, maxY: 450 };

  const tmpDir = path.join(ROOT, "data", ".bench_tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  const witnessMs = [];
  const proveMs = [];
  const verifyMs = [];
  const totalMs = [];
  const runs = [];

  for (let i = 0; i < NUM_RUNS; i++) {
    const x = 150 + (i % 5);
    const y = 350 + (i % 5);
    const r = 1000 + i;

    const regionField = poseidon.F.toString(
      poseidon([BigInt(region.minX), BigInt(region.maxX), BigInt(region.minY), BigInt(region.maxY)])
    );
    const regionHash = hre.ethers.toBeHex(BigInt(regionField), 32);
    const commitmentField = poseidon.F.toString(poseidon([BigInt(x), BigInt(y), BigInt(r)]));
    const commitment = hre.ethers.toBeHex(BigInt(commitmentField), 32);

    const witnessInput = {
      x: String(x),
      y: String(y),
      r: String(r),
      minX: String(region.minX),
      maxX: String(region.maxX),
      minY: String(region.minY),
      maxY: String(region.maxY),
      regionHash: BigInt(regionHash).toString(),
      commitment: BigInt(commitment).toString()
    };

    const wtnsPath = path.join(tmpDir, `witness_${i}_${Date.now()}.wtns`);
    const proofPath = path.join(tmpDir, `proof_${i}.json`);
    const pubPath = path.join(tmpDir, `public_${i}.json`);

    const tAll0 = process.hrtime.bigint();

    const tw0 = process.hrtime.bigint();
    await snarkjs.wtns.calculate(witnessInput, wasmPath, wtnsPath);
    const tw = hrtimeMs(tw0);
    witnessMs.push(tw);

    const tp0 = process.hrtime.bigint();
    const { proof, publicSignals } = await snarkjs.groth16.prove(zkeyPath, wtnsPath);
    const tp = hrtimeMs(tp0);
    proveMs.push(tp);

    const tv0 = process.hrtime.bigint();
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    const tv = hrtimeMs(tv0);
    verifyMs.push(tv);
    if (!ok) throw new Error(`Off-chain verify failed run ${i + 1}`);

    const total = hrtimeMs(tAll0);
    totalMs.push(total);

    fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2));
    fs.writeFileSync(pubPath, JSON.stringify(publicSignals, null, 2));

    runs.push({
      run: i + 1,
      batchIdOrLabel: `timing-run-${i + 1}`,
      witnessGenerationMs: tw,
      proofGenerationMs: tp,
      offChainVerificationMs: tv,
      totalMs: total,
      proofFilePath: proofPath,
      publicSignalsFilePath: pubPath,
      timestamp: new Date().toISOString()
    });

    try {
      fs.unlinkSync(wtnsPath);
    } catch {
      /* ignore */
    }
  }

  const summary = {
    framework: FRAMEWORK,
    experiment: "Off-chain Groth16 witness, prove, and snarkjs verify timing",
    disclaimer:
      "Timings are local Node.js wall times (process.hrtime.bigint). Certification is not proven in this circuit.",
    measurementMethod: "snarkjs.wtns.calculate + snarkjs.groth16.prove + snarkjs.groth16.verify",
    timestamp: new Date().toISOString(),
    environment: { network: hre.network.name, node: process.version },
    witnessGenerationMs: statsFor(witnessMs),
    proofGenerationMs: statsFor(proveMs),
    offChainVerificationMs: statsFor(verifyMs),
    totalMs: statsFor(totalMs),
    runs
  };

  const docsJson = path.join(ROOT, "docs", "ZKP_PROOF_GENERATION_TIMING.json");
  const tableJson = path.join(ROOT, "table", "zkp_proof_generation_timing_summary.json");
  fs.writeFileSync(docsJson, JSON.stringify(summary, null, 2));
  fs.writeFileSync(tableJson, JSON.stringify(summary, null, 2));

  const md = `# GeoZK-Miner — Off-Chain ZKP Generation Timing

**Framework:** ${FRAMEWORK}  
**Runs:** ${NUM_RUNS}  
**Method:** ${summary.measurementMethod}  
**Generated:** ${summary.timestamp}

## Summary (ms)

| Metric | Witness gen. | Proof gen. | Off-chain verify | Total |
|--------|-------------:|-----------:|-----------------:|------:|
| Average | ${summary.witnessGenerationMs.average.toFixed(4)} | ${summary.proofGenerationMs.average.toFixed(4)} | ${summary.offChainVerificationMs.average.toFixed(4)} | ${summary.totalMs.average.toFixed(4)} |
| Min | ${summary.witnessGenerationMs.minimum.toFixed(4)} | ${summary.proofGenerationMs.minimum.toFixed(4)} | ${summary.offChainVerificationMs.minimum.toFixed(4)} | ${summary.totalMs.minimum.toFixed(4)} |
| Max | ${summary.witnessGenerationMs.maximum.toFixed(4)} | ${summary.proofGenerationMs.maximum.toFixed(4)} | ${summary.offChainVerificationMs.maximum.toFixed(4)} | ${summary.totalMs.maximum.toFixed(4)} |
| Median | ${summary.witnessGenerationMs.median.toFixed(4)} | ${summary.proofGenerationMs.median.toFixed(4)} | ${summary.offChainVerificationMs.median.toFixed(4)} | ${summary.totalMs.median.toFixed(4)} |
| Stdev | ${summary.witnessGenerationMs.standardDeviation != null ? summary.witnessGenerationMs.standardDeviation.toFixed(4) : "n/a"} | ${summary.proofGenerationMs.standardDeviation != null ? summary.proofGenerationMs.standardDeviation.toFixed(4) : "n/a"} | ${summary.offChainVerificationMs.standardDeviation != null ? summary.offChainVerificationMs.standardDeviation.toFixed(4) : "n/a"} | ${summary.totalMs.standardDeviation != null ? summary.totalMs.standardDeviation.toFixed(4) : "n/a"} |

Artifacts for the last run are written under \`data/.bench_tmp/\` (proof and public JSON paths recorded per row in JSON).
`;

  fs.writeFileSync(path.join(ROOT, "docs", "ZKP_PROOF_GENERATION_TIMING.md"), md);

  console.log("\n========== GeoZK-Miner — Off-chain ZKP timing ==========");
  console.log(`Runs: ${NUM_RUNS}`);
  console.log(`Avg witness (ms): ${summary.witnessGenerationMs.average.toFixed(3)}`);
  console.log(`Avg prove (ms): ${summary.proofGenerationMs.average.toFixed(3)}`);
  console.log(`Avg off-chain verify (ms): ${summary.offChainVerificationMs.average.toFixed(3)}`);
  console.log(`Avg total (ms): ${summary.totalMs.average.toFixed(3)}`);
  console.log("Written: docs/ZKP_PROOF_GENERATION_TIMING.json");
  console.log("Written: docs/ZKP_PROOF_GENERATION_TIMING.md");
  console.log("Written: table/zkp_proof_generation_timing_summary.json");
  console.log("========================================================\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
