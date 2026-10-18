const { expect } = require("chai");
const { deployFixture } = require("./fixtures");

describe("StakeholderRegistry", function () {
  it("registers the five supply-chain roles", async function () {
    const sys = await deployFixture({ mockVerifier: true });
    expect(await sys.registry.getStakeholderCount()).to.equal(5n);
    expect(await sys.registry.hasRole(sys.roles.AUDITOR, sys.auditor.address)).to.equal(true);
  });

  it("rejects stakeholder registration by a non-admin account", async function () {
    const sys = await deployFixture({ mockVerifier: true });
    await expect(
      sys.registry.connect(sys.mine).registerStakeholder(sys.signers[9].address, sys.roles.AUDITOR, "x", "y")
    ).to.be.reverted;
  });

  it("deactivated stakeholders lose access to role-gated functions", async function () {
    const sys = await deployFixture({ mockVerifier: true });
    await (await sys.registry.deactivateStakeholder(sys.auditor.address)).wait();
    await expect(sys.core.connect(sys.auditor).approveRegion("0x" + "11".repeat(32))).to.be.revertedWith(
      "Inactive stakeholder"
    );
  });
});
