/**
 * GeoZK-Miner end-to-end evaluation on a local Hardhat node.
 *
 *   npx hardhat node                                   (terminal 1)
 *   npx hardhat run scripts/runEvaluation.js --network localhost   (terminal 2)
 *
 * Every number written to results/ comes from a transaction receipt, a block,
 * a file on disk or a wall-clock timer in this script. Nothing is modelled.
 *
 * Experiments
 *   E1  deployment cost and bytecode size
 *   E2  annotated end-to-end workflow trace with decoded event logs
 *   E3  per-operation gas and latency over N independent batches (fresh proof each)
 *   E4  off-chain witness / proving / verification time (from E3)
 *   E5  ZKP artefact sizes
 *   E6  concurrent load: batch creation and ZKP verification under automine
 *   E7  concurrent load under 12 s interval block production
 */
const hre = require("hardhat");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const lib = require("./lib/geozk");

const N_BATCHES = Number(process.env.N_BATCHES || 200);
const LOAD_LEVELS_CREATE = [1, 2, 4, 8, 16, 32, 64, 128];
const LOAD_TX_PER_CLIENT = 5;
const LOAD_LEVELS_ZKP = [1, 2, 4, 8, 16, 32];
const ZKP_TX_PER_CLIENT = 2;
const INTERVAL_BURSTS = [1, 32, 64, 128, 192, 256];
const BLOCK_INTERVAL_MS = 12000;

const REGION_DEG = { latMin: -3.0, latMax: -2.0, lonMin: 28.0, lonMax: 29.0 };
const OUT = path.join(lib.ROOT, "results");
fs.mkdirSync(OUT, { recursive: true });

const provider = hre.ethers.provider;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const write = (name, obj) =>
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n > 1 ? n - 1 : 1));
  const q = (p) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return v[lo] + (v[hi] - v[lo]) * (idx - lo);
  };
  return { n, mean, sd, min: v[0], max: v[n - 1], median: q(0.5), p90: q(0.9), p95: q(0.95), p99: q(0.99) };
}

const gasCache = new Map();

/** Sends a contract call from an unlocked node account and waits for its receipt. */
async function send(contract, signerAddress, method, args, pollMs = 2) {
  const data = contract.interface.encodeFunctionData(method, args);
  const to = await contract.getAddress();
  // Gas limit = node estimate + 10%, as a wallet would set it. The estimate is taken
  // once per function (execution cost is constant to within a few gas units) and is
  // not part of the timed interval.
  if (!gasCache.has(method)) {
    const est = BigInt(await provider.send("eth_estimateGas", [{ from: signerAddress, to, data }]));
    gasCache.set(method, (est * 110n) / 100n);
  }
  const gas = gasCache.get(method);
  const t0 = process.hrtime.bigint();
  const hash = await provider.send("eth_sendTransaction", [
    { from: signerAddress, to, data, gas: "0x" + gas.toString(16) }
  ]);
  let receipt = null;
  while (!receipt) {
    receipt = await provider.getTransactionReceipt(hash);
    if (!receipt) await sleep(pollMs);
  }
  const latencyMs = lib.hrMs(t0);
  if (receipt.status !== 1) throw new Error(`${method} reverted (${hash})`);
  return { hash, receipt, latencyMs };
}

async function describeReceipt(label, actorRole, r, contracts) {
  const tx = await provider.getTransaction(r.hash);
  const block = await provider.getBlock(r.receipt.blockNumber);
  const events = lib.parseEvents(contracts, r.receipt).map((e) => ({
    contract: e.contract,
    address: e.address,
    logIndex: e.logIndex,
    name: e.parsed.name,
    signature: e.parsed.signature,
    topics: e.log.topics,
    data: e.log.data,
    args: Object.fromEntries(
      e.parsed.fragment.inputs.map((inp, i) => [inp.name, e.parsed.args[i]])
    )
  }));
  return {
    step: label,
    actorRole,
    transactionHash: r.hash,
    status: r.receipt.status === 1 ? "Success" : "Reverted",
    blockNumber: r.receipt.blockNumber,
    blockTimestamp: block.timestamp,
    blockTimestampISO: new Date(block.timestamp * 1000).toISOString(),
    from: tx.from,
    to: tx.to,
    nonce: tx.nonce,
    gasLimit: tx.gasLimit,
    gasUsed: r.receipt.gasUsed,
    effectiveGasPriceWei: r.receipt.gasPrice,
    feeWei: r.receipt.gasUsed * r.receipt.gasPrice,
    latencyMs: r.latencyMs,
    events
  };
}

function fileSize(p) {
  return fs.existsSync(p) ? fs.statSync(p).size : null;
}

async function main() {
  if (hre.network.name !== "localhost") throw new Error("Run with --network localhost against `npx hardhat node`.");
  const startedAt = new Date().toISOString();
  const accounts = await provider.send("eth_accounts", []);
  const vkey = JSON.parse(fs.readFileSync(lib.VKEY_PATH, "utf8"));
  const [admin, mine, logistics, smelter, manufacturer, auditor] = accounts;
  await provider.send("evm_setAutomine", [true]);
  await provider.send("evm_setIntervalMining", [0]);

  // ------------------------------------------------------------------ environment
  const pkg = (p) => JSON.parse(fs.readFileSync(path.join(lib.ROOT, "node_modules", p, "package.json"), "utf8")).version;
  let circomVersion = null;
  try {
    circomVersion = execSync(`"${path.join(lib.ROOT, "node_modules", ".bin", "circom2")}" --version`).toString().trim();
  } catch (_) {}
  const latest = await provider.getBlock("latest");
  const environment = {
    startedAt,
    network: hre.network.name,
    chainId: Number((await provider.getNetwork()).chainId),
    hardfork: hre.config.networks.hardhat.hardfork,
    blockGasLimit: latest.gasLimit,
    node: process.version,
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0].model,
    cpuCount: os.cpus().length,
    memoryGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    versions: {
      hardhat: pkg("hardhat"),
      ethers: pkg("ethers"),
      openzeppelin: pkg("@openzeppelin/contracts"),
      snarkjs: pkg("snarkjs"),
      circomlib: pkg("circomlib"),
      circomlibjs: pkg("circomlibjs"),
      circom: circomVersion,
      solc: hre.config.solidity.compilers[0].version,
      optimizerRuns: hre.config.solidity.compilers[0].settings.optimizer.runs
    }
  };
  console.log(environment);

  // ------------------------------------------------------------------ E1 deployment
  const factories = {
    StakeholderRegistry: await hre.ethers.getContractFactory("StakeholderRegistry"),
    RegionProofVerifier: await hre.ethers.getContractFactory("RegionProofVerifier"),
    GeoZKMiner: await hre.ethers.getContractFactory("GeoZKMiner")
  };
  const adminSigner = await hre.ethers.getSigner(admin);
  const deployment = [];
  const registry = await factories.StakeholderRegistry.connect(adminSigner).deploy(admin);
  await registry.waitForDeployment();
  const verifier = await factories.RegionProofVerifier.connect(adminSigner).deploy();
  await verifier.waitForDeployment();
  const core = await factories.GeoZKMiner.connect(adminSigner).deploy(
    await registry.getAddress(),
    await verifier.getAddress()
  );
  await core.waitForDeployment();
  registry.label = "StakeholderRegistry";
  verifier.label = "RegionProofVerifier";
  core.label = "GeoZKMiner";
  for (const [name, c] of [["StakeholderRegistry", registry], ["RegionProofVerifier", verifier], ["GeoZKMiner", core]]) {
    const dtx = c.deploymentTransaction();
    const rc = await dtx.wait();
    const code = await provider.getCode(await c.getAddress());
    deployment.push({
      contract: name,
      address: await c.getAddress(),
      transactionHash: dtx.hash,
      blockNumber: rc.blockNumber,
      gasUsed: rc.gasUsed,
      effectiveGasPriceWei: rc.gasPrice,
      feeWei: rc.gasUsed * rc.gasPrice,
      runtimeBytecodeBytes: (code.length - 2) / 2,
      initcodeBytes: (dtx.data.length - 2) / 2
    });
  }
  write("E1_deployment.json", { environment, deployment });
  console.log("E1 done", deployment.map((d) => [d.contract, d.gasUsed.toString()]));

  // ------------------------------------------------------------------ E2 workflow trace
  const contracts = [core, registry, verifier];
  const trace = [];
  const roles = {
    MINE: await registry.MINE_ROLE(),
    LOGISTICS: await registry.LOGISTICS_ROLE(),
    SMELTER: await registry.SMELTER_ROLE(),
    MANUFACTURER: await registry.MANUFACTURER_ROLE(),
    AUDITOR: await registry.AUDITOR_ROLE()
  };
  const regGas = [];
  for (const [acct, role, name, roleName] of [
    [mine, roles.MINE, "Mining Cooperative A", "Mine"],
    [logistics, roles.LOGISTICS, "Logistics Provider A", "Logistics"],
    [smelter, roles.SMELTER, "Smelter A", "Smelter"],
    [manufacturer, roles.MANUFACTURER, "Manufacturer A", "Manufacturer"],
    [auditor, roles.AUDITOR, "Auditor A", "Auditor"]
  ]) {
    const r = await send(registry, admin, "registerStakeholder", [acct, role, name, `ipfs://stakeholder-${roleName.toLowerCase()}`]);
    regGas.push(Number(r.receipt.gasUsed));
    trace.push(await describeReceipt(`Register ${roleName}`, "Admin", r, contracts));
  }
  const region = lib.encodeRegion(REGION_DEG);
  const regionHash = await lib.regionHashOf(region);
  const rApprove = await send(core, auditor, "approveRegion", [lib.toBytes32(regionHash)]);
  trace.push(await describeReceipt("Approve region", "Auditor", rApprove, contracts));

  async function newBatchInput(seed) {
    const lat = REGION_DEG.latMin + 0.05 + Math.random() * 0.9;
    const lon = REGION_DEG.lonMin + 0.05 + Math.random() * 0.9;
    const { x, y } = lib.encodeCoordinate(lat, lon);
    const r = lib.randomFieldElement();
    const commitment = await lib.commitmentOf(x, y, r);
    const certHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`certificate-${seed}-${r}`));
    return { x, y, r, commitment, certHash, mineralType: seed % 5 };
  }

  async function runBatchLifecycle(seed, { recordTrace = false, complianceValid = false } = {}) {
    const ops = [];
    const add = async (label, role, r) => {
      ops.push({ op: label, gasUsed: Number(r.receipt.gasUsed), latencyMs: r.latencyMs, block: r.receipt.blockNumber });
      if (recordTrace) trace.push(await describeReceipt(label, role, r, contracts));
    };
    const b = await newBatchInput(seed);
    const rCreate = await send(core, mine, "createBatch", [
      b.mineralType,
      b.certHash,
      lib.toBytes32(b.commitment),
      lib.toBytes32(regionHash),
      `ipfs://batch-${seed}`
    ]);
    const batchId = lib.parseEvents([core], rCreate.receipt).find((e) => e.parsed.name === "BatchCreated").parsed.args.batchId;
    await add("Batch creation", "Mine", rCreate);

    const prf = await lib.generateRegionProof({ x: b.x, y: b.y, r: b.r, region, regionHash, commitment: b.commitment }, vkey);
    if (!prf.offchainValid) throw new Error("off-chain verification failed");
    const a = lib.proofToSolidityArgs(prf.proof, prf.publicSignals);
    const rVerify = await send(core, auditor, "verifyAndRegisterBatch", [batchId, a.proofA, a.proofB, a.proofC, a.signals]);
    await add("Region-based ZKP verification", "Auditor", rVerify);
    const zkEv = lib.parseEvents([core], rVerify.receipt).find((e) => e.parsed.name === "ZKPVerified");
    const verifierGas = Number(zkEv.parsed.args.verifierGasUsed);

    const S = lib.Status;
    const steps = [
      [S.IN_TRANSIT, logistics, "Logistics", "Lifecycle: in transit", "Mine-to-smelter route"],
      [S.AT_SMELTER, smelter, "Smelter", "Lifecycle: at smelter", "Smelter receiving dock"],
      [S.PROCESSED, smelter, "Smelter", "Lifecycle: processed", "Smelter processing unit"],
      [S.AT_MANUFACTURER, manufacturer, "Manufacturer", "Lifecycle: at manufacturer", "Manufacturer intake"],
      [S.COMPLETED, manufacturer, "Manufacturer", "Lifecycle: completed", "Manufacturing complete"]
    ];
    for (const [st, who, role, label, loc] of steps) {
      await add(label, role, await send(core, who, "updateBatchStatus", [batchId, st, loc]));
    }
    const rReq = await send(core, manufacturer, "requestReacquisition", [
      batchId,
      "Impurity level above contract specification"
    ]);
    const requestId = lib.parseEvents([core], rReq.receipt).find((e) => e.parsed.name === "ReacquisitionRequested").parsed.args.requestId;
    await add("Reacquisition request", "Manufacturer", rReq);
    const rRes = await send(core, auditor, "resolveReacquisition", [requestId, complianceValid]);
    await add("Reacquisition resolution", "Auditor", rRes);
    const decision = Number(lib.parseEvents([core], rRes.receipt).find((e) => e.parsed.name === "ReacquisitionResolved").parsed.args.decision);

    return {
      seed,
      batchId,
      ops,
      verifierGas,
      decision,
      proofTiming: { witnessMs: prf.witnessMs, proveMs: prf.proveMs, verifyMs: prf.verifyMs },
      proofBytes: Buffer.byteLength(JSON.stringify(prf.proof)),
      publicBytes: Buffer.byteLength(JSON.stringify(prf.publicSignals))
    };
  }

  const traceRun = await runBatchLifecycle(0, { recordTrace: true, complianceValid: false });
  write("E2_workflow_trace.json", {
    environment,
    region: { degrees: REGION_DEG, encoded: region, regionHash: lib.toBytes32(regionHash) },
    stakeholderRegistrationGas: regGas,
    trace
  });
  console.log("E2 done", trace.length, "transactions");

  // ------------------------------------------------------------------ E3/E4 per-operation benchmark
  const runs = [];
  const txLog = [];
  let seq = 0;
  for (let i = 1; i <= N_BATCHES; i++) {
    const res = await runBatchLifecycle(i, { complianceValid: i % 2 === 0 });
    for (const o of res.ops) txLog.push({ seq: ++seq, batch: i, ...o });
    runs.push(res);
    if (i % 20 === 0) console.log(`E3 ${i}/${N_BATCHES}`);
  }
  const byOp = {};
  for (const t of txLog) {
    if (!byOp[t.op]) byOp[t.op] = { gas: [], lat: [] };
    byOp[t.op].gas.push(t.gasUsed);
    byOp[t.op].lat.push(t.latencyMs);
  }
  const opSummary = Object.entries(byOp).map(([op, v]) => ({ op, gas: stats(v.gas), latencyMs: stats(v.lat) }));
  const proofTiming = {
    witnessMs: stats(runs.map((r) => r.proofTiming.witnessMs)),
    proveMs: stats(runs.map((r) => r.proofTiming.proveMs)),
    verifyMs: stats(runs.map((r) => r.proofTiming.verifyMs)),
    totalMs: stats(runs.map((r) => r.proofTiming.witnessMs + r.proofTiming.proveMs + r.proofTiming.verifyMs))
  };
  const decisions = runs.reduce((acc, r) => ((acc[r.decision] = (acc[r.decision] || 0) + 1), acc), {});
  write("E3_operations.json", {
    environment,
    nBatches: N_BATCHES,
    opSummary,
    verifierInternalGas: stats(runs.map((r) => r.verifierGas)),
    decisions,
    txLog
  });
  write("E4_proof_timing.json", {
    environment,
    nProofs: runs.length,
    proofTiming,
    proofJsonBytes: stats(runs.map((r) => r.proofBytes)),
    publicSignalsJsonBytes: stats(runs.map((r) => r.publicBytes)),
    perRun: runs.map((r) => ({ seed: r.seed, ...r.proofTiming }))
  });
  console.log("E3/E4 done");

  // ------------------------------------------------------------------ E5 artefact sizes
  const build = path.join(lib.ROOT, "circuits", "build", "regionProof");
  let r1csInfo = null;
  try {
    r1csInfo = execSync(`"${path.join(lib.ROOT, "node_modules", ".bin", "snarkjs")}" r1cs info "${path.join(build, "regionProof.r1cs")}"`)
      .toString()
      .replace(/\x1b\[[0-9;]*m/g, "");
  } catch (_) {}
  const verifierCode = await provider.getCode(await verifier.getAddress());
  const sample = runs[0];
  write("E5_artifacts.json", {
    environment,
    r1csInfo,
    artifacts: [
      { artifact: "Witness generator (regionProof.wasm)", bytes: fileSize(path.join(build, "regionProof_js", "regionProof.wasm")), use: "Off-chain (prover)" },
      { artifact: "Proving key (regionProof_final.zkey)", bytes: fileSize(lib.ZKEY_PATH), use: "Off-chain (prover)" },
      { artifact: "Constraint system (regionProof.r1cs)", bytes: fileSize(path.join(build, "regionProof.r1cs")), use: "Setup / audit" },
      { artifact: "Verification key (verification_key.json)", bytes: fileSize(lib.VKEY_PATH), use: "Verifier generation" },
      { artifact: "Solidity verifier source (RegionProofVerifier.sol)", bytes: fileSize(path.join(lib.ROOT, "contracts", "RegionProofVerifier.sol")), use: "Deployment" },
      { artifact: "Verifier runtime bytecode", bytes: (verifierCode.length - 2) / 2, use: "On-chain" },
      { artifact: "Groth16 proof (JSON)", bytes: sample.proofBytes, use: "Submitted per batch" },
      { artifact: "Public signals (JSON)", bytes: sample.publicBytes, use: "Submitted per batch" },
      { artifact: "Proof calldata (ABI-encoded, 8 x 32 B)", bytes: 256, use: "Submitted per batch" },
      { artifact: "Public signals calldata (6 x 32 B)", bytes: 192, use: "Submitted per batch" }
    ]
  });
  console.log("E5 done");

  // ------------------------------------------------------------------ E6 concurrent load (automine)
  const maxClients = Math.max(...LOAD_LEVELS_CREATE);
  const loadMines = accounts.slice(10, 10 + maxClients);
  const loadAuditors = accounts.slice(10, 10 + Math.max(...LOAD_LEVELS_ZKP));
  for (const m of loadMines) await send(registry, admin, "registerStakeholder", [m, roles.MINE, "Load mine", "ipfs://load"]);
  for (const a of loadAuditors) await send(registry, admin, "registerStakeholder", [a, roles.AUDITOR, "Load auditor", "ipfs://load"]);

  async function createOnly(from, seed) {
    const b = await newBatchInput(seed);
    return send(core, from, "createBatch", [b.mineralType, b.certHash, lib.toBytes32(b.commitment), lib.toBytes32(regionHash), "ipfs://load"]);
  }

  async function loadLevel(clients, txPerClient, makeTx, pollMs) {
    const lat = [];
    const blocks = new Set();
    const t0 = process.hrtime.bigint();
    await Promise.all(
      clients.map(async (c, ci) => {
        for (let k = 0; k < txPerClient; k++) {
          const r = await makeTx(c, ci, k);
          lat.push(r.latencyMs);
          blocks.add(r.receipt.blockNumber);
        }
      })
    );
    const wallMs = lib.hrMs(t0);
    return { clients: clients.length, transactions: lat.length, wallMs, throughputTps: lat.length / (wallMs / 1000), blocksUsed: blocks.size, latencyMs: stats(lat) };
  }

  let loadSeed = 100000;
  const loadCreate = [];
  for (const c of LOAD_LEVELS_CREATE) {
    loadCreate.push({ workload: "Batch creation", ...(await loadLevel(loadMines.slice(0, c), LOAD_TX_PER_CLIENT, (from) => createOnly(from, loadSeed++), 2)) });
    console.log("E6 create", c);
  }

  // Pre-create batches and proofs for the ZKP-verification workload.
  const zkJobs = {};
  for (const c of LOAD_LEVELS_ZKP) {
    zkJobs[c] = [];
    for (let ci = 0; ci < c; ci++) {
      const list = [];
      for (let k = 0; k < ZKP_TX_PER_CLIENT; k++) {
        const b = await newBatchInput(loadSeed++);
        const rc = await send(core, mine, "createBatch", [b.mineralType, b.certHash, lib.toBytes32(b.commitment), lib.toBytes32(regionHash), "ipfs://load"]);
        const batchId = lib.parseEvents([core], rc.receipt).find((e) => e.parsed.name === "BatchCreated").parsed.args.batchId;
        const prf = await lib.generateRegionProof({ x: b.x, y: b.y, r: b.r, region, regionHash, commitment: b.commitment });
        list.push({ batchId, args: lib.proofToSolidityArgs(prf.proof, prf.publicSignals) });
      }
      zkJobs[c].push(list);
    }
  }
  const loadZkp = [];
  for (const c of LOAD_LEVELS_ZKP) {
    loadZkp.push({
      workload: "ZKP verification",
      ...(await loadLevel(loadAuditors.slice(0, c), ZKP_TX_PER_CLIENT, (from, ci, k) => {
        const j = zkJobs[c][ci][k];
        return send(core, from, "verifyAndRegisterBatch", [j.batchId, j.args.proofA, j.args.proofB, j.args.proofC, j.args.signals]);
      }, 2))
    });
    console.log("E6 zkp", c);
  }
  write("E6_load_automine.json", { environment, txPerClientCreate: LOAD_TX_PER_CLIENT, txPerClientZkp: ZKP_TX_PER_CLIENT, loadCreate, loadZkp });

  // ------------------------------------------------------------------ E7 interval mining (12 s blocks)
  await provider.send("evm_setAutomine", [false]);
  await provider.send("evm_setIntervalMining", [BLOCK_INTERVAL_MS]);
  const loadInterval = [];
  for (const burst of INTERVAL_BURSTS) {
    // Start every burst just after a block so all bursts see the same block phase.
    const b0 = await provider.getBlockNumber();
    while ((await provider.getBlockNumber()) === b0) await sleep(20);
    const lat = [];
    const blocks = [];
    const t0 = process.hrtime.bigint();
    await Promise.all(
      Array.from({ length: burst }, (_, i) =>
        createOnly(loadMines[i % loadMines.length], loadSeed++).then((r) => {
          lat.push(r.latencyMs);
          blocks.push(r.receipt.blockNumber);
        })
      )
    );
    const wallMs = lib.hrMs(t0);
    const perBlock = {};
    for (const b of blocks) perBlock[b] = (perBlock[b] || 0) + 1;
    const blockGas = [];
    for (const b of Object.keys(perBlock)) {
      const blk = await provider.getBlock(Number(b));
      blockGas.push({ block: Number(b), txs: perBlock[b], gasUsed: blk.gasUsed, gasLimit: blk.gasLimit });
    }
    loadInterval.push({
      workload: "Batch creation burst (12 s blocks)",
      burst,
      wallMs,
      blocksUsed: Object.keys(perBlock).length,
      blockGas,
      latencyMs: stats(lat)
    });
    console.log("E7", burst, stats(lat).median.toFixed(0), "ms; blocks", Object.keys(perBlock).length);
  }
  await provider.send("evm_setIntervalMining", [0]);
  await provider.send("evm_setAutomine", [true]);
  write("E7_load_interval.json", { environment, blockIntervalMs: BLOCK_INTERVAL_MS, loadInterval });

  write("RUN_INFO.json", { startedAt, finishedAt: new Date().toISOString(), environment, nBatches: N_BATCHES });
  console.log("All experiments complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
