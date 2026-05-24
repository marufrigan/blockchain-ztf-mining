const hre = require("hardhat");
const path = require("path");
const { loadAddresses, readJSON, writeJSON } = require("./helpers");
const circomlibjs = require("circomlibjs");

function asBytes32(hexOrText) {
  if (hexOrText.startsWith("0x") && hexOrText.length === 66) return hexOrText;
  return hre.ethers.keccak256(hre.ethers.toUtf8Bytes(hexOrText));
}

async function main() {
  const poseidon = await circomlibjs.buildPoseidon();
  const addresses = loadAddresses();
  const [, mine, , , , auditor] = await hre.ethers.getSigners();
  const btcMrs = await hre.ethers.getContractAt("BTCMRS", addresses.btcMrs);
  const regions = readJSON(path.join(__dirname, "..", "data", "regions.json"));
  const batches = readJSON(path.join(__dirname, "..", "data", "batches.json"));

  for (const region of regions) {
    const regionField = poseidon.F.toString(
      poseidon([BigInt(region.minX), BigInt(region.maxX), BigInt(region.minY), BigInt(region.maxY)])
    );
    const regionHash = hre.ethers.toBeHex(BigInt(regionField), 32);
    const tx = await btcMrs.connect(auditor).approveRegion(regionHash);
    await tx.wait();
  }

  const created = [];
  const regionByInput = new Map();
  for (const r of regions) regionByInput.set(r.regionHashInput, r);
  for (const batch of batches) {
    const certHash = asBytes32(batch.certificationInput);
    const commitmentField = poseidon.F.toString(poseidon([BigInt(batch.x), BigInt(batch.y), BigInt(batch.r)]));
    const commitment = hre.ethers.toBeHex(BigInt(commitmentField), 32);
    const region = regionByInput.get(batch.regionHashInput);
    if (!region) throw new Error(`Unknown region reference: ${batch.regionHashInput}`);
    // Align on-chain region id with circuit constraint: regionHash = Poseidon(minX,maxX,minY,maxY)
    const regionField = poseidon.F.toString(
      poseidon([BigInt(region.minX), BigInt(region.maxX), BigInt(region.minY), BigInt(region.maxY)])
    );
    const regionHash = hre.ethers.toBeHex(BigInt(regionField), 32);
    const tx = await btcMrs
      .connect(mine)
      .createBatch(batch.mineralType, certHash, commitment, regionHash, batch.metadataURI);
    const rc = await tx.wait();
    const event = rc.logs
      .map((x) => {
        try {
          return btcMrs.interface.parseLog(x);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "BatchCreated");
    created.push({
      batchId: event.args.batchId,
      regionHash,
      geoCommitment: commitment,
      x: batch.x,
      y: batch.y,
      r: batch.r
    });
    console.log("Created batch:", event.args.batchId);
  }

  writeJSON(path.join(__dirname, "..", "data", "created-batches.json"), created);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
