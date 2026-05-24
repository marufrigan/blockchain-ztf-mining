const hre = require("hardhat");
const path = require("path");
const { loadAddresses, readJSON } = require("./helpers");

async function main() {
  const addresses = loadAddresses();
  const [, , logistics, smelter, manufacturer] = await hre.ethers.getSigners();
  const btcMrs = await hre.ethers.getContractAt("BTCMRS", addresses.btcMrs);
  const created = readJSON(path.join(__dirname, "..", "data", "created-batches.json"));

  for (const c of created) {
    await (await btcMrs.connect(logistics).updateBatchStatus(c.batchId, 2, "Mine to Smelter Route")).wait();
    await (await btcMrs.connect(smelter).updateBatchStatus(c.batchId, 3, "Smelter Dock")).wait();
    await (await btcMrs.connect(smelter).updateBatchStatus(c.batchId, 4, "Smelter Processing Unit")).wait();
    await (await btcMrs.connect(manufacturer).updateBatchStatus(c.batchId, 5, "Manufacturer Intake")).wait();
    await (await btcMrs.connect(manufacturer).updateBatchStatus(c.batchId, 6, "Manufacturing Complete")).wait();
    console.log("Lifecycle updated:", c.batchId);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
