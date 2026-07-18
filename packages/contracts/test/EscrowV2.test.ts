import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { EscrowV2, EscrowFactoryV2, MockUSDC } from "../typechain-types";

describe("EscrowV2 one-date model", function () {
  let usdc: MockUSDC;
  let usdt: MockUSDC;
  let factory: EscrowFactoryV2;

  let treasury: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  let random: SignerWithAddress;
  let arb1: SignerWithAddress;
  let arb2: SignerWithAddress;
  let arb3: SignerWithAddress;

  const DEC = 6;
  const ONE = ethers.parseUnits("1", DEC);
  const TARGET = ethers.parseUnits("100", DEC);
  const TERMS = ethers.keccak256(ethers.toUtf8Bytes("deliverables: build a website"));
  const ONE_DAY = 24 * 60 * 60;
  const ONE_WEEK = 7 * ONE_DAY;
  const THIRTY_DAYS = 30 * ONE_DAY;
  const ZERO = ethers.ZeroAddress;

  const S = {
    CREATED: 0,
    ACTIVE: 1,
    PENDING: 2,
    SETTLED: 3,
    REFUNDED: 4,
  };

  beforeEach(async function () {
    [, treasury, seller, buyer, random, arb1, arb2, arb3] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockUSDC");
    usdc = await MockToken.deploy("Mock USDC", "USDC", 6);
    await usdc.waitForDeployment();
    usdt = await MockToken.deploy("Mock USDT", "USDT", 6);
    await usdt.waitForDeployment();

    const Factory = await ethers.getContractFactory("EscrowFactoryV2");
    factory = await Factory.deploy(treasury.address, await usdc.getAddress(), await usdt.getAddress());
    await factory.waitForDeployment();

    for (const who of [buyer, random]) {
      await usdc.mint(who.address, ethers.parseUnits("10000", DEC));
      await usdt.mint(who.address, ethers.parseUnits("10000", DEC));
    }
  });

  async function createEscrow(opts?: {
    settlementOffset?: number;
    token?: MockUSDC;
    arb1?: string;
    arb2?: string;
    arb3?: string;
    target?: bigint;
  }): Promise<EscrowV2> {
    const now = await time.latest();
    const tokenAddress = await (opts?.token ?? usdc).getAddress();
    const tx = await factory.createEscrowSimple(
      seller.address,
      buyer.address,
      tokenAddress,
      opts?.target ?? TARGET,
      now + (opts?.settlementOffset ?? ONE_WEEK),
      TERMS,
      opts?.arb1 ?? ZERO,
      opts?.arb2 ?? ZERO,
      opts?.arb3 ?? ZERO
    );
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => log.fragment?.name === "EscrowCreated");
    const escrowAddress = (event as any).args.escrow;
    return ethers.getContractAt("EscrowV2", escrowAddress);
  }

  async function fund(escrow: EscrowV2, amount: bigint = TARGET, token: MockUSDC = usdc) {
    await token.connect(buyer).transfer(await escrow.getAddress(), amount);
  }

  async function activate(escrow: EscrowV2) {
    await fund(escrow);
    await escrow.connect(seller).sellerConfirm();
  }

  async function passSettlement() {
    await time.increase(ONE_WEEK + 1);
  }

  describe("creation", function () {
    it("sets immutables and emits one settlement date", async function () {
      const now = await time.latest();
      const settlementDate = now + ONE_WEEK;

      await expect(
        factory.createEscrowSimple(
          seller.address,
          buyer.address,
          await usdc.getAddress(),
          TARGET,
          settlementDate,
          TERMS,
          ZERO,
          ZERO,
          ZERO
        )
      ).to.emit(factory, "EscrowCreated").withArgs(
        anyValue,
        buyer.address,
        seller.address,
        await usdc.getAddress(),
        TARGET,
        settlementDate,
        anyValue,
        TERMS,
        0,
        ZERO,
        ZERO,
        ZERO
      );

      const escrow = await createEscrow();
      expect(await escrow.sellerWallet()).to.equal(seller.address);
      expect(await escrow.buyerRefundWallet()).to.equal(buyer.address);
      expect(await escrow.targetAmount()).to.equal(TARGET);
      expect(await escrow.settlementDate()).to.be.greaterThan(0);
      expect(await escrow.status()).to.equal(S.CREATED);
      expect(await escrow.arbitrationMode()).to.equal(0);
    });

    it("rejects invalid creation parameters", async function () {
      const now = await time.latest();
      await expect(
        factory.createEscrowSimple(
          seller.address,
          buyer.address,
          await usdc.getAddress(),
          TARGET,
          now,
          TERMS,
          ZERO,
          ZERO,
          ZERO
        )
      ).to.be.revertedWith("Factory: settlement in past");

      await expect(createEscrow({ target: ethers.parseUnits("0.5", DEC) }))
        .to.be.revertedWith("Factory: target below minimum");

      await expect(createEscrow({ arb1: arb1.address, arb2: arb2.address }))
        .to.be.revertedWith("Factory: must have 0, 1, or 3 arbitrators");

      await expect(createEscrow({ arb1: seller.address }))
        .to.be.revertedWith("Factory: arb1 is party");
    });
  });

  describe("sellerConfirm", function () {
    it("is optional but marks a fully funded CREATED escrow active", async function () {
      const escrow = await createEscrow();
      await fund(escrow);

      await expect(escrow.connect(seller).sellerConfirm())
        .to.emit(escrow, "SellerConfirmed")
        .withArgs(seller.address, TARGET, anyValue);

      expect(await escrow.status()).to.equal(S.ACTIVE);
    });

    it("requires seller, CREATED status, and live full funding", async function () {
      const escrow = await createEscrow();
      await fund(escrow, TARGET - ONE);
      await expect(escrow.connect(seller).sellerConfirm()).to.be.revertedWith("Escrow: not funded");
      await fund(escrow, ONE);
      await expect(escrow.connect(buyer).sellerConfirm()).to.be.revertedWith("Escrow: not seller");
      await escrow.connect(seller).sellerConfirm();
      await expect(escrow.connect(seller).sellerConfirm()).to.be.revertedWith("Escrow: not in created state");
    });
  });

  describe("refundUnderfunded", function () {
    it("refunds current balance to buyer only from underfunded CREATED after settlement date", async function () {
      const escrow = await createEscrow();
      const partial = ethers.parseUnits("40", DEC);
      await fund(escrow, partial);

      await expect(escrow.connect(random).refundUnderfunded()).to.be.revertedWith("Escrow: settlement date not reached");
      await passSettlement();

      const before = await usdc.balanceOf(buyer.address);
      await expect(escrow.connect(random).refundUnderfunded())
        .to.emit(escrow, "UnderfundedRefunded")
        .withArgs(buyer.address, partial, anyValue);
      expect((await usdc.balanceOf(buyer.address)) - before).to.equal(partial);
      expect(await escrow.status()).to.equal(S.REFUNDED);
    });

    it("does not refund fully funded CREATED escrows or ACTIVE escrows", async function () {
      const fundedCreated = await createEscrow();
      await fund(fundedCreated);
      await passSettlement();
      await expect(fundedCreated.connect(random).refundUnderfunded()).to.be.revertedWith("Escrow: funded");

      const active = await createEscrow();
      await activate(active);
      await passSettlement();
      await expect(active.connect(random).refundUnderfunded()).to.be.revertedWith("Escrow: not in created state");
    });
  });

  describe("settle", function () {
    it("settles a fully funded CREATED escrow after settlement date without seller confirmation", async function () {
      const escrow = await createEscrow();
      await fund(escrow);
      await passSettlement();

      const fee = await escrow.calculateFee(TARGET);
      const beforeSeller = await usdc.balanceOf(seller.address);
      const beforeTreasury = await usdc.balanceOf(treasury.address);

      await expect(escrow.connect(random).settle()).to.emit(escrow, "Settled");

      expect((await usdc.balanceOf(seller.address)) - beforeSeller).to.equal(TARGET - fee);
      expect((await usdc.balanceOf(treasury.address)) - beforeTreasury).to.equal(fee);
      expect(await escrow.status()).to.equal(S.SETTLED);
    });

    it("settles an ACTIVE escrow after settlement date", async function () {
      const escrow = await createEscrow();
      await activate(escrow);
      await passSettlement();
      await escrow.connect(random).settle();
      expect(await escrow.status()).to.equal(S.SETTLED);
    });

    it("requires settlement date, full funding, and no arbitrators", async function () {
      const escrow = await createEscrow();
      await fund(escrow);
      await expect(escrow.connect(random).settle()).to.be.revertedWith("Escrow: settlement date not reached");

      const underfunded = await createEscrow();
      await fund(underfunded, TARGET - ONE);
      await passSettlement();
      await expect(underfunded.connect(random).settle()).to.be.revertedWith("Escrow: not funded");

      const arbitrated = await createEscrow({ arb1: arb1.address });
      await fund(arbitrated);
      await passSettlement();
      await expect(arbitrated.connect(random).settle()).to.be.revertedWith("Escrow: has arbitrators");
    });
  });

  describe("mutual resolution", function () {
    it("mutual settle works from CREATED when fully funded", async function () {
      const escrow = await createEscrow();
      await fund(escrow);
      const fee = await escrow.calculateFee(TARGET);
      const beforeSeller = await usdc.balanceOf(seller.address);

      await escrow.connect(buyer).approveMutualSettle();
      await escrow.connect(seller).approveMutualSettle();

      expect((await usdc.balanceOf(seller.address)) - beforeSeller).to.equal(TARGET - fee);
      expect(await escrow.status()).to.equal(S.SETTLED);
    });

    it("mutual refund works from CREATED and refunds current balance", async function () {
      const escrow = await createEscrow();
      const partial = ethers.parseUnits("40", DEC);
      await fund(escrow, partial);
      const beforeBuyer = await usdc.balanceOf(buyer.address);

      await escrow.connect(seller).approveMutualRefund();
      await escrow.connect(buyer).approveMutualRefund();

      expect((await usdc.balanceOf(buyer.address)) - beforeBuyer).to.equal(partial);
      expect(await escrow.status()).to.equal(S.REFUNDED);
    });

    it("arbitrated mutual resolution enters pending and finalizes after override window", async function () {
      const escrow = await createEscrow({ arb1: arb1.address });
      await fund(escrow);

      await escrow.connect(buyer).approveMutualSettle();
      await expect(escrow.connect(seller).approveMutualSettle()).to.emit(escrow, "MutualResolutionPending");
      expect(await escrow.status()).to.equal(S.PENDING);

      await time.increase(THIRTY_DAYS + 1);
      await escrow.connect(random).finalizeMutualResolution();
      expect(await escrow.status()).to.equal(S.SETTLED);
    });

    it("prevents mutual settle when not fully funded", async function () {
      const escrow = await createEscrow();
      await fund(escrow, TARGET - ONE);
      await escrow.connect(buyer).approveMutualSettle();
      await expect(escrow.connect(seller).approveMutualSettle()).to.be.revertedWith("Escrow: not funded");
    });
  });

  describe("arbitration", function () {
    it("one arbitrator can resolve fully funded CREATED escrow after settlement date", async function () {
      const escrow = await createEscrow({ arb1: arb1.address });
      await fund(escrow);
      await passSettlement();

      await escrow.connect(arb1).arbSettle();
      expect(await escrow.status()).to.equal(S.SETTLED);
    });

    it("one arbitrator can refund fully funded CREATED escrow after settlement date", async function () {
      const escrow = await createEscrow({ arb1: arb1.address });
      await fund(escrow);
      await passSettlement();

      const beforeBuyer = await usdc.balanceOf(buyer.address);
      await escrow.connect(arb1).arbRefund();
      expect((await usdc.balanceOf(buyer.address)) - beforeBuyer).to.equal(TARGET);
      expect(await escrow.status()).to.equal(S.REFUNDED);
    });

    it("requires arbitrator role, settlement date, and full funding", async function () {
      const escrow = await createEscrow({ arb1: arb1.address });
      await fund(escrow);
      await expect(escrow.connect(arb1).arbSettle()).to.be.revertedWith("Escrow: not votable");
      await passSettlement();
      await expect(escrow.connect(random).arbSettle()).to.be.revertedWith("Escrow: not arbitrator");

      const underfunded = await createEscrow({ arb1: arb1.address });
      await fund(underfunded, TARGET - ONE);
      await passSettlement();
      await expect(underfunded.connect(arb1).arbRefund()).to.be.revertedWith("Escrow: not votable");
    });

    it("three arbitrators require two matching votes", async function () {
      const escrow = await createEscrow({ arb1: arb1.address, arb2: arb2.address, arb3: arb3.address });
      await fund(escrow);
      await passSettlement();

      await escrow.connect(arb1).arbVoteSettle();
      expect(await escrow.status()).to.equal(S.CREATED);
      await escrow.connect(arb2).arbVoteSettle();
      expect(await escrow.status()).to.equal(S.SETTLED);
    });
  });

  describe("recovery and helpers", function () {
    it("recovers accepted token sent after terminal resolution to buyer", async function () {
      const escrow = await createEscrow();
      await fund(escrow);
      await passSettlement();
      await escrow.connect(random).settle();

      await usdc.connect(random).transfer(await escrow.getAddress(), ethers.parseUnits("10", DEC));
      const beforeBuyer = await usdc.balanceOf(buyer.address);

      await expect(escrow.connect(random).recoverLatePaymentToken())
        .to.emit(escrow, "LatePaymentTokenRecovered")
        .withArgs(buyer.address, ethers.parseUnits("10", DEC), anyValue);

      expect((await usdc.balanceOf(buyer.address)) - beforeBuyer).to.equal(ethers.parseUnits("10", DEC));
    });

    it("sweeps only excess before terminal and rejects accepted-token sweep after terminal", async function () {
      const escrow = await createEscrow();
      await fund(escrow, TARGET + ONE);
      const beforeTreasury = await usdc.balanceOf(treasury.address);
      await escrow.connect(random).sweepExcess();
      expect((await usdc.balanceOf(treasury.address)) - beforeTreasury).to.equal(ONE);
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(TARGET);

      await passSettlement();
      await escrow.connect(random).settle();
      await expect(escrow.connect(random).sweepExcess()).to.be.revertedWith("Escrow: terminal");
    });

    it("sweeps wrong tokens to treasury", async function () {
      const escrow = await createEscrow();
      await usdt.connect(random).transfer(await escrow.getAddress(), ethers.parseUnits("5", DEC));
      const beforeTreasury = await usdt.balanceOf(treasury.address);
      await escrow.connect(random).sweepStrayToken(await usdt.getAddress(), ethers.parseUnits("5", DEC));
      expect((await usdt.balanceOf(treasury.address)) - beforeTreasury).to.equal(ethers.parseUnits("5", DEC));
      await expect(escrow.connect(random).sweepStrayToken(await usdc.getAddress(), ONE))
        .to.be.revertedWith("Escrow: use sweepExcess");
    });

    it("reports actionable state from live balance and status", async function () {
      const escrow = await createEscrow();
      expect(await escrow.isActivatable()).to.equal(false);
      await fund(escrow);
      expect(await escrow.isActivatable()).to.equal(true);
      expect(await escrow.isSettleable()).to.equal(false);
      await passSettlement();
      expect(await escrow.isSettleable()).to.equal(true);

      const underfunded = await createEscrow();
      await fund(underfunded, TARGET - ONE);
      await passSettlement();
      expect(await underfunded.isRefundableUnderfunded()).to.equal(true);
    });
  });
});
