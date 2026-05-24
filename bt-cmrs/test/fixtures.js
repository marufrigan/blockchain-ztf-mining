const { ethers } = require("hardhat");

async function deployAll() {
  const [admin, mine, logistics, smelter, manufacturer, auditor, other] = await ethers.getSigners();

  const Registry = await ethers.getContractFactory("StakeholderRegistry");
  const registry = await Registry.deploy(admin.address);
  await registry.waitForDeployment();

  const MockVerifier = await ethers.getContractFactory("MockRegionProofVerifier");
  const verifier = await MockVerifier.deploy();
  await verifier.waitForDeployment();

  const BTCMRS = await ethers.getContractFactory("BTCMRS");
  const btcMrs = await BTCMRS.deploy(await registry.getAddress(), await verifier.getAddress());
  await btcMrs.waitForDeployment();

  const roles = {
    MINE_ROLE: await registry.MINE_ROLE(),
    LOGISTICS_ROLE: await registry.LOGISTICS_ROLE(),
    SMELTER_ROLE: await registry.SMELTER_ROLE(),
    MANUFACTURER_ROLE: await registry.MANUFACTURER_ROLE(),
    AUDITOR_ROLE: await registry.AUDITOR_ROLE()
  };

  await (await registry.registerStakeholder(mine.address, roles.MINE_ROLE, "Mine", "ipfs://mine")).wait();
  await (await registry.registerStakeholder(logistics.address, roles.LOGISTICS_ROLE, "Logistics", "ipfs://log")).wait();
  await (await registry.registerStakeholder(smelter.address, roles.SMELTER_ROLE, "Smelter", "ipfs://s")).wait();
  await (await registry.registerStakeholder(manufacturer.address, roles.MANUFACTURER_ROLE, "Manufacturer", "ipfs://m")).wait();
  await (await registry.registerStakeholder(auditor.address, roles.AUDITOR_ROLE, "Auditor", "ipfs://a")).wait();

  const regionHash = ethers.keccak256(ethers.toUtf8Bytes("region-alpha"));
  await (await btcMrs.connect(auditor).approveRegion(regionHash)).wait();

  return { admin, mine, logistics, smelter, manufacturer, auditor, other, registry, verifier, btcMrs, regionHash };
}

module.exports = { deployAll };
