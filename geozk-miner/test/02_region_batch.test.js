const { expect } = require("chai");
const hre = require("hardhat");
const lib = require("../scripts/lib/geozk");
const { deployFixture, createBatchFor, OTHER_REGION_DEG } = require("./fixtures");

describe("Region governance and batch creation", function () {
  it("only an auditor can approve a region", async function () {
    const sys = await deployFixture({ mockVerifier: true });
    await expect(sys.core.connect(sys.mine).approveRegion("0x" + "22".repeat(32))).to.be.revertedWith(
      "Unauthorized role"
    );
  });

  it("a mine creates a batch in an approved region", async function () {
    const sys = await deployFixture({ mockVerifier: true });
    const b = await createBatchFor(sys);
    const stored = await sys.core.getBatch(b.batchId);
    expect(stored.status).to.equal(BigInt(lib.Status.CREATED));
    expect(stored.geoCommitment).to.equal(lib.toBytes32(b.commitment));
  });

  it("rejects batch creation by a non-mine role", async function () {
    const sys = await deployFixture({ mockVerifier: true });
    const cert = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("c"));
    await expect(
      sys.core.connect(sys.smelter).createBatch(0, cert, "0x" + "33".repeat(32), lib.toBytes32(sys.regionHash), "u")
    ).to.be.revertedWith("Unauthorized role");
  });

  it("rejects batch creation against an unapproved region", async function () {
    const sys = await deployFixture({ mockVerifier: true });
    const other = await lib.regionHashOf(lib.encodeRegion(OTHER_REGION_DEG));
    const cert = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("c"));
    await expect(
      sys.core.connect(sys.mine).createBatch(0, cert, "0x" + "44".repeat(32), lib.toBytes32(other), "u")
    ).to.be.revertedWith("Region not approved");
  });

  it("rejects reuse of a geographic commitment", async function () {
    const sys = await deployFixture({ mockVerifier: true });
    const cert = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("c"));
    const geo = "0x" + "55".repeat(32);
    await (await sys.core.connect(sys.mine).createBatch(0, cert, geo, lib.toBytes32(sys.regionHash), "u")).wait();
    await expect(
      sys.core.connect(sys.mine).createBatch(0, cert, geo, lib.toBytes32(sys.regionHash), "u")
    ).to.be.revertedWith("Commitment already used");
  });
});
