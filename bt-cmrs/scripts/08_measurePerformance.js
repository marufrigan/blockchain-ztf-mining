const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { loadAddresses, readJSON } = require("./helpers");

const average = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

async function executeTransaction(name, ctx) {
  const { btcMrs, signers, sampleBatchId } = ctx;
  if (name === "Batch Creation") {
    const certHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`cert-${Date.now()}`));
    const geo = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`geo-${Date.now()}`));
    const regionHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("region-alpha"));
    return btcMrs.connect(signers.mine).createBatch(0, certHash, geo, regionHash, "ipfs://batch");
  }
  if (name === "Lifecycle Update") {
    return btcMrs.connect(signers.logistics).updateBatchStatus(sampleBatchId, 2, "Bench route");
  }
  if (name === "Reacquisition Request") {
    const batch = await btcMrs.getBatch(sampleBatchId);
    const currentStatus = Number(batch.status);
    const validStatuses = new Set([3, 5, 6]); // AT_SMELTER, AT_MANUFACTURER, COMPLETED
    if (!validStatuses.has(currentStatus)) {
      // Normalize into a valid state for repeatable benchmarking.
      await (await btcMrs.connect(signers.smelter).updateBatchStatus(sampleBatchId, 3, "Benchmark Smelter Gate")).wait();
    }
    return btcMrs.connect(signers.smelter).requestReacquisition(sampleBatchId, "Benchmark request");
  }
  return btcMrs.connect(signers.manufacturer).updateBatchStatus(sampleBatchId, 6, "Finalized");
}

async function runTest(config, ctx) {
  const gasUsages = [];
  const latencies = [];
  for (let i = 0; i < config.iterations; i++) {
    const start = Date.now();
    const tx = await executeTransaction(config.name, ctx);
    const receipt = await tx.wait();
    latencies.push(Date.now() - start);
    gasUsages.push(Number(receipt.gasUsed));
  }
  return {
    name: config.name,
    iterations: config.iterations,
    avgGas: average(gasUsages),
    minGas: Math.min(...gasUsages),
    maxGas: Math.max(...gasUsages),
    avgLatency: average(latencies),
    throughput: config.iterations / (sum(latencies) / 1000)
  };
}

function maybeUsd(ethValue) {
  const price = process.env.ETH_USD_PRICE ? Number(process.env.ETH_USD_PRICE) : null;
  return price ? ethValue * price : null;
}

function generatePaperTable(data) {
  let md = "## Performance Results\n\n";
  md += "| Test | Iterations | Avg Gas | Avg Latency (ms) | Throughput (TPS) |\n";
  md += "|------|-----------:|--------:|-----------------:|-----------------:|\n";
  for (const t of data.tests) md += `| ${t.name} | ${t.iterations} | ${t.avgGas.toFixed(0)} | ${t.avgLatency.toFixed(2)} | ${t.throughput.toFixed(2)} |\n`;
  fs.writeFileSync(path.join(__dirname, "..", "docs", "GAS_ANALYSIS.md"), md);
}

async function main() {
  const addresses = loadAddresses();
  const [admin, mine, logistics, smelter, manufacturer] = await hre.ethers.getSigners();
  const btcMrs = await hre.ethers.getContractAt("BTCMRS", addresses.btcMrs);
  const created = readJSON(path.join(__dirname, "..", "data", "created-batches.json"));
  const sampleBatchId = created[0].batchId;

  const tests = [
    { name: "Batch Creation", iterations: 10 },
    { name: "Lifecycle Update", iterations: 5 },
    { name: "Reacquisition Request", iterations: 5 },
    { name: "Completion Update", iterations: 5 }
  ];

  const results = [];
  for (const t of tests) results.push(await runTest(t, { btcMrs, signers: { admin, mine, logistics, smelter, manufacturer }, sampleBatchId }));

  const report = { timestamp: new Date().toISOString(), network: hre.network.name, tests: results };
  fs.writeFileSync(path.join(__dirname, "..", "docs", "PERFORMANCE_RESULTS.json"), JSON.stringify(report, null, 2));
  generatePaperTable(report);
  console.log("Performance reports saved in docs/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
