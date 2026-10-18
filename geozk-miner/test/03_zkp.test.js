const { expect } = require("chai");
const lib = require("../scripts/lib/geozk");
const { deployFixture, createBatchFor, proveFor, OTHER_REGION_DEG } = require("./fixtures");

async function submit(sys, batchId, proof, publicSignals, who) {
  const a = lib.proofToSolidityArgs(proof, publicSignals);
  return sys.core.connect(who || sys.auditor).verifyAndRegisterBatch(batchId, a.proofA, a.proofB, a.proofC, a.signals);
}

describe("Region-based Groth16 verification (real verifier)", function () {
  it("accepts a valid proof and marks the batch ZKP_VERIFIED", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    const { proof, publicSignals, offchainValid } = await proveFor(sys, b);
    await (await submit(sys, b.batchId, proof, publicSignals)).wait();
    const stored = await sys.core.getBatch(b.batchId);
    expect(stored.zkProofVerified).to.equal(true);
    expect(stored.status).to.equal(BigInt(lib.Status.ZKP_VERIFIED));
  });

  it("rejects a tampered proof", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    const { proof, publicSignals } = await proveFor(sys, b);
    proof.pi_a[0] = (BigInt(proof.pi_a[0]) + 1n).toString();
    await expect(submit(sys, b.batchId, proof, publicSignals)).to.be.reverted;
  });

  it("rejects replay of a valid proof against another batch", async function () {
    const sys = await deployFixture();
    const b1 = await createBatchFor(sys);
    const b2 = await createBatchFor(sys, { lat: -2.4, lon: 28.6 });
    const { proof, publicSignals } = await proveFor(sys, b1);
    await expect(submit(sys, b2.batchId, proof, publicSignals)).to.be.revertedWith("Commitment mismatch");
  });

  it("rejects a proof whose public region does not match the batch region", async function () {
    const sys = await deployFixture();
    const otherRegion = lib.encodeRegion({ latMin: -3.5, latMax: -1.5, lonMin: 27.5, lonMax: 29.5 });
    const otherHash = await lib.regionHashOf(otherRegion);
    await (await sys.core.connect(sys.auditor).approveRegion(lib.toBytes32(otherHash))).wait();
    const b = await createBatchFor(sys);
    const { proof, publicSignals } = await proveFor(sys, b, otherRegion, otherHash);
    await expect(submit(sys, b.batchId, proof, publicSignals)).to.be.revertedWith("Region mismatch");
  });

  it("rejects proof submission by a non-auditor", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    const { proof, publicSignals } = await proveFor(sys, b);
    await expect(submit(sys, b.batchId, proof, publicSignals, sys.mine)).to.be.revertedWith("Unauthorized role");
  });

  it("rejects a second verification of the same batch", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    const { proof, publicSignals } = await proveFor(sys, b);
    await (await submit(sys, b.batchId, proof, publicSignals)).wait();
    await expect(submit(sys, b.batchId, proof, publicSignals)).to.be.revertedWith("Invalid status");
  });

  it("rejects verification after the batch region is revoked", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    const { proof, publicSignals } = await proveFor(sys, b);
    await (await sys.core.connect(sys.auditor).revokeRegion(lib.toBytes32(sys.regionHash))).wait();
    await expect(submit(sys, b.batchId, proof, publicSignals)).to.be.revertedWith("Region not approved");
  });

  it("cannot produce a witness for coordinates outside the approved region", async function () {
    const sys = await deployFixture();
    const { x, y } = lib.encodeCoordinate(1.5, 30.5); // inside OTHER_REGION_DEG, outside the approved one
    const r = lib.randomFieldElement();
    const commitment = await lib.commitmentOf(x, y, r);
    let failed = false;
    try {
      await lib.generateRegionProof({ x, y, r, region: sys.region, regionHash: sys.regionHash, commitment });
    } catch (e) {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("range checks block field-wraparound coordinates", async function () {
    const sys = await deployFixture();
    // x = p - 1 would satisfy an unchecked 32-bit comparator; Num2Bits(32) must reject it.
    const p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    const x = p - 1n;
    const { y } = lib.encodeCoordinate(-2.5, 28.5);
    const r = lib.randomFieldElement();
    const commitment = await lib.commitmentOf(x, y, r);
    let failed = false;
    try {
      await lib.generateRegionProof({ x, y, r, region: sys.region, regionHash: sys.regionHash, commitment });
    } catch (e) {
      failed = true;
    }
    expect(failed).to.equal(true);
  });
});
