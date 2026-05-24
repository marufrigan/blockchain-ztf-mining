/**
 * GeoZK-Miner — ZKP artifact file sizes (bytes) and metadata where available.
 *
 * Run: npx hardhat run scripts/17_measureZKPArtifactSizes.js --network hardhat
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const FRAMEWORK = "GeoZK-Miner";

function fmtBytes(n) {
  if (n == null) return "n/a";
  const kb = n / 1024;
  const mb = kb / 1024;
  if (mb >= 1) return `${n} bytes (${mb.toFixed(3)} MB)`;
  return `${n} bytes (${kb.toFixed(2)} KB)`;
}

function statPath(p) {
  if (!fs.existsSync(p)) return null;
  return fs.statSync(p).size;
}

function main() {
  const snarkjsBin = path.join(ROOT, "node_modules", ".bin", "snarkjs");
  const r1csPath = path.join(ROOT, "circuits", "build", "regionProof", "regionProof.r1cs");
  const wasmPath = path.join(ROOT, "circuits", "build", "regionProof", "regionProof_js", "regionProof.wasm");
  const zkeyPath = path.join(ROOT, "circuits", "regionProof_final.zkey");
  const vkPath = path.join(ROOT, "circuits", "verification_key.json");
  const verifierSol = path.join(ROOT, "contracts", "RegionProofVerifier.sol");

  let proofJsonPath = null;
  let publicJsonPath = null;
  const dataProofs = path.join(ROOT, "data", "proofs.json");
  if (fs.existsSync(dataProofs)) {
    const arr = JSON.parse(fs.readFileSync(dataProofs, "utf8"));
    if (arr.length) {
      fs.mkdirSync(path.join(ROOT, "data", ".artifact_probe"), { recursive: true });
      proofJsonPath = path.join(ROOT, "data", ".artifact_probe", "proof_sample.json");
      publicJsonPath = path.join(ROOT, "data", ".artifact_probe", "public_sample.json");
      fs.writeFileSync(proofJsonPath, JSON.stringify(arr[0].proof, null, 2));
      fs.writeFileSync(publicJsonPath, JSON.stringify(arr[0].publicSignals, null, 2));
    }
  }

  let r1csInfo = null;
  let constraints = null;
  let wires = null;
  if (fs.existsSync(r1csPath) && fs.existsSync(snarkjsBin)) {
    try {
      r1csInfo = execSync(`"${snarkjsBin}" r1cs info "${r1csPath}"`, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      const cMatch = r1csInfo.match(/# of Constraints:\s*(\d+)/);
      const wMatch = r1csInfo.match(/# of Wires:\s*(\d+)/);
      if (cMatch) constraints = Number(cMatch[1]);
      if (wMatch) wires = Number(wMatch[1]);
    } catch (e) {
      r1csInfo = `snarkjs r1cs info failed: ${e.message}`;
    }
  }

  const vk = JSON.parse(fs.readFileSync(vkPath, "utf8"));
  const nPublic = vk.nPublic != null ? vk.nPublic : null;

  const artifacts = [
    {
      artifact: "Groth16 proof JSON (sample from data/proofs.json if present)",
      filePath: proofJsonPath || "not available (run 04_generateProofs.js first)",
      sizeBytes: proofJsonPath ? statPath(proofJsonPath) : null,
      relevance: "Wire-format proof payload size for storage/transmission estimates."
    },
    {
      artifact: "Public signals JSON (sample)",
      filePath: publicJsonPath || "not available",
      sizeBytes: publicJsonPath ? statPath(publicJsonPath) : null,
      relevance: "On-chain public signal vector size (six public inputs for region circuit)."
    },
    {
      artifact: "verification_key.json",
      filePath: vkPath,
      sizeBytes: statPath(vkPath),
      relevance: "Verifier key for snarkjs off-chain verification."
    },
    {
      artifact: "regionProof_final.zkey",
      filePath: zkeyPath,
      sizeBytes: statPath(zkeyPath),
      relevance: "Groth16 proving key (trusted-setup artifact)."
    },
    {
      artifact: "regionProof.wasm",
      filePath: wasmPath,
      sizeBytes: statPath(wasmPath),
      relevance: "Witness generation WASM for Circom circuit."
    },
    {
      artifact: "regionProof.r1cs",
      filePath: r1csPath,
      sizeBytes: statPath(r1csPath),
      relevance: "Rank-1 constraint system binary."
    },
    {
      artifact: "RegionProofVerifier.sol",
      filePath: verifierSol,
      sizeBytes: statPath(verifierSol),
      relevance: "On-chain verifier contract source file size (proxy for deployment bytecode scale)."
    }
  ];

  const summary = {
    framework: FRAMEWORK,
    timestamp: new Date().toISOString(),
    circuit: {
      nPublicFromVerificationKey: nPublic,
      constraintsFromSnarkjsR1csInfo: constraints,
      wiresFromSnarkjsR1csInfo: wires,
      r1csInfoStdout: r1csInfo
    },
    artifacts: artifacts.map((a) => ({
      ...a,
      sizeLabel: a.sizeBytes != null ? fmtBytes(a.sizeBytes) : "Not measured"
    }))
  };

  fs.writeFileSync(path.join(ROOT, "docs", "ZKP_ARTIFACT_SIZE_ANALYSIS.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ROOT, "table", "zkp_artifact_size_summary.json"), JSON.stringify(summary, null, 2));

  const md = `# GeoZK-Miner — ZKP Artifact Size Analysis

**Framework:** ${FRAMEWORK}  
**Generated:** ${summary.timestamp}

## Circuit metadata

| Field | Value |
|--------|------:|
| Public signals (from \`verification_key.json\`) | ${nPublic ?? "Not found"} |
| Constraints (from \`snarkjs r1cs info\`) | ${constraints ?? "Not recorded"} |
| Wires (from \`snarkjs r1cs info\`) | ${wires ?? "Not recorded"} |

## Artifact sizes

| Artifact | Path | Size |
|----------|------|------|
${artifacts
  .map((a) => {
    const sz = a.sizeBytes != null ? fmtBytes(a.sizeBytes) : "_not measured_";
    return `| ${a.artifact} | \`${a.filePath}\` | ${sz} |`;
  })
  .join("\n")}

## R1CS info (stdout)

\`\`\`text
${r1csInfo ? String(r1csInfo).slice(0, 4000) : "Not available"}
\`\`\`
`;

  fs.writeFileSync(path.join(ROOT, "docs", "ZKP_ARTIFACT_SIZE_ANALYSIS.md"), md);

  console.log("\n========== GeoZK-Miner — ZKP artifact sizes ==========");
  for (const a of summary.artifacts) {
    console.log(`${a.artifact}: ${a.sizeLabel}`);
  }
  console.log("Written: docs/ZKP_ARTIFACT_SIZE_ANALYSIS.json");
  console.log("Written: docs/ZKP_ARTIFACT_SIZE_ANALYSIS.md");
  console.log("Written: table/zkp_artifact_size_summary.json");
  console.log("====================================================\n");
}

main();
