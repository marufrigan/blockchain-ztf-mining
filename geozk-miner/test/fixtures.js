const hre = require("hardhat");
const lib = require("../scripts/lib/geozk");

const REGION_DEG = { latMin: -3.0, latMax: -2.0, lonMin: 28.0, lonMax: 29.0 };
const OTHER_REGION_DEG = { latMin: 1.0, latMax: 2.0, lonMin: 30.0, lonMax: 31.0 };

async function deployFixture({ mockVerifier = false } = {}) {
  const sys = await lib.deploySystem(hre, { mockVerifier });
  await lib.registerDefaultStakeholders(sys);
  const region = lib.encodeRegion(REGION_DEG);
  const regionHash = await lib.regionHashOf(region);
  await (await sys.core.connect(sys.auditor).approveRegion(lib.toBytes32(regionHash))).wait();
  return { ...sys, region, regionHash };
}

async function createBatchFor(sys, { lat = -2.5, lon = 28.5, mineralType = 2, cert = "cert-doc" } = {}) {
  const { x, y } = lib.encodeCoordinate(lat, lon);
  const r = lib.randomFieldElement();
  const commitment = await lib.commitmentOf(x, y, r);
  const certHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`${cert}-${r}`));
  const rc = await (
    await sys.core
      .connect(sys.mine)
      .createBatch(mineralType, certHash, lib.toBytes32(commitment), lib.toBytes32(sys.regionHash), "ipfs://batch")
  ).wait();
  const ev = lib.parseEvents([sys.core], rc).find((e) => e.parsed.name === "BatchCreated");
  return { batchId: ev.parsed.args.batchId, x, y, r, commitment };
}

async function proveFor(sys, batch, region = sys.region, regionHash = sys.regionHash) {
  return lib.generateRegionProof({ x: batch.x, y: batch.y, r: batch.r, region, regionHash, commitment: batch.commitment });
}

async function verifyBatch(sys, batch) {
  const { proof, publicSignals } = await proveFor(sys, batch);
  const a = lib.proofToSolidityArgs(proof, publicSignals);
  return (await sys.core.connect(sys.auditor).verifyAndRegisterBatch(batch.batchId, a.proofA, a.proofB, a.proofC, a.signals)).wait();
}

async function advanceTo(sys, batchId, target) {
  const S = lib.Status;
  const steps = [
    [S.IN_TRANSIT, sys.logistics, "Mine-to-smelter route"],
    [S.AT_SMELTER, sys.smelter, "Smelter receiving dock"],
    [S.PROCESSED, sys.smelter, "Smelter processing unit"],
    [S.AT_MANUFACTURER, sys.manufacturer, "Manufacturer intake"],
    [S.COMPLETED, sys.manufacturer, "Manufacturing complete"]
  ];
  for (const [status, who, loc] of steps) {
    await (await sys.core.connect(who).updateBatchStatus(batchId, status, loc)).wait();
    if (status === target) return;
  }
}

module.exports = { REGION_DEG, OTHER_REGION_DEG, deployFixture, createBatchFor, proveFor, verifyBatch, advanceTo };
