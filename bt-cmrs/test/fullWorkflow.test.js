const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployAll } = require("./fixtures");

describe("BTCMRS - Full Workflow", function () {
  it("runs end-to-end lifecycle plus reacquisition", async function () {
    const { btcMrs, mine, logistics, smelter, manufacturer, auditor, regionHash } = await deployAll();
    const cert = ethers.keccak256(ethers.toUtf8Bytes("cert-full"));
    const geo = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const createTx = await btcMrs.connect(mine).createBatch(4, cert, geo, regionHash, "ipfs://full");
    const createRc = await createTx.wait();
    const created = createRc.logs.map((l) => {
      try { return btcMrs.interface.parseLog(l); } catch { return null; }
    }).find((e) => e && e.name === "BatchCreated");
    const batchId = created.args.batchId;

    await (await btcMrs.connect(auditor).verifyAndRegisterBatch(
      batchId,
      [0, 0],
      [[0, 0], [0, 0]],
      [0, 0],
      [100, 250, 300, 450, BigInt(regionHash), BigInt(geo)]
    )).wait();
    await (await btcMrs.connect(logistics).updateBatchStatus(batchId, 2, "Transit")).wait();
    await (await btcMrs.connect(smelter).updateBatchStatus(batchId, 3, "At smelter")).wait();
    await (await btcMrs.connect(smelter).updateBatchStatus(batchId, 4, "Processed")).wait();
    await (await btcMrs.connect(manufacturer).updateBatchStatus(batchId, 5, "At manufacturer")).wait();
    await (await btcMrs.connect(manufacturer).updateBatchStatus(batchId, 6, "Complete")).wait();

    const reqTx = await btcMrs.connect(manufacturer).requestReacquisition(batchId, "Regulatory request");
    const reqRc = await reqTx.wait();
    const req = reqRc.logs.map((l) => {
      try { return btcMrs.interface.parseLog(l); } catch { return null; }
    }).find((e) => e && e.name === "ReacquisitionRequested");
    await (await btcMrs.connect(auditor).resolveReacquisition(req.args.requestId, 2)).wait();

    expect((await btcMrs.getBatch(batchId)).status).to.equal(9n);
  });
});
