const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployAll } = require("./fixtures");

describe("BTCMRS - ZKP Verification", function () {
  it("verifies and updates status with valid proof result", async function () {
    const { btcMrs, mine, auditor, regionHash } = await deployAll();
    const cert = ethers.keccak256(ethers.toUtf8Bytes("cert-1"));
    const geo = "0x0000000000000000000000000000000000000000000000000000000000000123";
    const tx = await btcMrs.connect(mine).createBatch(0, cert, geo, regionHash, "ipfs://batch");
    const rc = await tx.wait();
    const event = rc.logs.map((l) => {
      try { return btcMrs.interface.parseLog(l); } catch { return null; }
    }).find((e) => e && e.name === "BatchCreated");
    const batchId = event.args.batchId;

    await (await btcMrs.connect(auditor).verifyAndRegisterBatch(
      batchId,
      [0, 0],
      [[0, 0], [0, 0]],
      [0, 0],
      [100, 250, 300, 450, BigInt(regionHash), BigInt(geo)]
    )).wait();

    const b = await btcMrs.getBatch(batchId);
    expect(b.zkProofVerified).to.equal(true);
    expect(b.status).to.equal(1n);
  });
});
