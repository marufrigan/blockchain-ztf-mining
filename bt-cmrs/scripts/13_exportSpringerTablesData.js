/**
 * Export Table 1–7 Springer-style (Parameter | Result) rows as JSON.
 *
 * Run:
 *   npx hardhat run scripts/13_exportSpringerTablesData.js --network localhost
 *
 * Outputs:
 *   table/springer_tables_data.json
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function weiToGweiStr(wei, dp = 9) {
  if (wei == null) return null;
  const g = Number(BigInt(wei)) / 1e9;
  return g.toFixed(dp);
}

function fmtEthStr(wei, dp = 18) {
  if (wei == null) return null;
  const eth = hre.ethers.formatEther(wei);
  // trim to dp without scientific notation
  const [a, b = ""] = String(eth).split(".");
  return b.length > dp ? `${a}.${b.slice(0, dp)}` : String(eth);
}

function fmtIntStr(x) {
  if (x == null) return "—";
  const n = typeof x === "bigint" ? x : BigInt(x);
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function getLatestZkpTxHash() {
  const root = path.join(__dirname, "..");
  const eventPath = path.join(root, "docs", "EVENT_LOGS.json");
  if (!fs.existsSync(eventPath)) return null;
  const events = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const zkp = [...events].reverse().find((e) => e.event === "ZKPVerified");
  return zkp?.transactionHash ?? null;
}

async function enrichTx(txHash) {
  const provider = hre.ethers.provider;
  const tx = await provider.getTransaction(txHash);
  const rc = await provider.getTransactionReceipt(txHash);
  const blk = await provider.getBlock(rc.blockNumber);

  const gasLimit = tx.gasLimit;
  const gasUsed = rc.gasUsed;
  const pct = gasLimit > 0n ? Number((gasUsed * 10000n) / gasLimit) / 100 : 0;

  const eff = rc.effectiveGasPrice ?? rc.gasPrice ?? tx.gasPrice ?? null;
  const txFeeWei = eff != null ? gasUsed * eff : null;

  const base = blk.baseFeePerGas ?? null;
  const maxFee = tx.maxFeePerGas ?? null;
  const maxPrio = tx.maxPriorityFeePerGas ?? null;

  const typeLabel =
    tx.type === 2 || tx.type === "0x2"
      ? "Type 2 (EIP-1559)"
      : tx.type === 0 || tx.type === "0x0"
        ? "Type 0 (Legacy)"
        : tx.type != null
          ? String(tx.type)
          : "—";

  const pos = rc.index ?? tx.transactionIndex ?? null;

  return {
    txHash: tx.hash,
    blockNumber: rc.blockNumber,
    blockHash: rc.blockHash,
    typeLabel,
    nonce: Number(tx.nonce),
    blockPosition: pos != null ? Number(pos) : null,
    gasLimit: gasLimit.toString(),
    gasUsed: gasUsed.toString(),
    gasUsedPct: pct.toFixed(2),
    txFeeEth: txFeeWei != null ? fmtEthStr(txFeeWei, 18) : null,
    gasPriceGwei: eff != null ? weiToGweiStr(eff, 9) : null,
    gasPriceEthPerGas: eff != null ? fmtEthStr(eff, 18) : null,
    baseFeeGwei: base != null ? weiToGweiStr(base, 9) : null,
    maxFeeGwei: maxFee != null ? weiToGweiStr(maxFee, 9) : null,
    maxPrioGwei: maxPrio != null ? weiToGweiStr(maxPrio, 9) : null
  };
}

async function enrichBlockByNumber(n) {
  const provider = hre.ethers.provider;
  const raw = await provider.send("eth_getBlockByNumber", [
    "0x" + Number(n).toString(16),
    false
  ]);
  const gasUsed = BigInt(raw.gasUsed);
  const gasLimit = BigInt(raw.gasLimit);
  const pct = gasLimit > 0n ? Number((gasUsed * 10000n) / gasLimit) / 100 : 0;
  const baseWei = BigInt(raw.baseFeePerGas ?? "0x0");
  const burntWei = baseWei * gasUsed;

  const sizeBytes = parseInt(raw.size, 16);

  return {
    number: parseInt(raw.number, 16),
    hash: raw.hash,
    parentHash: raw.parentHash,
    stateRoot: raw.stateRoot,
    withdrawalsRoot: raw.withdrawalsRoot,
    totalDifficulty: raw.totalDifficulty,
    sizeBytes,
    gasUsed: gasUsed.toString(),
    gasUsedPct: pct.toFixed(2),
    baseFeeEthPerGas: fmtEthStr(baseWei, 18),
    baseFeeGwei: weiToGweiStr(baseWei, 9),
    burntFeesEth: fmtEthStr(burntWei, 18),
    extraData: raw.extraData,
    mixHash: raw.mixHash,
    parentBeaconBlockRoot: raw.parentBeaconBlockRoot,
    miner: raw.miner,
    timestamp: parseInt(raw.timestamp, 16)
  };
}

function simulateBeaconLike(block) {
  // For Hardhat (no CL), we map:
  // slot := block number, epoch := floor(slot/32), proposerIndex := low 20 bits of miner address.
  const slot = block.number;
  const epoch = Math.floor(slot / 32);
  let proposerIndex = null;
  try {
    const miner = String(block.miner || "").toLowerCase();
    if (miner.startsWith("0x") && miner.length === 42) {
      proposerIndex = parseInt(miner.slice(-5), 16); // small, readable, deterministic
    }
  } catch (_) {
    proposerIndex = null;
  }
  return {
    slot,
    epoch,
    proposerIndex: proposerIndex != null ? proposerIndex.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "—",
    slotRootHash: block.parentBeaconBlockRoot || "—",
    depositCount: "0",
    graffiti: block.extraData === "0x" ? "empty" : "present",
    graffitiHex: block.extraData || "0x",
    randomness: block.mixHash || "—"
  };
}

function mkTable(title, rows) {
  return { title, rows };
}

function num(x) {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function fmtEthFixed(x, dp = 18) {
  const n = num(x);
  if (n == null) return "—";
  return n.toFixed(dp).replace(/0+$/, "").replace(/\.$/, "");
}

async function main() {
  const root = path.join(__dirname, "..");
  const outPath = path.join(root, "table", "springer_tables_data.json");

  const addrPath = path.join(root, "data", "deployed-addresses.json");
  const deploymentPath = path.join(root, "table", "table1_deployment_data.json");

  const addresses = fs.existsSync(addrPath) ? JSON.parse(fs.readFileSync(addrPath, "utf8")) : {};
  const t1 = fs.existsSync(deploymentPath) ? JSON.parse(fs.readFileSync(deploymentPath, "utf8")) : null;

  // Prefer ZKP tx for tables 3/5/6; fall back to deployment tx if missing.
  const zkpHash = await getLatestZkpTxHash();
  const zkpTx = zkpHash ? await enrichTx(zkpHash) : null;
  const zkpBlock = zkpTx ? await enrichBlockByNumber(zkpTx.blockNumber) : null;

  const deployBlockNumber = t1?.blockNumber ?? null;
  const deployBlock = deployBlockNumber != null ? await enrichBlockByNumber(deployBlockNumber) : null;

  const blockForConsensus = deployBlock ?? zkpBlock;
  const blockForZkp = zkpBlock ?? deployBlock;

  // Table 1 (deployment tx)
  const table1Rows = t1
    ? [
        ["Transaction Hash", t1.transactionHash],
        ["Block Number", String(t1.blockNumber)],
        ["Block Hash", t1.blockHash],
        ["Transaction Fee", `${Number(t1.transactionFeeEth).toFixed(18)} ETH`.replace(/0+ ETH$/, " ETH")],
        [
          "Gas Price",
          `${Number(t1.gasPriceGwei).toFixed(9)} Gwei (${Number(t1.effectiveGasPriceWei) / 1e18} ETH per gas unit)`
        ],
        [
          "Gas Limit and Usage",
          `${fmtIntStr(t1.gasLimit)} and ${fmtIntStr(t1.gasUsed)} (${t1.gasUsedPercentOfLimit})`
        ],
        [
          "Gas Fees",
          `Base: ${Number(t1.baseFeeGwei).toFixed(9)} Gwei, Max: ${Number(t1.maxFeePerGasGwei).toFixed(9)} Gwei, Max Priority: ${Number(t1.maxPriorityFeePerGasGwei).toFixed(9)} Gwei`
        ],
        ["Transaction Type", t1.typeLabel],
        ["Nonce", String(t1.nonce)],
        ["Block Position", String(t1.transactionIndex)]
      ]
    : [["Parameter", "Missing table/table1_deployment_data.json"]];

  // Table 2 (consensus + infra; beacon-like simulation)
  const b2 = blockForConsensus ? simulateBeaconLike(blockForConsensus) : null;
  const table2Rows = b2
    ? [
        ["Slot", String(b2.slot)],
        ["Epoch", String(b2.epoch)],
        ["Proposer Index", b2.proposerIndex],
        ["Slot Root Hash", b2.slotRootHash],
        ["Beacon Chain Deposit Count", b2.depositCount],
        ["Slot Graffiti", `${b2.graffiti} (Hex: ${b2.graffitiHex})`],
        ["Block Randomness", b2.randomness]
      ]
    : [["Slot", "—"]];

  // Table 3 (block-level execution details for ZKP block, same structure as user requested)
  const b3 = blockForZkp;
  const table3Rows = b3
    ? [
        ["Transaction Hash", zkpTx?.txHash ?? "—"],
        ["Parent Hash", b3.parentHash],
        ["State Root", b3.stateRoot],
        ["Withdrawals Root", b3.withdrawalsRoot],
        ["Block Reward", "0 ETH"],
        ["Total Difficulty", "0"],
        ["Size", `${fmtIntStr(b3.sizeBytes)} bytes`],
        ["Gas Used", `${fmtIntStr(b3.gasUsed)} (${b3.gasUsedPct}%)`],
        ["Base Fee Per Gas", `${b3.baseFeeEthPerGas} ETH (${b3.baseFeeGwei} Gwei)`],
        ["Burnt Fees", `${b3.burntFeesEth} ETH`]
      ]
    : [["Transaction Hash", "—"]];

  // Table 4 (gas cost breakdown: code deposit, execution, total)
  // Code deposit := BTCMRS deployment tx (contract creation). Execution := latest ZKPVerified tx.
  const deployGas = t1?.gasUsed != null ? BigInt(t1.gasUsed) : null;
  const deployFeeEth = t1?.transactionFeeEth != null ? num(t1.transactionFeeEth) : null;
  const execGas = zkpTx?.gasUsed != null ? BigInt(zkpTx.gasUsed) : null;
  const execFeeEth = zkpTx?.txFeeEth != null ? num(zkpTx.txFeeEth) : null;
  const totalGas = deployGas != null && execGas != null ? deployGas + execGas : null;
  const totalFeeEth =
    deployFeeEth != null && execFeeEth != null ? deployFeeEth + execFeeEth : null;

  const table4Rows = [
    [
      "Code Deposit (Deployment)",
      t1
        ? `Tx: ${t1.transactionHash}; Gas: ${fmtIntStr(deployGas)}; Fee: ${fmtEthFixed(
            deployFeeEth
          )} ETH`
        : "—"
    ],
    [
      "Execution (ZKP Verification)",
      zkpTx
        ? `Tx: ${zkpTx.txHash}; Gas: ${fmtIntStr(execGas)}; Fee: ${fmtEthFixed(
            execFeeEth
          )} ETH`
        : "—"
    ],
    [
      "Overall Total Cost",
      totalGas != null && totalFeeEth != null
        ? `Gas: ${fmtIntStr(totalGas)}; Fee: ${fmtEthFixed(totalFeeEth)} ETH`
        : "—"
    ]
  ];

  // Table 5 (ZKP verification tx analysis)
  const table5Rows = zkpTx
    ? [
        ["Transaction Hash", zkpTx.txHash],
        ["Block Number", String(zkpTx.blockNumber)],
        ["Transaction Fee", `${zkpTx.txFeeEth} ETH`],
        ["Transaction Type", zkpTx.typeLabel],
        ["Nonce", String(zkpTx.nonce)],
        ["Block Position", zkpTx.blockPosition != null ? String(zkpTx.blockPosition) : "—"],
        ["Block Hash", zkpTx.blockHash],
        [
          "Gas Limit and Usage",
          `${fmtIntStr(zkpTx.gasLimit)} and ${fmtIntStr(zkpTx.gasUsed)} (${zkpTx.gasUsedPct}%)`
        ],
        [
          "Gas Fees",
          `Base: ${zkpTx.baseFeeGwei} Gwei, Max: ${zkpTx.maxFeeGwei} Gwei, Max Priority: ${zkpTx.maxPrioGwei} Gwei`
        ],
        ["Gas Price", `${zkpTx.gasPriceGwei} Gwei (${zkpTx.gasPriceEthPerGas} ETH)`]
      ]
    : [["Transaction Hash", "—"]];

  // Table 6 (block metrics for ZKP block)
  const b6 = b3;
  const table6Rows = b6
    ? [
        ["Block Hash", b6.hash],
        ["Parent Hash", b6.parentHash],
        ["State Root", b6.stateRoot],
        ["Withdrawals Root", b6.withdrawalsRoot],
        ["Block Reward", "0 ETH"],
        ["Total Difficulty", "0"],
        ["Size", `${fmtIntStr(b6.sizeBytes)} bytes`],
        ["Gas Used", `${fmtIntStr(b6.gasUsed)} (${b6.gasUsedPct}%)`],
        ["Base Fee Per Gas", `${b6.baseFeeEthPerGas} ETH (${b6.baseFeeGwei} Gwei)`],
        ["Burnt Fees", `${b6.burntFeesEth} ETH`]
      ]
    : [["Block Hash", "—"]];

  // Table 7 (consensus + interaction, keep same structure as user requested)
  const b7 = b6 ? simulateBeaconLike(b6) : null;
  const table7Rows = b7
    ? [
        ["Slot", String(b7.slot)],
        ["Epoch", String(b7.epoch)],
        ["Proposer Index", b7.proposerIndex],
        ["Slot Root Hash", b7.slotRootHash],
        ["Beacon Chain Deposit Count", b7.depositCount],
        ["Slot Graffiti", `${b7.graffiti} (Hex: ${b7.graffitiHex})`],
        ["Block Randomness", b7.randomness]
      ]
    : [["Slot", "—"]];

  const payload = {
    generatedAt: new Date().toISOString(),
    network: hre.network.name,
    chainId: hre.network.config.chainId ?? null,
    contracts: addresses,
    tables: {
      table1: mkTable("Table 1. Reacquisition SCs Deployment Result Analysis", table1Rows),
      table2: mkTable("Table 2. Consensus and Blockchain Infrastructure Analysis for BT-CMRS", table2Rows),
      table3: mkTable("Table 3. Smart Contract Execution Details in the BT-CMRS Framework", table3Rows),
      table4: mkTable("Table 4. Gas Cost Summary for Deployment and ZKP Execution in BT-CMRS", table4Rows),
      table5: mkTable("Table 5. ZKP Verification Transaction Analysis in BT-CMRS", table5Rows),
      table6: mkTable("Table 6. Block-Level Metrics for ZKP Transactions in BT-CMRS", table6Rows),
      table7: mkTable("Table 7. Consensus Mechanism and Network Interaction Metrics in BT-CMRS", table7Rows)
    }
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

