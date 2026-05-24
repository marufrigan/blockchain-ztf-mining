const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployAll } = require("./fixtures");

describe("BTCMRS - Reacquisition", function () {
  it("requests and resolves reacquisition", async function () {
    const { btcMrs, mine, smelter, auditor, regionHash } = await deployAll();
    const cert = ethers.keccak256(ethers.toUtf8Bytes("cert-1"));
    const geo = "0x0000000000000000000000000000000000000000000000000000000000000123";
    const tx = await btcMrs.connect(mine).createBatch(0, cert, geo, regionHash, "ipfs://batch");
    const rc = await tx.wait();
    const event = rc.logs.map((l) => {
      try { return btcMrs.interface.parseLog(l); } catch { return null; }
    }).find((e) => e && e.name === "BatchCreated");
    const batchId = event.args.batchId;
    await (await btcMrs.connect(smelter).updateBatchStatus(batchId, 3, "Smelter")).wait();

    const reqTx = await btcMrs.connect(smelter).requestReacquisition(batchId, "QC issue");
    const reqRc = await reqTx.wait();
    const reqEvent = reqRc.logs.map((l) => {
      try { return btcMrs.interface.parseLog(l); } catch { return null; }
    }).find((e) => e && e.name === "ReacquisitionRequested");
    await (await btcMrs.connect(auditor).resolveReacquisition(reqEvent.args.requestId, 1)).wait();

    expect((await btcMrs.getBatch(batchId)).status).to.equal(8n);
  });
});
