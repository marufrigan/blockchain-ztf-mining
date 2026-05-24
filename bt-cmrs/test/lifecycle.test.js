const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployAll } = require("./fixtures");

describe("BTCMRS - Lifecycle", function () {
  it("updates custody and status across roles", async function () {
    const { btcMrs, mine, logistics, smelter, manufacturer, regionHash } = await deployAll();
    const cert = ethers.keccak256(ethers.toUtf8Bytes("cert-1"));
    const geo = "0x0000000000000000000000000000000000000000000000000000000000000123";
    const tx = await btcMrs.connect(mine).createBatch(0, cert, geo, regionHash, "ipfs://batch");
    const rc = await tx.wait();
    const event = rc.logs.map((l) => {
      try { return btcMrs.interface.parseLog(l); } catch { return null; }
    }).find((e) => e && e.name === "BatchCreated");
    const batchId = event.args.batchId;

    await (await btcMrs.connect(logistics).updateBatchStatus(batchId, 2, "Route")).wait();
    await (await btcMrs.connect(smelter).updateBatchStatus(batchId, 3, "Smelter")).wait();
    await (await btcMrs.connect(manufacturer).updateBatchStatus(batchId, 5, "Manufacturer")).wait();
    expect((await btcMrs.getBatch(batchId)).status).to.equal(5n);
  });
});
