const hre = require("hardhat");
const { loadAddresses, readJSON } = require("./helpers");
const path = require("path");

async function main() {
  const addresses = loadAddresses();
  const [admin, mine, logistics, smelter, manufacturer, auditor] = await hre.ethers.getSigners();
  const registry = await hre.ethers.getContractAt("StakeholderRegistry", addresses.registry);
  const data = readJSON(path.join(__dirname, "..", "data", "stakeholders.json"));

  const roleMap = {
    MINE_ROLE: await registry.MINE_ROLE(),
    LOGISTICS_ROLE: await registry.LOGISTICS_ROLE(),
    SMELTER_ROLE: await registry.SMELTER_ROLE(),
    MANUFACTURER_ROLE: await registry.MANUFACTURER_ROLE(),
    AUDITOR_ROLE: await registry.AUDITOR_ROLE()
  };
  const actorMap = { mine, logistics, smelter, manufacturer, auditor };

  for (const s of data) {
    const signer = actorMap[s.key];
    const tx = await registry.connect(admin).registerStakeholder(signer.address, roleMap[s.role], s.name, s.metadataURI);
    await tx.wait();
    console.log(`Registered ${s.name} (${s.role})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
