const hre = require("hardhat");
const path = require("path");
const { loadAddresses, readJSON } = require("./helpers");

function toBytes32Uint(hex) {
  return BigInt(hex).toString();
}

async function main() {
  const addresses = loadAddresses();
  const [, , , , , auditor] = await hre.ethers.getSigners();
  const btcMrs = await hre.ethers.getContractAt("BTCMRS", addresses.btcMrs);
  const proofs = readJSON(path.join(__dirname, "..", "data", "proofs.json"));

  for (const p of proofs) {
    const proofA = [p.proof.pi_a[0], p.proof.pi_a[1]];
    const proofB = [
      [p.proof.pi_b[0][1], p.proof.pi_b[0][0]],
      [p.proof.pi_b[1][1], p.proof.pi_b[1][0]]
    ];
    const proofC = [p.proof.pi_c[0], p.proof.pi_c[1]];
    // Public signal order must remain:
    // [minX, maxX, minY, maxY, regionHash, commitment]
    const signals = p.publicSignals.map((s) => BigInt(s));

    const tx = await btcMrs.connect(auditor).verifyAndRegisterBatch(p.batchId, proofA, proofB, proofC, signals);
    await tx.wait();
    console.log("Verified batch", p.batchId);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
