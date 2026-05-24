const hre = require("hardhat");
const path = require("path");
const fs = require("fs");
const { loadAddresses } = require("./helpers");

function normalize(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalize(v);
    return out;
  }
  return value;
}

async function main() {
  const addresses = loadAddresses();
  const btcMrs = await hre.ethers.getContractAt("BTCMRS", addresses.btcMrs);
  const iface = btcMrs.interface;

  const needed = [
    "BatchCreated",
    "ZKPVerified",
    "BatchStatusUpdated",
    "CustodyTransferred",
    "ReacquisitionRequested",
    "ReacquisitionResolved"
  ];

  let all = [];
  for (const name of needed) {
    const logs = await btcMrs.queryFilter(btcMrs.filters[name](), 0, "latest");
    for (const log of logs) {
      const parsed = iface.parseLog(log);
      const args = {};
      parsed.fragment.inputs.forEach((input, idx) => {
        const key = input.name && input.name.length > 0 ? input.name : `arg${idx}`;
        args[key] = normalize(parsed.args[idx]);
      });
      all.push({
        event: parsed.name,
        contractAddress: log.address,
        topic0: log.topics[0],
        transactionHash: log.transactionHash,
        blockNumber: Number(log.blockNumber),
        args
      });
    }
  }

  all.sort((a, b) => a.blockNumber - b.blockNumber);
  const requiredOrder = [
    "BatchCreated",
    "ZKPVerified",
    "BatchStatusUpdated",
    "CustodyTransferred",
    "ReacquisitionRequested",
    "ReacquisitionResolved"
  ];
  const selected = [];
  for (const eventName of requiredOrder) {
    const hit = all.find((x) => x.event === eventName);
    if (hit) selected.push(hit);
  }
  // Add a second example for high-signal events.
  for (const eventName of ["BatchCreated", "ZKPVerified"]) {
    const second = all.filter((x) => x.event === eventName)[1];
    if (second) selected.push(second);
  }
  const snapshot = selected;

  const outPath = path.join(__dirname, "..", "docs", "SNAPSHOT_LOGS.json");
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`Saved ${snapshot.length} logs to docs/SNAPSHOT_LOGS.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
