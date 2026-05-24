const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { loadAddresses } = require("./helpers");

function serializeArg(v) {
  if (typeof v === "bigint") return v.toString();
  return v;
}

async function getTimestamp(provider, blockNumber) {
  const b = await provider.getBlock(blockNumber);
  return b ? new Date(Number(b.timestamp) * 1000).toISOString() : null;
}

async function main() {
  const addresses = loadAddresses();
  const btcMrs = await hre.ethers.getContractAt("BTCMRS", addresses.btcMrs);

  const filterNames = [
    "BatchCreated",
    "ZKPVerified",
    "BatchStatusUpdated",
    "ReacquisitionRequested",
    "ReacquisitionResolved",
    "CustodyTransferred"
  ];

  let all = [];
  for (const name of filterNames) {
    const logs = await btcMrs.queryFilter(btcMrs.filters[name](), 0, "latest");
    all = all.concat(logs.map((l) => ({ name, log: l })));
  }
  all.sort((a, b) => Number(a.log.blockNumber) - Number(b.log.blockNumber));

  const chain = await hre.ethers.provider.getNetwork();
  const rows = [];
  for (const x of all) {
    const receipt = await hre.ethers.provider.getTransactionReceipt(x.log.transactionHash);
    const tx = await hre.ethers.provider.getTransaction(x.log.transactionHash);
    rows.push({
      event: x.name,
      transactionHash: x.log.transactionHash,
      blockNumber: Number(x.log.blockNumber),
      blockHash: x.log.blockHash,
      chainId: Number(chain.chainId),
      gasUsed: receipt ? Number(receipt.gasUsed) : null,
      gasPriceWei: tx && tx.gasPrice ? tx.gasPrice.toString() : null,
      gasCostEth: receipt && tx && tx.gasPrice ? hre.ethers.formatEther(receipt.gasUsed * tx.gasPrice) : null,
      gasCostUsd: receipt && tx && tx.gasPrice && process.env.ETH_USD_PRICE
        ? Number(hre.ethers.formatEther(receipt.gasUsed * tx.gasPrice)) * Number(process.env.ETH_USD_PRICE)
        : null,
      timestamp: await getTimestamp(hre.ethers.provider, Number(x.log.blockNumber)),
      args: Object.fromEntries(Object.entries(x.log.args || {}).filter(([k]) => Number.isNaN(Number(k))).map(([k, v]) => [k, serializeArg(v)]))
    });
  }

  fs.writeFileSync(path.join(__dirname, "..", "docs", "EVENT_LOGS.json"), JSON.stringify(rows, null, 2));

  const md = [
    "## Event Log Summary for Section 4",
    "",
    "| Event | Tx Hash | Block | Gas Used | Gas ETH | Timestamp |",
    "|-------|---------|------:|---------:|--------:|-----------|",
    ...rows.map((r) => `| ${r.event} | ${r.transactionHash.slice(0, 18)}... | ${r.blockNumber} | ${r.gasUsed ?? "-"} | ${r.gasCostEth ?? "-"} | ${r.timestamp ?? "-"} |`)
  ].join("\n");
  fs.writeFileSync(path.join(__dirname, "..", "docs", "EVENT_LOGS.md"), md);

  console.log("Exported docs/EVENT_LOGS.json and docs/EVENT_LOGS.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
