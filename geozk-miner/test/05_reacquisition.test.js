const { expect } = require("chai");
const lib = require("../scripts/lib/geozk");
const { deployFixture, createBatchFor, verifyBatch, advanceTo } = require("./fixtures");

async function openRequest(sys, stage = lib.Status.AT_SMELTER, who) {
  const b = await createBatchFor(sys);
  await verifyBatch(sys, b);
  await advanceTo(sys, b.batchId, stage);
  const rc = await (await sys.core.connect(who || sys.smelter).requestReacquisition(b.batchId, "Impurity above contract specification")).wait();
  const ev = lib.parseEvents([sys.core], rc).find((e) => e.parsed.name === "ReacquisitionRequested");
  return { b, requestId: ev.parsed.args.requestId };
}

describe("Reacquisition governance (Eq. 15 decision rule)", function () {
  it("approves reacquisition when origin is valid and compliance has failed", async function () {
    const sys = await deployFixture();
    const { b, requestId } = await openRequest(sys);
    await (await sys.core.connect(sys.auditor).resolveReacquisition(requestId, false)).wait();
    expect((await sys.core.getBatch(b.batchId)).status).to.equal(BigInt(lib.Status.REACQUIRED));
  });

  it("flags for audit when origin and compliance are both valid", async function () {
    const sys = await deployFixture();
    const { b, requestId } = await openRequest(sys, lib.Status.COMPLETED, sys.manufacturer);
    await (await sys.core.connect(sys.auditor).resolveReacquisition(requestId, true)).wait();
    expect((await sys.core.getBatch(b.batchId)).status).to.equal(BigInt(lib.Status.AUDIT_REQUIRED));
  });

  it("rejects when the origin region has since been revoked", async function () {
    const sys = await deployFixture();
    const { b, requestId } = await openRequest(sys);
    await (await sys.core.connect(sys.auditor).revokeRegion(lib.toBytes32(sys.regionHash))).wait();
    await (await sys.core.connect(sys.auditor).resolveReacquisition(requestId, false)).wait();
    expect((await sys.core.getBatch(b.batchId)).status).to.equal(BigInt(lib.Status.REJECTED));
  });

  it("rejects reacquisition requests from unauthorised roles", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    await verifyBatch(sys, b);
    await advanceTo(sys, b.batchId, lib.Status.AT_SMELTER);
    await expect(sys.core.connect(sys.logistics).requestReacquisition(b.batchId, "x")).to.be.revertedWith(
      "Unauthorized role"
    );
  });

  it("rejects reacquisition of a batch that has not reached a downstream actor", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    await verifyBatch(sys, b);
    await expect(sys.core.connect(sys.smelter).requestReacquisition(b.batchId, "x")).to.be.revertedWith(
      "Invalid batch status for reacquisition"
    );
  });

  it("rejects resolution by a non-auditor and double resolution", async function () {
    const sys = await deployFixture();
    const { requestId } = await openRequest(sys);
    await expect(sys.core.connect(sys.smelter).resolveReacquisition(requestId, false)).to.be.revertedWith(
      "Unauthorized role"
    );
    await (await sys.core.connect(sys.auditor).resolveReacquisition(requestId, false)).wait();
    await expect(sys.core.connect(sys.auditor).resolveReacquisition(requestId, false)).to.be.revertedWith(
      "Already resolved"
    );
  });
});
