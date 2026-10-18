/**
 * Shared helpers for GeoZK-Miner scripts and tests: deployment, coordinate
 * encoding, Poseidon commitments, Groth16 proof generation and event decoding.
 */
const path = require("path");
const crypto = require("crypto");
const snarkjs = require("snarkjs");
const circomlibjs = require("circomlibjs");

const ROOT = path.join(__dirname, "..", "..");
const WASM_PATH = path.join(ROOT, "circuits", "build", "regionProof", "regionProof_js", "regionProof.wasm");
const ZKEY_PATH = path.join(ROOT, "circuits", "regionProof_final.zkey");
const VKEY_PATH = path.join(ROOT, "circuits", "verification_key.json");

const SCALE = 1_000_000; // micro-degree fixed point
const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const Status = {
  CREATED: 0,
  ZKP_VERIFIED: 1,
  IN_TRANSIT: 2,
  AT_SMELTER: 3,
  PROCESSED: 4,
  AT_MANUFACTURER: 5,
  COMPLETED: 6,
  REACQUISITION_REQUESTED: 7,
  REACQUIRED: 8,
  REJECTED: 9,
  AUDIT_REQUIRED: 10
};
const Decision = { NONE: 0, APPROVED: 1, REJECTED: 2, AUDIT_REQUIRED: 3 };

/** Encode latitude/longitude (degrees) as non-negative 32-bit micro-degree integers. */
function encodeCoordinate(lat, lon) {
  return {
    x: BigInt(Math.round((lon + 180) * SCALE)),
    y: BigInt(Math.round((lat + 90) * SCALE))
  };
}

function encodeRegion({ latMin, latMax, lonMin, lonMax }) {
  const lo = encodeCoordinate(latMin, lonMin);
  const hi = encodeCoordinate(latMax, lonMax);
  return { minX: lo.x, maxX: hi.x, minY: lo.y, maxY: hi.y };
}

/** Uniform random blinding factor in the BN254 scalar field. */
function randomFieldElement() {
  return BigInt("0x" + crypto.randomBytes(32).toString("hex")) % BN254_R;
}

let poseidonPromise = null;
async function getPoseidon() {
  if (!poseidonPromise) poseidonPromise = circomlibjs.buildPoseidon();
  return poseidonPromise;
}

async function poseidonHash(values) {
  const poseidon = await getPoseidon();
  return BigInt(poseidon.F.toString(poseidon(values.map((v) => BigInt(v)))));
}

function toBytes32(value) {
  return "0x" + BigInt(value).toString(16).padStart(64, "0");
}

async function regionHashOf(region) {
  return poseidonHash([region.minX, region.maxX, region.minY, region.maxY]);
}

async function commitmentOf(x, y, r) {
  return poseidonHash([x, y, r]);
}

function hrMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

/**
 * Generates a Groth16 proof and times witness generation, proving and
 * off-chain verification separately.
 */
async function generateRegionProof({ x, y, r, region, regionHash, commitment }, vkey) {
  const input = {
    x: x.toString(),
    y: y.toString(),
    r: r.toString(),
    minX: region.minX.toString(),
    maxX: region.maxX.toString(),
    minY: region.minY.toString(),
    maxY: region.maxY.toString(),
    regionHash: regionHash.toString(),
    commitment: commitment.toString()
  };
  const wtns = { type: "mem" };
  let t = process.hrtime.bigint();
  await snarkjs.wtns.calculate(input, WASM_PATH, wtns);
  const witnessMs = hrMs(t);

  t = process.hrtime.bigint();
  const { proof, publicSignals } = await snarkjs.groth16.prove(ZKEY_PATH, wtns);
  const proveMs = hrMs(t);

  let verifyMs = null;
  let offchainValid = null;
  if (vkey) {
    t = process.hrtime.bigint();
    offchainValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    verifyMs = hrMs(t);
  }
  return { proof, publicSignals, witnessMs, proveMs, verifyMs, offchainValid };
}

function proofToSolidityArgs(proof, publicSignals) {
  return {
    proofA: [proof.pi_a[0], proof.pi_a[1]],
    proofB: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]]
    ],
    proofC: [proof.pi_c[0], proof.pi_c[1]],
    signals: publicSignals.map((s) => BigInt(s))
  };
}

function parseEvents(contracts, receipt) {
  const out = [];
  for (const log of receipt.logs) {
    for (const c of contracts) {
      try {
        const parsed = c.interface.parseLog(log);
        if (parsed) {
          out.push({ contract: c.label || "", address: log.address, logIndex: log.index, parsed, log });
          break;
        }
      } catch (_) {
        /* not this contract */
      }
    }
  }
  return out;
}

async function deploySystem(hre, { mockVerifier = false } = {}) {
  const { ethers } = hre;
  const signers = await ethers.getSigners();
  const [admin, mine, logistics, smelter, manufacturer, auditor] = signers;

  const deployments = {};
  const Registry = await ethers.getContractFactory("StakeholderRegistry");
  const registry = await Registry.deploy(admin.address);
  await registry.waitForDeployment();
  deployments.registry = registry.deploymentTransaction();

  const Verifier = await ethers.getContractFactory(mockVerifier ? "MockRegionProofVerifier" : "RegionProofVerifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  deployments.verifier = verifier.deploymentTransaction();

  const Core = await ethers.getContractFactory("GeoZKMiner");
  const core = await Core.deploy(await registry.getAddress(), await verifier.getAddress());
  await core.waitForDeployment();
  deployments.core = core.deploymentTransaction();

  registry.label = "StakeholderRegistry";
  verifier.label = mockVerifier ? "MockRegionProofVerifier" : "RegionProofVerifier";
  core.label = "GeoZKMiner";

  const roles = {
    MINE: await registry.MINE_ROLE(),
    LOGISTICS: await registry.LOGISTICS_ROLE(),
    SMELTER: await registry.SMELTER_ROLE(),
    MANUFACTURER: await registry.MANUFACTURER_ROLE(),
    AUDITOR: await registry.AUDITOR_ROLE()
  };
  return { registry, verifier, core, roles, deployments, admin, mine, logistics, smelter, manufacturer, auditor, signers };
}

async function registerDefaultStakeholders(sys) {
  const { registry, roles, mine, logistics, smelter, manufacturer, auditor } = sys;
  const receipts = [];
  const entries = [
    [mine, roles.MINE, "Mining Cooperative A", "ipfs://stakeholder-mine"],
    [logistics, roles.LOGISTICS, "Logistics Provider A", "ipfs://stakeholder-logistics"],
    [smelter, roles.SMELTER, "Smelter A", "ipfs://stakeholder-smelter"],
    [manufacturer, roles.MANUFACTURER, "Manufacturer A", "ipfs://stakeholder-manufacturer"],
    [auditor, roles.AUDITOR, "Auditor A", "ipfs://stakeholder-auditor"]
  ];
  for (const [acct, role, name, uri] of entries) {
    receipts.push(await (await registry.registerStakeholder(acct.address, role, name, uri)).wait());
  }
  return receipts;
}

module.exports = {
  ROOT,
  WASM_PATH,
  ZKEY_PATH,
  VKEY_PATH,
  SCALE,
  Status,
  Decision,
  encodeCoordinate,
  encodeRegion,
  randomFieldElement,
  poseidonHash,
  regionHashOf,
  commitmentOf,
  toBytes32,
  hrMs,
  generateRegionProof,
  proofToSolidityArgs,
  parseEvents,
  deploySystem,
  registerDefaultStakeholders
};
