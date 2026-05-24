const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployAll } = require("./fixtures");

describe("BTCMRS - Batch Creation", function () {
  it("creates batch for mine role", async function () {
    const { btcMrs, mine, regionHash } = await deployAll();
    const cert = ethers.keccak256(ethers.toUtf8Bytes("cert-1"));
    const geo = "0x0000000000000000000000000000000000000000000000000000000000000123";
    const tx = await btcMrs.connect(mine).createBatch(0, cert, geo, regionHash, "ipfs://batch");
    const rc = await tx.wait();
    const event = rc.logs.map((l) => {
      try { return btcMrs.interface.parseLog(l); } catch { return null; }
    }).find((e) => e && e.name === "BatchCreated");
    expect(event).to.not.equal(undefined);
    expect(await btcMrs.getBatchCount()).to.equal(1n);
  });
});
