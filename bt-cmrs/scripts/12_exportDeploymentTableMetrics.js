/**
 * Locates the BTCMRS (reacquisition registry) contract-creation transaction and exports
 * fields for Table 1 (deployment result analysis).
 *
 * Run: npx hardhat run scripts/12_exportDeploymentTableMetrics.js --network localhost
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function weiToGwei(wei) {
  if (wei == null) return null;
  return Number(BigInt(wei)) / 1e9;
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
    nonce: Number(tx.nonce),
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
    effectiveGasPriceWei: effectiveGasPrice != null ? effectiveGasPrice.toString() : null,
    gasPriceGwei: effectiveGasPrice != null ? weiToGwei(effectiveGasPrice) : null,
    baseFeeGwei: baseFee != null ? weiToGwei(baseFee) : null,
    maxFeePerGasGwei: maxFee != null ? weiToGwei(maxFee) : null,
    maxPriorityFeePerGasGwei: maxPrio != null ? weiToGwei(maxPrio) : null,
    transactionFeeEth: txFeeWei != null ? fmtEth(txFeeWei) : null
  };
}

async function findDeploymentTxHash(provider, contractAddress) {
  const target = contractAddress.toLowerCase();
  const latest = await provider.getBlockNumber();
  for (let b = 0n; b <= latest; b++) {
    const block = await provider.getBlock(b, true);
    if (!block || !block.transactions) continue;
    for (const t of block.transactions) {
      if (typeof t === "string") continue;
      if (t.to != null) continue;
      const receipt = await provider.getTransactionReceipt(t.hash);
      if (
        receipt &&
        receipt.contractAddress &&
        receipt.contractAddress.toLowerCase() === target
      ) {
        return t.hash;
      }
    }
  }
  return null;
}

async function main() {
  const root = path.join(__dirname, "..");
  const addrPath = path.join(root, "data", "deployed-addresses.json");
  if (!fs.existsSync(addrPath)) {
    console.error("Missing data/deployed-addresses.json — run scripts/01_deploy.js first.");
    process.exit(1);
  }
  const addresses = JSON.parse(fs.readFileSync(addrPath, "utf8"));
  const btcMrs = addresses.btcMrs;
  if (!btcMrs) {
    console.error("No btcMrs in deployed-addresses.json");
    process.exit(1);
  }

  const provider = hre.ethers.provider;
  let txHash = addresses.btcMrsDeploymentTxHash || null;
  if (!txHash) {
    txHash = await findDeploymentTxHash(provider, btcMrs);
  }
  if (!txHash) {
    console.error(
      `No btcMrsDeploymentTxHash in deployed-addresses.json and scan failed for ${btcMrs}. Redeploy with scripts/01_deploy.js.`
    );
    process.exit(1);
  }

  const detail = await enrichTx(txHash);
  const outPath = path.join(root, "table", "table1_deployment_data.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        label: "BTCMRS (reacquisition registry) deployment transaction",
        network: hre.network.name,
        ...detail
      },
      null,
      2
    )
  );
  console.log("Wrote", outPath, "hash", txHash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
