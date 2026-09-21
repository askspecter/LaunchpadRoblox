const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClaimToRBLXAdapter", function () {
  async function deployFixture() {
    const [owner, treasury, stranger] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const target = await Token.deploy();

    const Escrow = await ethers.getContractFactory("MockPonsFeeEscrow");
    const escrow = await Escrow.deploy();

    const Hook = await ethers.getContractFactory("MockPonsMemeHook");
    const hook = await Hook.deploy(escrow);

    const Router = await ethers.getContractFactory("MockSwapRouter02");
    const router = await Router.deploy(target, 2n);

    const Adapter = await ethers.getContractFactory("ClaimToRBLXAdapter");
    const adapter = await Adapter.deploy(
      owner.address,
      await escrow.getAddress(),
      await hook.getAddress(),
      await router.getAddress(),
      "0x0000000000000000000000000000000000000001",
      await target.getAddress(),
      treasury.address,
      10_000,
    );

    return { owner, treasury, stranger, target, escrow, hook, router, adapter };
  }

  it("claims native fees, swaps the exact claimed amount, and pays treasury", async function () {
    const { owner, treasury, target, escrow, adapter } = await deployFixture();
    const adapterAddress = await adapter.getAddress();
    const amountIn = ethers.parseEther("1");
    const amountOut = amountIn * 2n;
    await escrow.credit(adapterAddress, { value: amountIn });
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1_200;

    await expect(adapter.connect(owner).claimAndBuy(amountOut, deadline))
      .to.emit(adapter, "ClaimedAndBought")
      .withArgs(owner.address, treasury.address, amountIn, amountOut);

    expect(await target.balanceOf(treasury.address)).to.equal(amountOut);
    expect(await escrow.balanceOf(adapterAddress)).to.equal(0n);
    expect(await ethers.provider.getBalance(adapterAddress)).to.equal(0n);
  });

  it("rejects callers other than the owner", async function () {
    const { stranger, escrow, adapter } = await deployFixture();
    await escrow.credit(await adapter.getAddress(), { value: ethers.parseEther("1") });
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1_200;

    await expect(adapter.connect(stranger).claimAndBuy(1n, deadline))
      .to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount")
      .withArgs(stranger.address);
  });

  it("requires a non-zero minimum output", async function () {
    const { escrow, adapter } = await deployFixture();
    await escrow.credit(await adapter.getAddress(), { value: ethers.parseEther("1") });
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1_200;

    await expect(adapter.claimAndBuy(0n, deadline)).to.be.revertedWithCustomError(
      adapter,
      "MinimumOutputRequired",
    );
  });

  it("reverts after the deadline", async function () {
    const { escrow, adapter } = await deployFixture();
    await escrow.credit(await adapter.getAddress(), { value: ethers.parseEther("1") });
    const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

    await expect(adapter.claimAndBuy(1n, timestamp - 1)).to.be.revertedWithCustomError(
      adapter,
      "DeadlineExpired",
    );
  });

  it("reverts when there is nothing to claim", async function () {
    const { adapter } = await deployFixture();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1_200;

    await expect(adapter.claimAndBuy(1n, deadline)).to.be.revertedWithCustomError(
      adapter,
      "NothingToClaim",
    );
  });

  it("keeps the escrow credit intact when slippage protection fails", async function () {
    const { target, treasury, escrow, adapter } = await deployFixture();
    const adapterAddress = await adapter.getAddress();
    const amountIn = ethers.parseEther("1");
    await escrow.credit(adapterAddress, { value: amountIn });
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1_200;

    await expect(adapter.claimAndBuy(amountIn * 3n, deadline)).to.be.revertedWith(
      "TOO_LITTLE_RECEIVED",
    );

    expect(await escrow.balanceOf(adapterAddress)).to.equal(amountIn);
    expect(await target.balanceOf(treasury.address)).to.equal(0n);
  });

  it("sweeps curve fees as creator recipient before claiming and buying", async function () {
    const { treasury, target, escrow, adapter } = await deployFixture();
    const amountIn = ethers.parseEther("0.4");
    const Curve = await ethers.getContractFactory("MockPonsCurve");
    const curve = await Curve.deploy(escrow, await adapter.getAddress(), { value: amountIn });
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1_200;

    await adapter.sweepCurveClaimAndBuy(
      await curve.getAddress(),
      0n,
      amountIn * 2n,
      deadline,
    );

    expect(await target.balanceOf(treasury.address)).to.equal(amountIn * 2n);
    expect(await escrow.balanceOf(await adapter.getAddress())).to.equal(0n);
  });

  it("sweeps pool fees through the Pons hook before claiming and buying", async function () {
    const { treasury, target, escrow, hook, adapter } = await deployFixture();
    const amountIn = ethers.parseEther("0.25");
    const poolId = ethers.id("mock-pool");
    await hook.register(poolId, await adapter.getAddress(), { value: amountIn });
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1_200;

    await adapter.sweepPoolClaimAndBuy(poolId, 0n, 0n, amountIn * 2n, deadline);

    expect(await target.balanceOf(treasury.address)).to.equal(amountIn * 2n);
    expect(await escrow.balanceOf(await adapter.getAddress())).to.equal(0n);
  });
});
