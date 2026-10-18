const { expect } = require("chai");
const lib = require("../scripts/lib/geozk");
const { deployFixture, createBatchFor, verifyBatch, advanceTo } = require("./fixtures");

describe("Lifecycle and custody enforcement", function () {
  it("blocks downstream progression before ZKP verification", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    await expect(
      sys.core.connect(sys.logistics).updateBatchStatus(b.batchId, lib.Status.IN_TRANSIT, "route")
    ).to.be.revertedWith("Invalid lifecycle transition");
  });

  it("blocks skipped lifecycle stages", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    await verifyBatch(sys, b);
    await expect(
      sys.core.connect(sys.smelter).updateBatchStatus(b.batchId, lib.Status.AT_SMELTER, "dock")
    ).to.be.revertedWith("Invalid lifecycle transition");
  });

  it("blocks a transition by the wrong role", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    await verifyBatch(sys, b);
    await expect(
      sys.core.connect(sys.manufacturer).updateBatchStatus(b.batchId, lib.Status.IN_TRANSIT, "route")
    ).to.be.revertedWith("Unauthorized role");
  });

  it("blocks direct writes of governance states through updateBatchStatus", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    await verifyBatch(sys, b);
    await expect(
      sys.core.connect(sys.logistics).updateBatchStatus(b.batchId, lib.Status.REACQUIRED, "x")
    ).to.be.revertedWith("Invalid lifecycle transition");
  });

  it("records custody hand-offs through the complete lifecycle", async function () {
    const sys = await deployFixture();
    const b = await createBatchFor(sys);
    await verifyBatch(sys, b);
    await advanceTo(sys, b.batchId, lib.Status.COMPLETED);
    const stored = await sys.core.getBatch(b.batchId);
    expect(stored.status).to.equal(BigInt(lib.Status.COMPLETED));
    expect(stored.custodian).to.equal(sys.manufacturer.address);
    expect((await sys.core.getBatchHistory(b.batchId)).length).to.equal(6);
  });
});
