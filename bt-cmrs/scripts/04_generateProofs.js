const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function requireFile(filePath, message) {
  if (!fs.existsSync(filePath)) throw new Error(message);
}

function main() {
  const root = path.join(__dirname, "..");
  const snarkjsBin = path.join(root, "node_modules", ".bin", "snarkjs");
  const regions = JSON.parse(fs.readFileSync(path.join(root, "data", "regions.json"), "utf8"));
  const region = regions[0];
  const created = JSON.parse(fs.readFileSync(path.join(root, "data", "created-batches.json"), "utf8"));

  const wasmPath = path.join(root, "circuits", "build", "regionProof", "regionProof_js", "regionProof.wasm");
  const zkeyPath = path.join(root, "circuits", "regionProof_final.zkey");
  requireFile(wasmPath, "Missing circuit wasm. Run npm run circuits:compile first.");
  requireFile(zkeyPath, "Missing regionProof_final.zkey. Run npm run circuits:compile first.");

  const outputs = [];
  for (let i = 0; i < created.length; i++) {
    const witness = {
      x: created[i].x,
      y: created[i].y,
      r: created[i].r,
      minX: region.minX,
      maxX: region.maxX,
      minY: region.minY,
      maxY: region.maxY,
      regionHash: BigInt(created[i].regionHash).toString(),
      commitment: BigInt(created[i].geoCommitment).toString()
    };

    const tempInput = path.join(root, "data", `proof-input-${i}.json`);
    const tempProof = path.join(root, "data", `proof-${i}.json`);
    const tempSignals = path.join(root, "data", `public-${i}.json`);
    fs.writeFileSync(tempInput, JSON.stringify(witness, null, 2));

    execSync(`"${snarkjsBin}" groth16 fullprove "${tempInput}" "${wasmPath}" "${zkeyPath}" "${tempProof}" "${tempSignals}"`, {
      stdio: "inherit"
    });

    const proof = JSON.parse(fs.readFileSync(tempProof, "utf8"));
    const publicSignals = JSON.parse(fs.readFileSync(tempSignals, "utf8"));
    outputs.push({ batchId: created[i].batchId, proof, publicSignals });
  }

  fs.writeFileSync(path.join(root, "data", "proofs.json"), JSON.stringify(outputs, null, 2));
  console.log("Generated real Groth16 proofs in data/proofs.json");
}

main();
