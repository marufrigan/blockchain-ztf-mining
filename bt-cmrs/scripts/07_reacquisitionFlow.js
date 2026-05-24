const hre = require("hardhat");
const path = require("path");
const { loadAddresses, readJSON } = require("./helpers");

async function main() {
  const addresses = loadAddresses();
  const [, , , smelter, , auditor] = await hre.ethers.getSigners();
  const btcMrs = await hre.ethers.getContractAt("BTCMRS", addresses.btcMrs);
  const created = readJSON(path.join(__dirname, "..", "data", "created-batches.json"));

  for (const c of created) {
    const reqTx = await btcMrs.connect(smelter).requestReacquisition(c.batchId, "Quality anomaly detected");
    const reqRc = await reqTx.wait();
    const evt = reqRc.logs
      .map((x) => {
        try {
          return btcMrs.interface.parseLog(x);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "ReacquisitionRequested");
    await (await btcMrs.connect(auditor).resolveReacquisition(evt.args.requestId, 1)).wait();
    console.log("Resolved reacquisition:", evt.args.requestId);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
