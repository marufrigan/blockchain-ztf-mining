/**
 * GeoZK-Miner — Aggregate extended evaluation tables and paper draft (reads JSON outputs from scripts 15–18).
 *
 * Run after: 15, 16, 17, (optional 18)
 *   npx hardhat run scripts/19_generateExtendedEvaluationTables.js --network hardhat
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FRAMEWORK = "GeoZK-Miner";

function readJsonSafe(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const zkp50 = readJsonSafe(path.join(ROOT, "docs", "ZKP_VERIFICATION_50_RUNS.json"));
  const timing = readJsonSafe(path.join(ROOT, "docs", "ZKP_PROOF_GENERATION_TIMING.json"));
  const artifacts = readJsonSafe(path.join(ROOT, "docs", "ZKP_ARTIFACT_SIZE_ANALYSIS.json"));
  const sepolia = readJsonSafe(path.join(ROOT, "docs", "SEPOLIA_SMOKE_TEST_RESULTS.json"));

  const tableA = zkp50
    ? {
        title: "Extended ZKP Verification Benchmark for GeoZK-Miner",
        columns: [
          "Number of runs",
          "Success count",
          "Failure count",
          "Average gas",
          "Minimum gas",
          "Maximum gas",
          "Median gas",
          "Gas standard deviation",
          "Average latency (ms)",
          "Environment"
        ],
        row: [
          zkp50.numberOfRuns,
          zkp50.successCount,
          zkp50.failureCount,
          zkp50.gas.average != null ? Number(zkp50.gas.average).toFixed(2) : "—",
          zkp50.gas.minimum,
          zkp50.gas.maximum,
          zkp50.gas.median != null ? Number(zkp50.gas.median).toFixed(2) : "—",
          zkp50.gas.standardDeviation != null ? Number(zkp50.gas.standardDeviation).toFixed(4) : "—",
          zkp50.latencyMs.average != null ? Number(zkp50.latencyMs.average).toFixed(4) : "—",
          `${zkp50.environment?.network ?? "unknown"} (local Hardhat metrics)`
        ]
      }
    : null;

  const tableB = timing
    ? {
        title: "Off-Chain ZKP Generation Timing in GeoZK-Miner",
        rows: [
          ["Witness generation (ms)", timing.witnessGenerationMs],
          ["Proof generation (ms)", timing.proofGenerationMs],
          ["Off-chain verification (ms)", timing.offChainVerificationMs],
          ["Total (ms)", timing.totalMs]
        ].map(([label, s]) => ({
          metric: label,
          average: s.average != null ? Number(s.average).toFixed(4) : "—",
          minimum: s.minimum != null ? Number(s.minimum).toFixed(4) : "—",
          maximum: s.maximum != null ? Number(s.maximum).toFixed(4) : "—",
          standardDeviation: s.standardDeviation != null ? Number(s.standardDeviation).toFixed(4) : "—",
          numberOfRuns: s.numberOfRuns
        }))
      }
    : null;

  const tableC = artifacts
    ? {
        title: "ZKP Artifact Size Analysis for GeoZK-Miner",
        rows: artifacts.artifacts.map((a) => ({
          artifact: a.artifact,
          filePath: a.filePath,
          sizeBytes: a.sizeBytes,
          sizeLabel: a.sizeLabel,
          relevance: a.relevance
        }))
      }
    : null;

  const tableD = sepolia
    ? {
        title: "Optional Sepolia Smoke Test Results",
        rows:
          sepolia.transactions?.map((t) => ({
            operation: t.operation,
            transactionHash: t.transactionHash,
            blockNumber: t.blockNumber,
            gasUsed: t.gasUsed,
            transactionFeeEth: t.transactionFeeEth,
            explorerLink: t.explorerLink,
            status: t.status
          })) ?? []
      }
    : null;

  const jsonOut = {
    framework: FRAMEWORK,
    generatedAt: new Date().toISOString(),
    tableA,
    tableB,
    tableC,
    tableD,
    sepoliaExecuted: Boolean(sepolia?.executed)
  };
  fs.writeFileSync(path.join(ROOT, "table", "extended_evaluation_tables.json"), JSON.stringify(jsonOut, null, 2));

  let md = `# GeoZK-Miner — Extended Evaluation Tables

**Framework:** ${FRAMEWORK}  
**Generated:** ${jsonOut.generatedAt}

`;

  if (tableA) {
    md += `## Table A — ${tableA.title}\n\n| ${tableA.columns.join(" | ")} |\n|${tableA.columns.map(() => "---").join("|")}|\n| ${tableA.row.join(" | ")} |\n\n`;
  } else {
    md += `## Table A — Extended ZKP Verification Benchmark for GeoZK-Miner\n\n_Not generated — run \`npx hardhat run scripts/15_runZKPVerificationBenchmark.js --network hardhat\` first._\n\n`;
  }

  if (tableB) {
    md += `## Table B — ${tableB.title}\n\n| Metric | Average | Min | Max | Stdev | Runs |\n|---|---:|---:|---:|---:|---:|\n`;
    for (const r of tableB.rows) {
      md += `| ${r.metric} | ${r.average} | ${r.minimum} | ${r.maximum} | ${r.standardDeviation} | ${r.numberOfRuns} |\n`;
    }
    md += "\n";
  } else {
    md += `## Table B — Off-Chain ZKP Generation Timing in GeoZK-Miner\n\n_Not generated — run script 16 first._\n\n`;
  }

  if (tableC) {
    md += `## Table C — ${tableC.title}\n\n| Artifact | Path | Size | Relevance |\n|---|---|---|---|\n`;
    for (const r of tableC.rows) {
      md += `| ${r.artifact} | \`${r.filePath}\` | ${r.sizeLabel} | ${r.relevance} |\n`;
    }
    md += "\n";
  } else {
    md += `## Table C — ZKP Artifact Size Analysis for GeoZK-Miner\n\n_Not generated — run script 17 first._\n\n`;
  }

  if (tableD && tableD.rows.length) {
    md += `## Table D — ${tableD.title}\n\n| Operation | Tx | Block | Gas | Fee (ETH) | Explorer | Status |\n|---|---|---:|---:|---:|---|---|\n`;
    for (const r of tableD.rows) {
      md += `| ${r.operation} | \`${r.transactionHash}\` | ${r.blockNumber} | ${r.gasUsed} | ${r.transactionFeeEth ?? "—"} | [link](${r.explorerLink}) | ${r.status} |\n`;
    }
    md += "\n";
  } else {
    md += `## Table D — Optional Sepolia Smoke Test Results\n\n_See \`docs/SEPOLIA_SMOKE_TEST_RESULTS.md\` — smoke test may have been skipped or not yet run._\n\n`;
  }

  fs.writeFileSync(path.join(ROOT, "docs", "EXTENDED_EVALUATION_TABLES.md"), md);

  const gasAvg = zkp50?.gas?.average != null ? Number(zkp50.gas.average).toFixed(0) : "—";
  const witAvg = timing?.witnessGenerationMs?.average != null ? Number(timing.witnessGenerationMs.average).toFixed(2) : "—";
  const provAvg = timing?.proofGenerationMs?.average != null ? Number(timing.proofGenerationMs.average).toFixed(2) : "—";
  const zkeySz = artifacts?.artifacts?.find((a) => a.artifact.includes("zkey"))?.sizeLabel ?? "—";

  const section = `# 4.X Extended ZKP Benchmark and Artefact Analysis (GeoZK-Miner)

This subsection complements the core implementation evaluation by reporting **additional on-chain ZKP verification repetitions**, **off-chain proving-stage timings**, and **static artefact sizes** produced by the prototype toolchain. All measurements are **instrumented from actual script runs**; where a script was not executed, the corresponding table states that explicitly in \`docs/EXTENDED_EVALUATION_TABLES.md\`.

## Motivation

Prior evaluation included only a **small number** of representative ZKP verification transactions. To address reviewer concerns about **statistical breadth**, the benchmark script performs **fifty** consecutive \`verifyAndRegisterBatch\` calls on a **local Hardhat** network using a **valid Groth16 proof** bound to each batch’s **shared geo-commitment and approved region hash** (circuit-consistent reuse). This isolates **verification gas and transaction latency** under controlled conditions; it does **not** substitute for public-network congestion studies.

## Fifty-run on-chain verification summary

Across the recorded runs (${zkp50 ? String(zkp50.numberOfRuns) : "—"}), the aggregate file reports **success count** ${zkp50 ? zkp50.successCount : "—"} and **failure count** ${zkp50 ? zkp50.failureCount : "—"}, with **mean gas** ${gasAvg} (see \`docs/ZKP_VERIFICATION_50_RUNS.json\` for min, max, median, and standard deviation, plus per-run transaction hashes). These values characterize **local Hardhat** execution only.

## Off-chain proof-generation timing

Witness generation, proving, and **snarkjs** off-chain verification were timed separately using **high-resolution clocks** (\`scripts/16_measureProofGenerationTime.js\`). Average witness time was **${witAvg} ms**, average proof generation **${provAvg} ms**, with full distributions stored in \`docs/ZKP_PROOF_GENERATION_TIMING.json\`. These timings measure the **Node/snarkjs** pipeline on the measurement host and should not be read as on-chain latency.

## Proof and key material sizes

Static sizes for the proof JSON sample (when \`data/proofs.json\` exists), verification key, proving key (\`zkey\`), WASM, R1CS, and the Solidity verifier source footprint are recorded in \`docs/ZKP_ARTIFACT_SIZE_ANALYSIS.json\`. Example: final **zkey** size is reported as **${zkeySz}** in the generated summary.

## Optional Sepolia smoke test

${sepolia?.executed ? "A minimal Sepolia deployment and a single end-to-end on-chain ZKP verification were attempted; see docs/SEPOLIA_SMOKE_TEST_RESULTS.md for hashes, blocks, and explorer links. This is smoke-level validation only." : "Sepolia results were not produced in this workspace run (missing credentials, wrong network flag, or execution error). See docs/SEPOLIA_SMOKE_TEST_RESULTS.md for the recorded note or partial logs."}

## Limitations (explicit)

- **Local Hardhat** metrics are **controlled** and omit public mempool behaviour.  
- **Certification** is **not** enforced by the main ZKP circuit; only **region compliance** is ZK-proven on-chain in this prototype.  
- **Fifty runs** reuse one proof payload across batches sharing identical commitment/region fields—valid for **verification cost** characterisation but not a diversity study over distinct witnesses.  
- **Sepolia**, when present, is a **small** smoke slice, not a large-scale deployment claim.

`;

  fs.writeFileSync(path.join(ROOT, "docs", "EXTENDED_ZKP_BENCHMARK_SECTION.md"), section);

  console.log(`[${FRAMEWORK}] Wrote docs/EXTENDED_EVALUATION_TABLES.md, table/extended_evaluation_tables.json, docs/EXTENDED_ZKP_BENCHMARK_SECTION.md`);
}

main();
