const hre = require("hardhat");
const { saveAddresses } = require("./helpers");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const Registry = await hre.ethers.getContractFactory("StakeholderRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();

  const Verifier = await hre.ethers.getContractFactory("RegionProofVerifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();

  const BTCMRS = await hre.ethers.getContractFactory("BTCMRS");
  const btcMrs = await BTCMRS.deploy(await registry.getAddress(), await verifier.getAddress());
  const btcMrsDeployTx = btcMrs.deploymentTransaction();
  await btcMrs.waitForDeployment();

  const addresses = {
    network: hre.network.name,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    registry: await registry.getAddress(),
    verifier: await verifier.getAddress(),
    btcMrs: await btcMrs.getAddress(),
    btcMrsDeploymentTxHash: btcMrsDeployTx ? btcMrsDeployTx.hash : null
  };

  saveAddresses(addresses);
  console.log(addresses);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
