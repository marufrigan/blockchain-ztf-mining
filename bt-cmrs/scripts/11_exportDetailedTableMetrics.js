/**
 * Exports rich tx/block fields for Section 4 tables (paper-style Parameter/Result).
 * Run: npx hardhat run scripts/11_exportDetailedTableMetrics.js --network localhost
 * For Sepolia: same with --network sepolia (requires .env RPC + key).
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function weiToGwei(wei) {
  if (wei == null) return null;
  const w = BigInt(wei);
  return Number(w) / 1e9;
}

function fmtEth(wei) {
  if (wei == null) return "";
  return hre.ethers.formatEther(wei);
}

async function enrichTx(txHash) {
  const provider = hre.ethers.provider;
  const tx = await provider.getTransaction(txHash);
  if (!tx) throw new Error(`Transaction not found: ${txHash}`);
  const rc = await provider.getTransactionReceipt(txHash);
  const block = await provider.getBlock(rc.blockNumber);

  const gasLimit = tx.gasLimit;
  const gasUsed = rc.gasUsed;
  const pct = gasLimit > 0n ? Number((gasUsed * 10000n) / gasLimit) / 100 : 0;

  let effectiveGasPrice = rc.gasPrice ?? null;
  if (effectiveGasPrice == null && rc.gasUsed != null) {
    effectiveGasPrice = rc.effectiveGasPrice ?? null;
  }

  const txFeeWei = effectiveGasPrice != null ? gasUsed * effectiveGasPrice : null;

  const baseFee = block.baseFeePerGas ?? null;
  const maxFee = tx.maxFeePerGas ?? null;
  const maxPrio = tx.maxPriorityFeePerGas ?? null;

  const pos =
    rc.index != null
      ? rc.index
      : tx.transactionIndex != null
        ? tx.transactionIndex
        : null;

  return {
    transactionHash: tx.hash,
    blockNumber: rc.blockNumber,
    blockHash: rc.blockHash,
    transactionIndex: pos,
    from: tx.from,
    to: tx.to,
    nonce: Number(tx.nonce),
    type: tx.type != null ? Number(tx.type) : null,
    typeLabel:
      tx.type === 2 || tx.type === "0x2"
        ? "2 (EIP-1559)"
        : tx.type === 0 || tx.type === "0x0"
          ? "0 (Legacy)"
          : tx.type != null
            ? String(tx.type)
            : "—",
    gasLimit: gasLimit.toString(),
    gasUsed: gasUsed.toString(),
    gasUsedPercentOfLimit: `${pct.toFixed(2)}%`,
    gasPriceWei: tx.gasPrice != null ? tx.gasPrice.toString() : null,
    maxFeePerGas: maxFee != null ? maxFee.toString() : null,
    maxPriorityFeePerGas: maxPrio != null ? maxPrio.toString() : null,
    effectiveGasPriceWei: effectiveGasPrice != null ? effectiveGasPrice.toString() : null,
    gasPriceGwei: effectiveGasPrice != null ? weiToGwei(effectiveGasPrice).toFixed(9) : null,
    baseFeePerGasWei: baseFee != null ? baseFee.toString() : null,
    baseFeeGwei: baseFee != null ? weiToGwei(baseFee).toFixed(9) : null,
    maxFeePerGasGwei: maxFee != null ? weiToGwei(maxFee).toFixed(9) : null,
    maxPriorityFeePerGasGwei: maxPrio != null ? weiToGwei(maxPrio).toFixed(9) : null,
    transactionFeeEth: txFeeWei != null ? fmtEth(txFeeWei) : null,
    chainId: Number(tx.chainId),
    cumulativeGasUsed: rc.cumulativeGasUsed != null ? rc.cumulativeGasUsed.toString() : null,
    status: rc.status != null ? (rc.status === 1 ? "success" : "failed") : "—",
    block: block
      ? {
          hash: block.hash,
          parentHash: block.parentHash,
          number: block.number,
          timestamp: block.timestamp,
          gasLimit: block.gasLimit.toString(),
          gasUsed: block.gasUsed.toString(),
          baseFeePerGas: block.baseFeePerGas != null ? block.baseFeePerGas.toString() : null,
          difficulty: block.difficulty != null ? block.difficulty.toString() : null,
          totalDifficulty: block.totalDifficulty != null ? block.totalDifficulty.toString() : null,
          stateRoot: block.stateRoot != null ? block.stateRoot : null,
          receiptsRoot: block.receiptsRoot != null ? block.receiptsRoot : null,
          withdrawalsRoot: block.withdrawalsRoot != null ? block.withdrawalsRoot : null
        }
      : null
  };
}

async function main() {
  const root = path.join(__dirname, "..");
  const eventPath = path.join(root, "docs", "EVENT_LOGS.json");
  const addrPath = path.join(root, "data", "deployed-addresses.json");

  if (!fs.existsSync(eventPath)) {
    console.error("Missing docs/EVENT_LOGS.json — run workflow + 09_exportEventLogs first.");
    process.exit(1);
  }

  const events = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const zkp = events.find((e) => e.event === "ZKPVerified");
  if (!zkp) {
    console.error("No ZKPVerified event in EVENT_LOGS.json");
    process.exit(1);
  }

  const addresses = fs.existsSync(addrPath) ? JSON.parse(fs.readFileSync(addrPath, "utf8")) : {};

  const txDetail = await enrichTx(zkp.transactionHash);
  const blockDetail = txDetail.block;

  const blockGasPct =
    blockDetail && BigInt(blockDetail.gasLimit) > 0n
      ? (
          (Number((BigInt(blockDetail.gasUsed) * 10000n) / BigInt(blockDetail.gasLimit)) /
            100)
        ).toFixed(2)
      : null;

  const burntFeesEth =
    blockDetail && blockDetail.baseFeePerGas && blockDetail.gasUsed
      ? fmtEth(BigInt(blockDetail.baseFeePerGas) * BigInt(blockDetail.gasUsed))
      : null;

  const out = {
    network: hre.network.name,
    chainId: txDetail.chainId,
    contracts: addresses,
    zkpTransaction: txDetail,
    zkpBlock: {
      ...blockDetail,
      gasUsedPercentOfBlockLimit: blockGasPct != null ? `${blockGasPct}%` : null,
      burntFeesEth: burntFeesEth,
      parentHash: blockDetail?.parentHash ?? "—",
      stateRoot:
        blockDetail?.stateRoot ??
        "N/A (not returned by provider)",
      withdrawalsRoot:
        blockDetail?.withdrawalsRoot ??
        "N/A (post-merge field; use Sepolia/Mainnet full block)",
      receiptsRoot: blockDetail?.receiptsRoot ?? "—"
    },
    beacon: {
      note:
        "Beacon Chain fields (Slot, Epoch, Proposer Index, Graffiti, RANDAO) require Sepolia/Ethereum + consensus-layer API or explorer export — N/A on local Hardhat."
    }
  };

  const outPath = path.join(root, "table", "detailed_table_data.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
