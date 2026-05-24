/**
 * GeoZK-Miner — Optional Sepolia smoke test (minimal public testnet slice).
 *
 * Run: npx hardhat run scripts/18_runSepoliaSmokeTest.js --network sepolia
 *
 * Requires .env: SEPOLIA_RPC_URL, PRIVATE_KEY (non-empty).
 * Uses one funded EOA for admin + mine + auditor (separate roles on same address) to avoid extra funding txs.
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const circomlibjs = require("circomlibjs");
const snarkjs = require("snarkjs");

const ROOT = path.join(__dirname, "..");
const FRAMEWORK = "GeoZK-Miner";

function explorerTx(hash) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

function writeSkipped(reason) {
  const md = `# GeoZK-Miner — Sepolia Smoke Test

**Status:** Not executed.

${reason}

Sepolia testnet execution was not performed because RPC credentials/private key were not available.

**Framework:** ${FRAMEWORK}
`;
  const payload = {
    framework: FRAMEWORK,
    executed: false,
    reason,
    timestamp: new Date().toISOString()
  };
  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "table"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "docs", "SEPOLIA_SMOKE_TEST_RESULTS.md"), md);
  fs.writeFileSync(path.join(ROOT, "docs", "SEPOLIA_SMOKE_TEST_RESULTS.json"), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(ROOT, "table", "sepolia_smoke_test_summary.json"), JSON.stringify(payload, null, 2));
  console.log(`[${FRAMEWORK}] Sepolia smoke test skipped: ${reason}`);
}

function pushRow(rows, op, rc) {
  const egp = rc.gasPrice ?? rc.effectiveGasPrice ?? 0n;
  const feeEth = hre.ethers.formatEther(rc.gasUsed * egp);
  const txHash = rc.hash ?? rc.logs?.[0]?.transactionHash ?? "";
  rows.push({
    operation: op,
    transactionHash: txHash,
    blockNumber: rc.blockNumber,
    gasUsed: rc.gasUsed.toString(),
    transactionFeeEth: feeEth,
    explorerLink: explorerTx(txHash),
    status: rc.status === 1 ? "success" : String(rc.status)
  });
}

async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL && String(process.env.SEPOLIA_RPC_URL).trim();
  const pk = process.env.PRIVATE_KEY && String(process.env.PRIVATE_KEY).trim();
  if (!rpc || !pk) {
    writeSkipped("Missing SEPOLIA_RPC_URL or PRIVATE_KEY in environment (.env).");
    return;
  }

  if (hre.network.name !== "sepolia") {
    writeSkipped(`Network is "${hre.network.name}" — run with --network sepolia for live Sepolia results.`);
    return;
  }

  const rows = [];
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();

  try {
    const Registry = await hre.ethers.getContractFactory("StakeholderRegistry");
    const registry = await Registry.deploy(deployer.address);
    pushRow(rows, "Deploy StakeholderRegistry", await registry.deploymentTransaction().wait());

    const Verifier = await hre.ethers.getContractFactory("RegionProofVerifier");
    const verifier = await Verifier.deploy();
    pushRow(rows, "Deploy RegionProofVerifier", await verifier.deploymentTransaction().wait());

    const BTCMRS = await hre.ethers.getContractFactory("BTCMRS");
    const btcMrs = await BTCMRS.deploy(await registry.getAddress(), await verifier.getAddress());
    pushRow(rows, "Deploy core registry (GeoZK-Miner prototype contract)", await btcMrs.deploymentTransaction().wait());

    const MINE = await registry.MINE_ROLE();
    const AUDITOR = await registry.AUDITOR_ROLE();

    pushRow(
      rows,
      "Register mine role (same EOA as smoke actor)",
      await (await registry.registerStakeholder(deployer.address, MINE, "Mine", "ipfs://m")).wait()
    );
    pushRow(
      rows,
      "Register auditor role (same EOA)",
      await (await registry.registerStakeholder(deployer.address, AUDITOR, "Auditor", "ipfs://a")).wait()
    );

    const poseidon = await circomlibjs.buildPoseidon();
    const region = { minX: 100, maxX: 250, minY: 300, maxY: 450 };
    const x = 150;
    const y = 350;
    const r = 1000;
    const regionField = poseidon.F.toString(
      poseidon([BigInt(region.minX), BigInt(region.maxX), BigInt(region.minY), BigInt(region.maxY)])
    );
    const regionHash = hre.ethers.toBeHex(BigInt(regionField), 32);
    const commitmentField = poseidon.F.toString(poseidon([BigInt(x), BigInt(y), BigInt(r)]));
    const geoCommitment = hre.ethers.toBeHex(BigInt(commitmentField), 32);

    pushRow(rows, "Approve region (auditor)", await (await btcMrs.connect(deployer).approveRegion(regionHash)).wait());

    const certHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("sepolia-smoke-cert"));
    const rcCreate = await (
      await btcMrs.connect(deployer).createBatch(0, certHash, geoCommitment, regionHash, "ipfs://sepolia-smoke")
    ).wait();
    pushRow(rows, "Create mineral batch (mine)", rcCreate);

    const ev = rcCreate.logs
      .map((l) => {
        try {
          return btcMrs.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "BatchCreated");
    const batchId = ev.args.batchId;

    const wasmPath = path.join(ROOT, "circuits", "build", "regionProof", "regionProof_js", "regionProof.wasm");
    const zkeyPath = path.join(ROOT, "circuits", "regionProof_final.zkey");
    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
      throw new Error("Missing circuit wasm/zkey for Sepolia ZKP step.");
    }
    const witnessInput = {
      x: String(x),
      y: String(y),
      r: String(r),
      minX: String(region.minX),
      maxX: String(region.maxX),
      minY: String(region.minY),
      maxY: String(region.maxY),
      regionHash: BigInt(regionHash).toString(),
      commitment: BigInt(geoCommitment).toString()
    };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(witnessInput, wasmPath, zkeyPath);
    const proofA = [proof.pi_a[0], proof.pi_a[1]];
    const proofB = [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]]
    ];
    const proofC = [proof.pi_c[0], proof.pi_c[1]];
    const signals = publicSignals.map((s) => BigInt(s));

    const rcV = await (
      await btcMrs.connect(deployer).verifyAndRegisterBatch(batchId, proofA, proofB, proofC, signals)
    ).wait();
    pushRow(rows, "verifyAndRegisterBatch (region ZKP on-chain)", rcV);

    const out = {
      framework: FRAMEWORK,
      executed: true,
      disclaimer:
        "Smoke test only; not large-scale public evaluation. Region compliance uses on-chain ZKP; certification is hash-only in the main path.",
      timestamp: new Date().toISOString(),
      network: hre.network.name,
      chainId: Number(net.chainId),
      deployer: deployer.address,
      contracts: {
        registry: await registry.getAddress(),
        verifier: await verifier.getAddress(),
        coreRegistry: await btcMrs.getAddress()
      },
      transactions: rows
    };

    fs.writeFileSync(path.join(ROOT, "docs", "SEPOLIA_SMOKE_TEST_RESULTS.json"), JSON.stringify(out, null, 2));
    fs.writeFileSync(path.join(ROOT, "table", "sepolia_smoke_test_summary.json"), JSON.stringify(out, null, 2));

    const md = `# GeoZK-Miner — Sepolia Smoke Test Results

**Framework:** ${FRAMEWORK}  
**Network:** ${out.network} (chainId ${out.chainId})  
**Generated:** ${out.timestamp}

## Contract addresses

| Contract | Address |
|----------|---------|
| StakeholderRegistry | \`${out.contracts.registry}\` |
| RegionProofVerifier | \`${out.contracts.verifier}\` |
| Core registry | \`${out.contracts.coreRegistry}\` |

## Transactions

| Operation | Tx hash | Block | Gas | Fee (ETH) | Explorer |
|-----------|---------|------:|----:|----------:|-----------|
${rows
  .map(
    (r) =>
      `| ${r.operation} | \`${r.transactionHash}\` | ${r.blockNumber} | ${r.gasUsed} | ${r.transactionFeeEth} | [Etherscan](${r.explorerLink}) |`
  )
  .join("\n")}
`;
    fs.writeFileSync(path.join(ROOT, "docs", "SEPOLIA_SMOKE_TEST_RESULTS.md"), md);
    console.log(`[${FRAMEWORK}] Sepolia smoke test completed. See docs/SEPOLIA_SMOKE_TEST_RESULTS.md`);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const partial = {
      framework: FRAMEWORK,
      executed: false,
      error: msg,
      partialTransactions: rows,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(path.join(ROOT, "docs", "SEPOLIA_SMOKE_TEST_RESULTS.json"), JSON.stringify(partial, null, 2));
    fs.writeFileSync(
      path.join(ROOT, "docs", "SEPOLIA_SMOKE_TEST_RESULTS.md"),
      `# GeoZK-Miner — Sepolia Smoke Test\n\n**Status:** Failed\n\n${msg}\n`
    );
    fs.writeFileSync(path.join(ROOT, "table", "sepolia_smoke_test_summary.json"), JSON.stringify(partial, null, 2));
    console.error(e);
    process.exitCode = 1;
  }
}

main();
