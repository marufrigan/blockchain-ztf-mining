const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployAll } = require("./fixtures");

describe("StakeholderRegistry", function () {
  it("registers stakeholders and roles", async function () {
    const { registry, mine } = await deployAll();
    expect(await registry.isActive(mine.address)).to.equal(true);
    expect(await registry.getStakeholderCount()).to.equal(5n);
  });

  it("deactivates stakeholder", async function () {
    const { registry, admin, mine } = await deployAll();
    await (await registry.connect(admin).deactivateStakeholder(mine.address)).wait();
    expect(await registry.isActive(mine.address)).to.equal(false);
  });
});
