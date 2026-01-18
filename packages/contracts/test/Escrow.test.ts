import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Escrow, EscrowFactory, MockUSDC } from "../typechain-types";

describe("Escrow", function () {
  let usdc: MockUSDC;
  let usdt: MockUSDC;
  let factory: EscrowFactory;
  let escrow: Escrow;
  
  let owner: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let seller: SignerWithAddress;  // payout
  let buyer: SignerWithAddress;   // funder
  let random: SignerWithAddress;
  let arb1: SignerWithAddress;
  let arb2: SignerWithAddress;
  let arb3: SignerWithAddress;  // Deadlock arbitrator
  
  const TOKEN_DECIMALS = 6;
  const ONE_TOKEN = ethers.parseUnits("1", TOKEN_DECIMALS);
  const TARGET_AMOUNT = ethers.parseUnits("100", TOKEN_DECIMALS);
  const BOND_CAP = ONE_TOKEN; // $1 bond cap
  const ONE_USDC = ONE_TOKEN;
  
  const ONE_DAY = 24 * 60 * 60;
  const ONE_WEEK = 7 * ONE_DAY;

  beforeEach(async function () {
    [owner, oracle, treasury, seller, buyer, random, arb1, arb2, arb3] = await ethers.getSigners();
    
    // Deploy MockUSDC and MockUSDT
    const MockToken = await ethers.getContractFactory("MockUSDC");
    usdc = await MockToken.deploy("Mock USDC", "USDC", 6);
    await usdc.waitForDeployment();
    
    usdt = await MockToken.deploy("Mock USDT", "USDT", 6);
    await usdt.waitForDeployment();
    
    // Deploy Factory with both tokens allowed
    const Factory = await ethers.getContractFactory("EscrowFactory");
    factory = await Factory.deploy(
      oracle.address,
      treasury.address,
      await usdc.getAddress(),
      await usdt.getAddress(),
      BOND_CAP
    );
    await factory.waitForDeployment();
    
    // Mint USDC and USDT to seller and buyer
    await usdc.mint(seller.address, ethers.parseUnits("10000", TOKEN_DECIMALS));
    await usdc.mint(buyer.address, ethers.parseUnits("10000", TOKEN_DECIMALS));
    await usdt.mint(seller.address, ethers.parseUnits("10000", TOKEN_DECIMALS));
    await usdt.mint(buyer.address, ethers.parseUnits("10000", TOKEN_DECIMALS));
  });

  // Helper to create escrow with 0, 1, or 3 arbitrators (never 2)
  async function createEscrow(
    deadlineOffset: number = ONE_WEEK,
    token?: MockUSDC,
    arbitrator1: string = ethers.ZeroAddress,
    arbitrator2: string = ethers.ZeroAddress,
    arbitrator3: string = ethers.ZeroAddress
  ): Promise<Escrow> {
    const deadline = (await time.latest()) + deadlineOffset;
    const tokenAddress = token ? await token.getAddress() : await usdc.getAddress();
    
    const tx = await factory.createEscrowSimple(
      seller.address,
      buyer.address,
      tokenAddress,
      TARGET_AMOUNT,
      deadline,
      arbitrator1,
      arbitrator2,
      arbitrator3
    );
    const receipt = await tx.wait();
    
    // Get escrow address from event
    const event = receipt?.logs.find(
      (log: any) => log.fragment?.name === "EscrowCreated"
    );
    const escrowAddress = (event as any).args[0];
    
    return ethers.getContractAt("Escrow", escrowAddress);
  }

  describe("Creation", function () {
    it("should create escrow with correct immutable values", async function () {
      escrow = await createEscrow();
      
      expect(await escrow.payout()).to.equal(seller.address);
      expect(await escrow.funder()).to.equal(buyer.address);
      expect(await escrow.targetAmount()).to.equal(TARGET_AMOUNT);
      expect(await escrow.bondCap()).to.equal(BOND_CAP);
      // Legacy compatibility
      expect(await escrow.confirmationAmount()).to.equal(BOND_CAP);
      expect(await escrow.phase()).to.equal(0); // AwaitingConfirmation
    });

    it("should set confirmDeadline to 24h from creation", async function () {
      escrow = await createEscrow();
      
      const createdAt = await escrow.createdAt();
      const confirmDeadline = await escrow.confirmDeadline();
      
      expect(confirmDeadline - createdAt).to.equal(ONE_DAY);
    });

    it("should set arbWindowEnd to deadline + 7 days", async function () {
      escrow = await createEscrow();
      
      const deadline = await escrow.deadline();
      const arbWindowEnd = await escrow.arbWindowEnd();
      
      expect(arbWindowEnd - deadline).to.equal(ONE_WEEK);
    });

    it("should reject creation with payout == funder", async function () {
      const deadline = (await time.latest()) + ONE_WEEK;
      
      await expect(
        factory.createEscrowSimple(
          seller.address,
          seller.address,
          await usdc.getAddress(),
          TARGET_AMOUNT,
          deadline,
          ethers.ZeroAddress,
          ethers.ZeroAddress
        )
      ).to.be.revertedWith("Factory: payout == funder");
    });

    it("should reject creation with deadline in past", async function () {
      const deadline = (await time.latest()) - 1;
      
      await expect(
        factory.createEscrowSimple(
          seller.address,
          buyer.address,
          await usdc.getAddress(),
          TARGET_AMOUNT,
          deadline,
          ethers.ZeroAddress,
          ethers.ZeroAddress
        )
      ).to.be.revertedWith("Factory: deadline in past");
    });
  });

  describe("Seller Self-Confirmation (no bond)", function () {
    beforeEach(async function () {
      escrow = await createEscrow();
    });

    it("should allow seller to self-confirm within 24h window", async function () {
      await escrow.connect(seller).confirm();
      
      expect(await escrow.confirmed()).to.be.true;
      expect(await escrow.bondPresent()).to.be.false;
      expect(await escrow.phase()).to.equal(1); // ConfirmedAwaitingFunding
    });

    it("should emit ConfirmedBySeller event", async function () {
      await expect(escrow.connect(seller).confirm())
        .to.emit(escrow, "ConfirmedBySeller")
        .withArgs(seller.address);
    });

    it("should reject self-confirm from non-seller", async function () {
      await expect(
        escrow.connect(buyer).confirm()
      ).to.be.revertedWith("Escrow: not seller");
    });

    it("should reject self-confirm after 24h window", async function () {
      await time.increase(ONE_DAY + 1);
      
      await expect(
        escrow.connect(seller).confirm()
      ).to.be.revertedWith("Escrow: confirm window closed");
    });

    it("should reject double self-confirm", async function () {
      await escrow.connect(seller).confirm();
      
      await expect(
        escrow.connect(seller).confirm()
      ).to.be.revertedWith("Escrow: already confirmed");
    });

    it("legacy: confirmationRecorded() should return confirmed status", async function () {
      expect(await escrow.confirmationRecorded()).to.be.false;
      await escrow.connect(seller).confirm();
      expect(await escrow.confirmationRecorded()).to.be.true;
    });
  });

  describe("Oracle Bond-Based Confirmation", function () {
    beforeEach(async function () {
      escrow = await createEscrow();
    });

    it("should allow oracle to confirm when bond is present", async function () {
      // Seller sends $1 bond to escrow
      await usdc.connect(seller).transfer(await escrow.getAddress(), BOND_CAP);
      
      // Oracle confirms with bond
      await escrow.connect(oracle).confirmByOracle(
        ethers.keccak256(ethers.toUtf8Bytes("tx1"))
      );
      
      expect(await escrow.confirmed()).to.be.true;
      expect(await escrow.bondPresent()).to.be.true;
      expect(await escrow.phase()).to.equal(1); // ConfirmedAwaitingFunding
    });

    it("should emit ConfirmedByOracle event", async function () {
      await usdc.connect(seller).transfer(await escrow.getAddress(), BOND_CAP);
      
      await expect(escrow.connect(oracle).confirmByOracle(
        ethers.keccak256(ethers.toUtf8Bytes("tx1"))
      ))
        .to.emit(escrow, "ConfirmedByOracle")
        .withArgs(ethers.keccak256(ethers.toUtf8Bytes("tx1")), BOND_CAP);
    });

    it("should reject oracle confirm without bond present", async function () {
      await expect(
        escrow.connect(oracle).confirmByOracle(
          ethers.keccak256(ethers.toUtf8Bytes("tx1"))
        )
      ).to.be.revertedWith("Escrow: bond not received");
    });

    it("should reject oracle confirm from non-oracle", async function () {
      await usdc.connect(seller).transfer(await escrow.getAddress(), BOND_CAP);
      
      await expect(
        escrow.connect(random).confirmByOracle(
          ethers.keccak256(ethers.toUtf8Bytes("tx1"))
        )
      ).to.be.revertedWith("Escrow: not oracle");
    });

    it("should reject oracle confirm after 24h window", async function () {
      await usdc.connect(seller).transfer(await escrow.getAddress(), BOND_CAP);
      await time.increase(ONE_DAY + 1);
      
      await expect(
        escrow.connect(oracle).confirmByOracle(
          ethers.keccak256(ethers.toUtf8Bytes("tx1"))
        )
      ).to.be.revertedWith("Escrow: confirm window closed");
    });

    it("should reject oracle confirm if already self-confirmed", async function () {
      await escrow.connect(seller).confirm();
      
      await usdc.connect(seller).transfer(await escrow.getAddress(), BOND_CAP);
      
      await expect(
        escrow.connect(oracle).confirmByOracle(
          ethers.keccak256(ethers.toUtf8Bytes("tx1"))
        )
      ).to.be.revertedWith("Escrow: already confirmed");
    });
  });

  describe("Derived Funding (balance-based)", function () {
    beforeEach(async function () {
      escrow = await createEscrow();
      await escrow.connect(seller).confirm();
    });

    it("isFunded() returns false when balance < targetAmount", async function () {
      expect(await escrow.isFunded()).to.be.false;
      
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT / 2n);
      expect(await escrow.isFunded()).to.be.false;
    });

    it("isFunded() returns true when balance >= targetAmount (self-confirm)", async function () {
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      expect(await escrow.isFunded()).to.be.true;
    });

    it("isFunded() accounts for bond when bondPresent", async function () {
      // Create fresh escrow with oracle confirm (bond)
      const escrow2 = await createEscrow();
      await usdc.connect(seller).transfer(await escrow2.getAddress(), BOND_CAP);
      await escrow2.connect(oracle).confirmByOracle(ethers.keccak256(ethers.toUtf8Bytes("tx1")));
      
      // Balance = bondCap, but funding needs targetAmount ON TOP of bond
      expect(await escrow2.isFunded()).to.be.false;
      
      // Add targetAmount
      await usdc.connect(buyer).transfer(await escrow2.getAddress(), TARGET_AMOUNT);
      expect(await escrow2.isFunded()).to.be.true;
    });

    it("fundedAmount() returns correct value (self-confirm, no bond)", async function () {
      expect(await escrow.fundedAmount()).to.equal(0);
      
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT / 2n);
      expect(await escrow.fundedAmount()).to.equal(TARGET_AMOUNT / 2n);
      
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT / 2n);
      expect(await escrow.fundedAmount()).to.equal(TARGET_AMOUNT);
    });

    it("fundedAmount() subtracts bond when bondPresent", async function () {
      const escrow2 = await createEscrow();
      await usdc.connect(seller).transfer(await escrow2.getAddress(), BOND_CAP);
      await escrow2.connect(oracle).confirmByOracle(ethers.keccak256(ethers.toUtf8Bytes("tx1")));
      
      // Balance = bondCap, fundedAmount should be 0
      expect(await escrow2.fundedAmount()).to.equal(0);
      
      await usdc.connect(buyer).transfer(await escrow2.getAddress(), TARGET_AMOUNT);
      expect(await escrow2.fundedAmount()).to.equal(TARGET_AMOUNT);
    });

    it("phase() returns 2 (Funded) when confirmed and isFunded", async function () {
      expect(await escrow.phase()).to.equal(1); // ConfirmedAwaitingFunding
      
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      expect(await escrow.phase()).to.equal(2); // Funded
    });

    it("legacy: fundingRecorded() returns isFunded()", async function () {
      expect(await escrow.fundingRecorded()).to.be.false;
      
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      expect(await escrow.fundingRecorded()).to.be.true;
    });

    it("legacy: fundedRecorded() returns fundedAmount()", async function () {
      expect(await escrow.fundedRecorded()).to.equal(0);
      
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT / 2n);
      expect(await escrow.fundedRecorded()).to.equal(TARGET_AMOUNT / 2n);
    });
  });

  describe("Fee Calculation", function () {
    beforeEach(async function () {
      escrow = await createEscrow();
    });

    it("should calculate 1% fee for amounts at or below $100", async function () {
      const amount = ethers.parseUnits("50", TOKEN_DECIMALS);
      const fee = await escrow.calculateFee(amount);
      expect(fee).to.equal(ethers.parseUnits("0.5", TOKEN_DECIMALS));
    });

    it("should calculate 1% fee for exactly $100", async function () {
      const amount = ethers.parseUnits("100", TOKEN_DECIMALS);
      const fee = await escrow.calculateFee(amount);
      expect(fee).to.equal(ethers.parseUnits("1", TOKEN_DECIMALS));
    });

    it("should cap fee at $1 for amounts above $100", async function () {
      const amount = ethers.parseUnits("500", TOKEN_DECIMALS);
      const fee = await escrow.calculateFee(amount);
      expect(fee).to.equal(ethers.parseUnits("1", TOKEN_DECIMALS));
    });

    it("should enforce minimum fee of $0.01", async function () {
      const amount = ethers.parseUnits("0.5", TOKEN_DECIMALS);
      const fee = await escrow.calculateFee(amount);
      expect(fee).to.equal(ethers.parseUnits("0.01", TOKEN_DECIMALS));
    });
  });

  describe("Finalize (no arbitrators)", function () {
    const EXPECTED_FEE = ethers.parseUnits("1", TOKEN_DECIMALS); // 1% of $100
    const SELLER_PRINCIPAL = TARGET_AMOUNT - EXPECTED_FEE;

    describe("with seller self-confirm (no bond)", function () {
      beforeEach(async function () {
        escrow = await createEscrow();
        await escrow.connect(seller).confirm();
        await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      });

      it("should finalize correctly with fee to treasury", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        const sellerBalBefore = await usdc.balanceOf(seller.address);
        const treasuryBalBefore = await usdc.balanceOf(treasury.address);
        
        await escrow.connect(random).finalizeAfterDeadline();
        
        expect(await escrow.resolved()).to.be.true;
        expect(await escrow.phase()).to.equal(3); // Resolved
        
        const sellerBalAfter = await usdc.balanceOf(seller.address);
        const treasuryBalAfter = await usdc.balanceOf(treasury.address);
        
        // Seller gets principal (no bond to return)
        expect(sellerBalAfter - sellerBalBefore).to.equal(SELLER_PRINCIPAL);
        // Treasury gets fee only
        expect(treasuryBalAfter - treasuryBalBefore).to.equal(EXPECTED_FEE);
      });

      it("should emit FinalizedPaid with bondReturned=0", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        await expect(escrow.connect(random).finalizeAfterDeadline())
          .to.emit(escrow, "FinalizedPaid")
          .withArgs(
            seller.address,
            SELLER_PRINCIPAL,
            EXPECTED_FEE,
            0, // bondReturned = 0 (self-confirmed)
            0, // excessSwept = 0
            treasury.address
          );
      });
    });

    describe("with oracle confirm (bond present)", function () {
      beforeEach(async function () {
        escrow = await createEscrow();
        await usdc.connect(seller).transfer(await escrow.getAddress(), BOND_CAP);
        await escrow.connect(oracle).confirmByOracle(ethers.keccak256(ethers.toUtf8Bytes("tx1")));
        await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      });

      it("should finalize correctly with bond returned to seller", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        const sellerBalBefore = await usdc.balanceOf(seller.address);
        const treasuryBalBefore = await usdc.balanceOf(treasury.address);
        
        await escrow.connect(random).finalizeAfterDeadline();
        
        const sellerBalAfter = await usdc.balanceOf(seller.address);
        const treasuryBalAfter = await usdc.balanceOf(treasury.address);
        
        // Seller gets principal + bond back
        expect(sellerBalAfter - sellerBalBefore).to.equal(SELLER_PRINCIPAL + BOND_CAP);
        // Treasury gets fee only
        expect(treasuryBalAfter - treasuryBalBefore).to.equal(EXPECTED_FEE);
      });

      it("should emit FinalizedPaid with bondReturned=bondCap", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        await expect(escrow.connect(random).finalizeAfterDeadline())
          .to.emit(escrow, "FinalizedPaid")
          .withArgs(
            seller.address,
            SELLER_PRINCIPAL,
            EXPECTED_FEE,
            BOND_CAP, // bondReturned
            0, // excessSwept
            treasury.address
          );
      });
    });

    describe("with excess funds", function () {
      it("should sweep excess to treasury", async function () {
        escrow = await createEscrow();
        await escrow.connect(seller).confirm();
        
        const excess = ethers.parseUnits("10", TOKEN_DECIMALS);
        await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT + excess);
        
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        const treasuryBalBefore = await usdc.balanceOf(treasury.address);
        
        await escrow.finalizeAfterDeadline();
        
        const treasuryBalAfter = await usdc.balanceOf(treasury.address);
        // Treasury gets fee + excess
        expect(treasuryBalAfter - treasuryBalBefore).to.equal(EXPECTED_FEE + excess);
      });
    });

    it("should reject finalize before deadline", async function () {
      escrow = await createEscrow();
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      await expect(
        escrow.connect(random).finalizeAfterDeadline()
      ).to.be.revertedWith("Escrow: deadline not reached");
    });

    it("should reject finalize if not confirmed", async function () {
      escrow = await createEscrow();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      await expect(
        escrow.connect(random).finalizeAfterDeadline()
      ).to.be.revertedWith("Escrow: not confirmed");
    });

    it("should reject finalize if not funded", async function () {
      escrow = await createEscrow();
      await escrow.connect(seller).confirm();
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      await expect(
        escrow.connect(random).finalizeAfterDeadline()
      ).to.be.revertedWith("Escrow: not funded");
    });

    it("should reject finalize if arbitrators exist", async function () {
      escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      await expect(
        escrow.connect(random).finalizeAfterDeadline()
      ).to.be.revertedWith("Escrow: has arbitrators");
    });
  });

  describe("Arbitration (with arbitrators)", function () {
    const EXPECTED_FEE = ethers.parseUnits("1", TOKEN_DECIMALS);
    const SELLER_PRINCIPAL = TARGET_AMOUNT - EXPECTED_FEE;

    describe("Single arbitrator (1-arb mode)", function () {
      beforeEach(async function () {
        // 1-arb mode: only arb1 set
        escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
        await escrow.connect(seller).confirm();
        await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      });

      it("should have arbitratorCount = 1", async function () {
        expect(await escrow.arbitratorCount()).to.equal(1);
      });

      it("should reject arb action before deadline", async function () {
        await expect(
          escrow.connect(arb1).arbitratorRelease()
        ).to.be.revertedWith("Escrow: before deadline");
      });

      it("should allow arb release during arb window - first vote resolves immediately", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        const sellerBalBefore = await usdc.balanceOf(seller.address);
        
        await escrow.connect(arb1).arbitratorRelease();
        
        expect(await escrow.resolved()).to.be.true;
        
        const sellerBalAfter = await usdc.balanceOf(seller.address);
        expect(sellerBalAfter - sellerBalBefore).to.equal(SELLER_PRINCIPAL); // no bond
      });

      it("should allow arb refund during arb window - first vote resolves immediately", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        const buyerBalBefore = await usdc.balanceOf(buyer.address);
        
        await escrow.connect(arb1).arbitratorRefund();
        
        expect(await escrow.resolved()).to.be.true;
        
        const buyerBalAfter = await usdc.balanceOf(buyer.address);
        expect(buyerBalAfter - buyerBalBefore).to.equal(TARGET_AMOUNT);
      });

      it("should reject arb action after arb window", async function () {
        const arbWindowEnd = await escrow.arbWindowEnd();
        await time.increaseTo(arbWindowEnd + 1n);
        
        await expect(
          escrow.connect(arb1).arbitratorRelease()
        ).to.be.revertedWith("Escrow: arb window closed");
      });

      it("should reject non-arb from calling arb functions", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        await expect(
          escrow.connect(random).arbitratorRelease()
        ).to.be.revertedWith("Escrow: not arbitrator");
      });

      it("1-arb unresolved: should sweep to treasury after arb window (no vote)", async function () {
        // Arb window passes with no vote
        const arbWindowEnd = await escrow.arbWindowEnd();
        await time.increaseTo(arbWindowEnd + 1n);
        
        const treasuryBalBefore = await usdc.balanceOf(treasury.address);
        
        await escrow.connect(random).sweepToTreasuryAfterArbWindow();
        
        expect(await escrow.resolved()).to.be.true;
        
        const treasuryBalAfter = await usdc.balanceOf(treasury.address);
        // All funds swept to treasury
        expect(treasuryBalAfter - treasuryBalBefore).to.equal(TARGET_AMOUNT);
      });
    });

    describe("Three arbitrators (3-arb mode)", function () {
      beforeEach(async function () {
        // 3-arb mode: all three arbs set
        escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, arb2.address, arb3.address);
        await escrow.connect(seller).confirm();
        await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      });

      it("should have arbitratorCount = 3", async function () {
        expect(await escrow.arbitratorCount()).to.equal(3);
      });

      it("3-arb: arb1 + arb2 agree (Release) resolves immediately without arb3", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        await escrow.connect(arb1).arbitratorRelease();
        expect(await escrow.resolved()).to.be.false;
        expect(await escrow.deadlocked()).to.be.false;
        
        const sellerBalBefore = await usdc.balanceOf(seller.address);
        
        // Second arb votes same way - should resolve immediately
        await escrow.connect(arb2).arbitratorRelease();
        expect(await escrow.resolved()).to.be.true;
        expect(await escrow.deadlocked()).to.be.false;
        
        const sellerBalAfter = await usdc.balanceOf(seller.address);
        expect(sellerBalAfter - sellerBalBefore).to.equal(SELLER_PRINCIPAL);
      });

      it("3-arb: arb1 + arb2 agree (Refund) resolves immediately without arb3", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        await escrow.connect(arb1).arbitratorRefund();
        expect(await escrow.resolved()).to.be.false;
        
        const buyerBalBefore = await usdc.balanceOf(buyer.address);
        
        // Second arb votes same way - should resolve immediately
        await escrow.connect(arb2).arbitratorRefund();
        expect(await escrow.resolved()).to.be.true;
        
        const buyerBalAfter = await usdc.balanceOf(buyer.address);
        expect(buyerBalAfter - buyerBalBefore).to.equal(TARGET_AMOUNT);
      });

      it("3-arb: arb1/arb2 disagree enters deadlock, arb3 decides (Release)", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        await escrow.connect(arb1).arbitratorRelease();
        await escrow.connect(arb2).arbitratorRefund();
        
        expect(await escrow.resolved()).to.be.false;
        expect(await escrow.deadlocked()).to.be.true;
        
        const sellerBalBefore = await usdc.balanceOf(seller.address);
        
        // arb3 breaks tie with Release
        await escrow.connect(arb3).arbitratorRelease();
        expect(await escrow.resolved()).to.be.true;
        
        const sellerBalAfter = await usdc.balanceOf(seller.address);
        expect(sellerBalAfter - sellerBalBefore).to.equal(SELLER_PRINCIPAL);
      });

      it("3-arb: arb1/arb2 disagree enters deadlock, arb3 decides (Refund)", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        await escrow.connect(arb1).arbitratorRelease();
        await escrow.connect(arb2).arbitratorRefund();
        
        expect(await escrow.resolved()).to.be.false;
        expect(await escrow.deadlocked()).to.be.true;
        
        const buyerBalBefore = await usdc.balanceOf(buyer.address);
        
        // arb3 breaks tie with Refund
        await escrow.connect(arb3).arbitratorRefund();
        expect(await escrow.resolved()).to.be.true;
        
        const buyerBalAfter = await usdc.balanceOf(buyer.address);
        expect(buyerBalAfter - buyerBalBefore).to.equal(TARGET_AMOUNT);
      });

      it("3-arb: arb3 cannot vote before deadlock", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        // arb3 tries to vote before deadlock
        await expect(
          escrow.connect(arb3).arbitratorRelease()
        ).to.be.revertedWith("Escrow: arb3 can only vote in deadlock");
      });

      it("3-arb: only 1 vote → sweep to treasury after arb window", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        // Only arb1 votes
        await escrow.connect(arb1).arbitratorRelease();
        expect(await escrow.resolved()).to.be.false;
        
        // Arb window expires
        const arbWindowEnd = await escrow.arbWindowEnd();
        await time.increaseTo(arbWindowEnd + 1n);
        
        const treasuryBalBefore = await usdc.balanceOf(treasury.address);
        
        await escrow.connect(random).sweepToTreasuryAfterArbWindow();
        
        expect(await escrow.resolved()).to.be.true;
        
        const treasuryBalAfter = await usdc.balanceOf(treasury.address);
        // All funds swept to treasury
        expect(treasuryBalAfter - treasuryBalBefore).to.equal(TARGET_AMOUNT);
      });

      it("3-arb: 1-1 with no arb3 vote → sweep to treasury after arb window", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        // arb1 and arb2 disagree
        await escrow.connect(arb1).arbitratorRelease();
        await escrow.connect(arb2).arbitratorRefund();
        
        expect(await escrow.resolved()).to.be.false;
        expect(await escrow.deadlocked()).to.be.true;
        
        // Arb window expires without arb3 voting
        const arbWindowEnd = await escrow.arbWindowEnd();
        await time.increaseTo(arbWindowEnd + 1n);
        
        const treasuryBalBefore = await usdc.balanceOf(treasury.address);
        
        await escrow.connect(random).sweepToTreasuryAfterArbWindow();
        
        expect(await escrow.resolved()).to.be.true;
        
        const treasuryBalAfter = await usdc.balanceOf(treasury.address);
        // All funds swept to treasury
        expect(treasuryBalAfter - treasuryBalBefore).to.equal(TARGET_AMOUNT);
      });

      it("should reject double voting", async function () {
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        await escrow.connect(arb1).arbitratorRelease();
        
        await expect(
          escrow.connect(arb1).arbitratorRelease()
        ).to.be.revertedWith("Escrow: already voted");
      });
    });

    describe("0/1/3 arbitrator rule validation", function () {
      it("should reject 2 arbitrators (arb1 + arb2 without arb3)", async function () {
        const deadline = (await time.latest()) + ONE_WEEK;
        
        await expect(
          factory.createEscrowSimple(
            seller.address,
            buyer.address,
            await usdc.getAddress(),
            TARGET_AMOUNT,
            deadline,
            arb1.address,
            arb2.address,
            ethers.ZeroAddress  // Missing arb3
          )
        ).to.be.revertedWith("Factory: must have 0, 1, or 3 arbitrators");
      });

      it("should reject arb2 without arb1", async function () {
        const deadline = (await time.latest()) + ONE_WEEK;
        
        await expect(
          factory.createEscrowSimple(
            seller.address,
            buyer.address,
            await usdc.getAddress(),
            TARGET_AMOUNT,
            deadline,
            ethers.ZeroAddress,
            arb2.address,
            arb3.address
          )
        ).to.be.revertedWith("Factory: must have 0, 1, or 3 arbitrators");
      });

      it("should reject arb3 without arb1 and arb2", async function () {
        const deadline = (await time.latest()) + ONE_WEEK;
        
        await expect(
          factory.createEscrowSimple(
            seller.address,
            buyer.address,
            await usdc.getAddress(),
            TARGET_AMOUNT,
            deadline,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            arb3.address
          )
        ).to.be.revertedWith("Factory: must have 0, 1, or 3 arbitrators");
      });

      it("should allow 0 arbitrators", async function () {
        escrow = await createEscrow(ONE_WEEK, undefined, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
        expect(await escrow.arbitratorCount()).to.equal(0);
      });

      it("should allow 1 arbitrator", async function () {
        escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
        expect(await escrow.arbitratorCount()).to.equal(1);
      });

      it("should allow 3 arbitrators", async function () {
        escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, arb2.address, arb3.address);
        expect(await escrow.arbitratorCount()).to.equal(3);
      });
    });

    describe("Arb release with bond", function () {
      it("should return bond to seller on release", async function () {
        escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
        await usdc.connect(seller).transfer(await escrow.getAddress(), BOND_CAP);
        await escrow.connect(oracle).confirmByOracle(ethers.keccak256(ethers.toUtf8Bytes("tx1")));
        await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
        
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        const sellerBalBefore = await usdc.balanceOf(seller.address);
        
        await escrow.connect(arb1).arbitratorRelease();
        
        const sellerBalAfter = await usdc.balanceOf(seller.address);
        // Seller gets principal + bond
        expect(sellerBalAfter - sellerBalBefore).to.equal(SELLER_PRINCIPAL + BOND_CAP);
      });
    });

    describe("Arb refund with bond", function () {
      it("should return bond to seller and targetAmount to buyer on refund", async function () {
        escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
        await usdc.connect(seller).transfer(await escrow.getAddress(), BOND_CAP);
        await escrow.connect(oracle).confirmByOracle(ethers.keccak256(ethers.toUtf8Bytes("tx1")));
        await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
        
        const deadline = await escrow.deadline();
        await time.increaseTo(deadline);
        
        const sellerBalBefore = await usdc.balanceOf(seller.address);
        const buyerBalBefore = await usdc.balanceOf(buyer.address);
        
        await escrow.connect(arb1).arbitratorRefund();
        
        const sellerBalAfter = await usdc.balanceOf(seller.address);
        const buyerBalAfter = await usdc.balanceOf(buyer.address);
        
        // Seller gets bond back
        expect(sellerBalAfter - sellerBalBefore).to.equal(BOND_CAP);
        // Buyer gets targetAmount back
        expect(buyerBalAfter - buyerBalBefore).to.equal(TARGET_AMOUNT);
      });
    });
  });

  describe("Sweep After Arb Window", function () {
    it("should allow sweep to treasury after arb window ends (3 arb, no resolution)", async function () {
      escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, arb2.address, arb3.address);
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const arbWindowEnd = await escrow.arbWindowEnd();
      await time.increaseTo(arbWindowEnd + 1n);
      
      const treasuryBalBefore = await usdc.balanceOf(treasury.address);
      
      await escrow.connect(random).sweepToTreasuryAfterArbWindow();
      
      expect(await escrow.resolved()).to.be.true;
      
      const treasuryBalAfter = await usdc.balanceOf(treasury.address);
      // All funds swept to treasury
      expect(treasuryBalAfter - treasuryBalBefore).to.equal(TARGET_AMOUNT);
    });

    it("should emit SweptAfterArbWindow event", async function () {
      escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const arbWindowEnd = await escrow.arbWindowEnd();
      await time.increaseTo(arbWindowEnd + 1n);
      
      await expect(escrow.connect(random).sweepToTreasuryAfterArbWindow())
        .to.emit(escrow, "SweptAfterArbWindow")
        .withArgs(treasury.address, TARGET_AMOUNT);
    });

    it("should reject sweep if no arbitrators", async function () {
      escrow = await createEscrow();
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const arbWindowEnd = await escrow.arbWindowEnd();
      await time.increaseTo(arbWindowEnd + 1n);
      
      await expect(
        escrow.connect(random).sweepToTreasuryAfterArbWindow()
      ).to.be.revertedWith("Escrow: no arbitrators");
    });

    it("should reject sweep before arb window ends", async function () {
      escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      await expect(
        escrow.connect(random).sweepToTreasuryAfterArbWindow()
      ).to.be.revertedWith("Escrow: arb window not ended");
    });

    it("should reject sweep if already resolved by arb", async function () {
      escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      await escrow.connect(arb1).arbitratorRelease();
      
      const arbWindowEnd = await escrow.arbWindowEnd();
      await time.increaseTo(arbWindowEnd + 1n);
      
      await expect(
        escrow.connect(random).sweepToTreasuryAfterArbWindow()
      ).to.be.revertedWith("Escrow: already terminal");
    });
  });

  describe("Expiry - Not Confirmed", function () {
    beforeEach(async function () {
      escrow = await createEscrow();
    });

    it("should expire if not confirmed within 24h", async function () {
      await time.increase(ONE_DAY + 1);
      
      await escrow.connect(random).expireIfNotConfirmed();
      
      expect(await escrow.expired()).to.be.true;
      expect(await escrow.phase()).to.equal(4); // Expired
    });

    it("should emit ExpiredNotConfirmed event", async function () {
      await time.increase(ONE_DAY + 1);
      
      await expect(escrow.connect(random).expireIfNotConfirmed())
        .to.emit(escrow, "ExpiredNotConfirmed");
    });

    it("should reject expire while confirm window still open", async function () {
      await expect(
        escrow.connect(random).expireIfNotConfirmed()
      ).to.be.revertedWith("Escrow: confirm window still open");
    });

    it("should reject expire if already confirmed", async function () {
      await escrow.connect(seller).confirm();
      await time.increase(ONE_DAY + 1);
      
      await expect(
        escrow.connect(random).expireIfNotConfirmed()
      ).to.be.revertedWith("Escrow: already confirmed");
    });
  });

  describe("Expiry - Confirmed but Not Funded", function () {
    beforeEach(async function () {
      escrow = await createEscrow();
      await escrow.connect(seller).confirm();
    });

    it("should expire and emit event (self-confirm, no bond)", async function () {
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      await expect(escrow.connect(random).expireIfNotFunded())
        .to.emit(escrow, "ExpiredNotFunded")
        .withArgs(await time.latest() + 1, seller.address, 0n);
      
      expect(await escrow.expired()).to.be.true;
      expect(await escrow.phase()).to.equal(4);
    });

    it("should return bond to seller on expiry (oracle confirm)", async function () {
      const escrow2 = await createEscrow();
      await usdc.connect(seller).transfer(await escrow2.getAddress(), BOND_CAP);
      await escrow2.connect(oracle).confirmByOracle(ethers.keccak256(ethers.toUtf8Bytes("tx1")));
      
      const deadline = await escrow2.deadline();
      await time.increaseTo(deadline);
      
      const sellerBalBefore = await usdc.balanceOf(seller.address);
      
      await escrow2.connect(random).expireIfNotFunded();
      
      const sellerBalAfter = await usdc.balanceOf(seller.address);
      expect(sellerBalAfter - sellerBalBefore).to.equal(BOND_CAP);
    });

    it("should reject expire before deadline", async function () {
      await expect(
        escrow.connect(random).expireIfNotFunded()
      ).to.be.revertedWith("Escrow: deadline not reached");
    });

    it("should reject expire if already funded", async function () {
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      await expect(
        escrow.connect(random).expireIfNotFunded()
      ).to.be.revertedWith("Escrow: already funded");
    });
  });

  describe("Sweep (late/stray funds after terminal)", function () {
    it("should allow sweep after Resolved", async function () {
      escrow = await createEscrow();
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      await escrow.finalizeAfterDeadline();
      
      // Send late funds
      await usdc.mint(random.address, ONE_USDC * 10n);
      await usdc.connect(random).transfer(await escrow.getAddress(), ONE_USDC * 10n);
      
      const treasuryBalBefore = await usdc.balanceOf(treasury.address);
      
      await escrow.connect(random).sweepToTreasury();
      
      const treasuryBalAfter = await usdc.balanceOf(treasury.address);
      expect(treasuryBalAfter - treasuryBalBefore).to.equal(ONE_USDC * 10n);
    });

    it("should allow sweep after Expired", async function () {
      escrow = await createEscrow();
      await time.increase(ONE_DAY + 1);
      await escrow.expireIfNotConfirmed();
      
      // Send late funds
      await usdc.mint(random.address, ONE_USDC * 5n);
      await usdc.connect(random).transfer(await escrow.getAddress(), ONE_USDC * 5n);
      
      const treasuryBalBefore = await usdc.balanceOf(treasury.address);
      
      await escrow.sweepToTreasury();
      
      const treasuryBalAfter = await usdc.balanceOf(treasury.address);
      expect(treasuryBalAfter - treasuryBalBefore).to.equal(ONE_USDC * 5n);
    });

    it("should reject sweep during active phases", async function () {
      escrow = await createEscrow();
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      await expect(
        escrow.sweepToTreasury()
      ).to.be.revertedWith("Escrow: not in terminal state");
    });
  });

  describe("View functions", function () {
    beforeEach(async function () {
      escrow = await createEscrow();
    });

    it("isPayable returns true when no arbs, confirmed, funded, past deadline", async function () {
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      expect(await escrow.isPayable()).to.be.false;
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      expect(await escrow.isPayable()).to.be.true;
    });

    it("isPayable returns false when arbitrators exist", async function () {
      escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      expect(await escrow.isPayable()).to.be.false;
    });

    it("isExpirableNoConfirm returns true after confirm deadline", async function () {
      expect(await escrow.isExpirableNoConfirm()).to.be.false;
      
      await time.increase(ONE_DAY + 1);
      
      expect(await escrow.isExpirableNoConfirm()).to.be.true;
    });

    it("isExpirableNoFund returns true after deadline if confirmed but not funded", async function () {
      await escrow.connect(seller).confirm();
      
      expect(await escrow.isExpirableNoFund()).to.be.false;
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      expect(await escrow.isExpirableNoFund()).to.be.true;
    });

    it("isTerminal returns true for resolved and expired", async function () {
      expect(await escrow.isTerminal()).to.be.false;
      
      await time.increase(ONE_DAY + 1);
      await escrow.expireIfNotConfirmed();
      
      expect(await escrow.isTerminal()).to.be.true;
    });

    it("isInArbWindow returns true during arb window", async function () {
      escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      expect(await escrow.isInArbWindow()).to.be.false;
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      expect(await escrow.isInArbWindow()).to.be.true;
      
      const arbWindowEnd = await escrow.arbWindowEnd();
      await time.increaseTo(arbWindowEnd + 1n);
      
      expect(await escrow.isInArbWindow()).to.be.false;
    });

    it("isSweepableAfterArbWindow returns true after arb window", async function () {
      escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
      
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      expect(await escrow.isSweepableAfterArbWindow()).to.be.false;
      
      const arbWindowEnd = await escrow.arbWindowEnd();
      await time.increaseTo(arbWindowEnd + 1n);
      
      expect(await escrow.isSweepableAfterArbWindow()).to.be.true;
    });
  });

  describe("Mutual Release (buyer + seller, no arbitrators)", function () {
    const EXPECTED_FEE = ethers.parseUnits("1", TOKEN_DECIMALS);
    const SELLER_PRINCIPAL = TARGET_AMOUNT - EXPECTED_FEE;

    beforeEach(async function () {
      escrow = await createEscrow();
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
    });

    it("should allow buyer to approve mutual release", async function () {
      await escrow.connect(buyer).approveMutualRelease();
      expect(await escrow.mutualReleaseApprovedByFunder()).to.be.true;
      expect(await escrow.mutualReleaseApprovedByPayout()).to.be.false;
      expect(await escrow.resolved()).to.be.false;
    });

    it("should allow seller to approve mutual release", async function () {
      await escrow.connect(seller).approveMutualRelease();
      expect(await escrow.mutualReleaseApprovedByFunder()).to.be.false;
      expect(await escrow.mutualReleaseApprovedByPayout()).to.be.true;
      expect(await escrow.resolved()).to.be.false;
    });

    it("should emit MutualReleaseApproved event", async function () {
      await expect(escrow.connect(buyer).approveMutualRelease())
        .to.emit(escrow, "MutualReleaseApproved")
        .withArgs(buyer.address);
    });

    it("should execute release when both approve", async function () {
      await escrow.connect(buyer).approveMutualRelease();
      
      const sellerBalBefore = await usdc.balanceOf(seller.address);
      const treasuryBalBefore = await usdc.balanceOf(treasury.address);
      
      await escrow.connect(seller).approveMutualRelease();
      
      expect(await escrow.resolved()).to.be.true;
      
      const sellerBalAfter = await usdc.balanceOf(seller.address);
      const treasuryBalAfter = await usdc.balanceOf(treasury.address);
      
      expect(sellerBalAfter - sellerBalBefore).to.equal(SELLER_PRINCIPAL);
      expect(treasuryBalAfter - treasuryBalBefore).to.equal(EXPECTED_FEE);
    });

    it("should emit MutualReleaseExecuted event", async function () {
      await escrow.connect(buyer).approveMutualRelease();
      
      await expect(escrow.connect(seller).approveMutualRelease())
        .to.emit(escrow, "MutualReleaseExecuted")
        .withArgs(seller.address, SELLER_PRINCIPAL, EXPECTED_FEE, 0);
    });

    it("should reject mutual release when arbitrators exist", async function () {
      const escrowWithArb = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrowWithArb.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrowWithArb.getAddress(), TARGET_AMOUNT);
      
      await expect(
        escrowWithArb.connect(buyer).approveMutualRelease()
      ).to.be.revertedWith("Escrow: has arbitrators");
    });

    it("should reject mutual release after deadline", async function () {
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      await expect(
        escrow.connect(buyer).approveMutualRelease()
      ).to.be.revertedWith("Escrow: deadline passed");
    });

    it("should reject mutual release from non-party", async function () {
      await expect(
        escrow.connect(random).approveMutualRelease()
      ).to.be.revertedWith("Escrow: not a party");
    });

    it("should reject double approval from same party", async function () {
      await escrow.connect(buyer).approveMutualRelease();
      
      await expect(
        escrow.connect(buyer).approveMutualRelease()
      ).to.be.revertedWith("Escrow: already approved");
    });

    it("should reject mutual release if not confirmed", async function () {
      const freshEscrow = await createEscrow();
      await usdc.connect(buyer).transfer(await freshEscrow.getAddress(), TARGET_AMOUNT);
      
      await expect(
        freshEscrow.connect(buyer).approveMutualRelease()
      ).to.be.revertedWith("Escrow: not confirmed");
    });

    it("should reject mutual release if not funded", async function () {
      const freshEscrow = await createEscrow();
      await freshEscrow.connect(seller).confirm();
      
      await expect(
        freshEscrow.connect(buyer).approveMutualRelease()
      ).to.be.revertedWith("Escrow: not funded");
    });
  });

  describe("Mutual Refund (buyer + seller, no arbitrators)", function () {
    beforeEach(async function () {
      escrow = await createEscrow();
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
    });

    it("should allow buyer to approve mutual refund", async function () {
      await escrow.connect(buyer).approveMutualRefund();
      expect(await escrow.mutualRefundApprovedByFunder()).to.be.true;
      expect(await escrow.mutualRefundApprovedByPayout()).to.be.false;
      expect(await escrow.resolved()).to.be.false;
    });

    it("should allow seller to approve mutual refund", async function () {
      await escrow.connect(seller).approveMutualRefund();
      expect(await escrow.mutualRefundApprovedByFunder()).to.be.false;
      expect(await escrow.mutualRefundApprovedByPayout()).to.be.true;
      expect(await escrow.resolved()).to.be.false;
    });

    it("should emit MutualRefundApproved event", async function () {
      await expect(escrow.connect(seller).approveMutualRefund())
        .to.emit(escrow, "MutualRefundApproved")
        .withArgs(seller.address);
    });

    it("should execute refund when both approve", async function () {
      await escrow.connect(seller).approveMutualRefund();
      
      const buyerBalBefore = await usdc.balanceOf(buyer.address);
      
      await escrow.connect(buyer).approveMutualRefund();
      
      expect(await escrow.resolved()).to.be.true;
      
      const buyerBalAfter = await usdc.balanceOf(buyer.address);
      expect(buyerBalAfter - buyerBalBefore).to.equal(TARGET_AMOUNT);
    });

    it("should emit MutualRefundExecuted event", async function () {
      await escrow.connect(seller).approveMutualRefund();
      
      await expect(escrow.connect(buyer).approveMutualRefund())
        .to.emit(escrow, "MutualRefundExecuted")
        .withArgs(buyer.address, TARGET_AMOUNT, seller.address, 0);
    });

    it("should return bond to seller on mutual refund (oracle confirm)", async function () {
      const escrow2 = await createEscrow();
      await usdc.connect(seller).transfer(await escrow2.getAddress(), BOND_CAP);
      await escrow2.connect(oracle).confirmByOracle(ethers.keccak256(ethers.toUtf8Bytes("tx1")));
      await usdc.connect(buyer).transfer(await escrow2.getAddress(), TARGET_AMOUNT);
      
      await escrow2.connect(seller).approveMutualRefund();
      
      const sellerBalBefore = await usdc.balanceOf(seller.address);
      const buyerBalBefore = await usdc.balanceOf(buyer.address);
      
      await escrow2.connect(buyer).approveMutualRefund();
      
      const sellerBalAfter = await usdc.balanceOf(seller.address);
      const buyerBalAfter = await usdc.balanceOf(buyer.address);
      
      expect(sellerBalAfter - sellerBalBefore).to.equal(BOND_CAP);
      expect(buyerBalAfter - buyerBalBefore).to.equal(TARGET_AMOUNT);
    });

    it("should reject mutual refund when arbitrators exist", async function () {
      const escrowWithArb = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrowWithArb.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrowWithArb.getAddress(), TARGET_AMOUNT);
      
      await expect(
        escrowWithArb.connect(buyer).approveMutualRefund()
      ).to.be.revertedWith("Escrow: has arbitrators");
    });

    it("should reject mutual refund after deadline", async function () {
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      await expect(
        escrow.connect(buyer).approveMutualRefund()
      ).to.be.revertedWith("Escrow: deadline passed");
    });
  });

  describe("Mutual Deadline Extension", function () {
    const TWO_WEEKS = 14 * ONE_DAY;

    beforeEach(async function () {
      escrow = await createEscrow();
    });

    it("should allow buyer to approve deadline extension", async function () {
      const currentDeadline = await escrow.deadline();
      const newDeadline = currentDeadline + BigInt(ONE_DAY);
      
      await escrow.connect(buyer).approveDeadlineExtension(newDeadline);
      
      expect(await escrow.pendingExtensionDeadline()).to.equal(newDeadline);
      expect(await escrow.extensionApprovedByFunder()).to.be.true;
      expect(await escrow.extensionApprovedByPayout()).to.be.false;
    });

    it("should allow seller to approve deadline extension", async function () {
      const currentDeadline = await escrow.deadline();
      const newDeadline = currentDeadline + BigInt(ONE_DAY);
      
      await escrow.connect(seller).approveDeadlineExtension(newDeadline);
      
      expect(await escrow.pendingExtensionDeadline()).to.equal(newDeadline);
      expect(await escrow.extensionApprovedByFunder()).to.be.false;
      expect(await escrow.extensionApprovedByPayout()).to.be.true;
    });

    it("should emit DeadlineExtensionApproved event", async function () {
      const currentDeadline = await escrow.deadline();
      const newDeadline = currentDeadline + BigInt(ONE_DAY);
      
      await expect(escrow.connect(buyer).approveDeadlineExtension(newDeadline))
        .to.emit(escrow, "DeadlineExtensionApproved")
        .withArgs(buyer.address, newDeadline);
    });

    it("should execute extension when both approve same deadline", async function () {
      const currentDeadline = await escrow.deadline();
      const newDeadline = currentDeadline + BigInt(ONE_DAY);
      
      await escrow.connect(buyer).approveDeadlineExtension(newDeadline);
      await escrow.connect(seller).approveDeadlineExtension(newDeadline);
      
      expect(await escrow.deadline()).to.equal(newDeadline);
      expect(await escrow.arbWindowEnd()).to.equal(newDeadline + BigInt(ONE_WEEK));
      
      // Pending state should be cleared
      expect(await escrow.pendingExtensionDeadline()).to.equal(0);
      expect(await escrow.extensionApprovedByFunder()).to.be.false;
      expect(await escrow.extensionApprovedByPayout()).to.be.false;
    });

    it("should emit DeadlineExtended event", async function () {
      const currentDeadline = await escrow.deadline();
      const newDeadline = currentDeadline + BigInt(ONE_DAY);
      
      await escrow.connect(buyer).approveDeadlineExtension(newDeadline);
      
      await expect(escrow.connect(seller).approveDeadlineExtension(newDeadline))
        .to.emit(escrow, "DeadlineExtended")
        .withArgs(currentDeadline, newDeadline, newDeadline + BigInt(ONE_WEEK));
    });

    it("should reset approvals when different deadline proposed", async function () {
      const currentDeadline = await escrow.deadline();
      const newDeadline1 = currentDeadline + BigInt(ONE_DAY);
      const newDeadline2 = currentDeadline + BigInt(2 * ONE_DAY);
      
      await escrow.connect(buyer).approveDeadlineExtension(newDeadline1);
      expect(await escrow.extensionApprovedByFunder()).to.be.true;
      
      // Seller proposes different deadline - should reset
      await escrow.connect(seller).approveDeadlineExtension(newDeadline2);
      
      expect(await escrow.pendingExtensionDeadline()).to.equal(newDeadline2);
      expect(await escrow.extensionApprovedByFunder()).to.be.false;
      expect(await escrow.extensionApprovedByPayout()).to.be.true;
    });

    it("should reject extension beyond max (14 days from original)", async function () {
      const originalDeadline = await escrow.originalDeadline();
      const tooFarDeadline = originalDeadline + BigInt(TWO_WEEKS) + 1n;
      
      await expect(
        escrow.connect(buyer).approveDeadlineExtension(tooFarDeadline)
      ).to.be.revertedWith("Escrow: exceeds max extension");
    });

    it("should allow up to max extension (14 days from original)", async function () {
      const originalDeadline = await escrow.originalDeadline();
      const maxDeadline = originalDeadline + BigInt(TWO_WEEKS);
      
      await escrow.connect(buyer).approveDeadlineExtension(maxDeadline);
      await escrow.connect(seller).approveDeadlineExtension(maxDeadline);
      
      expect(await escrow.deadline()).to.equal(maxDeadline);
    });

    it("should reject extension after current deadline", async function () {
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      
      const newDeadline = deadline + BigInt(ONE_DAY);
      
      await expect(
        escrow.connect(buyer).approveDeadlineExtension(newDeadline)
      ).to.be.revertedWith("Escrow: deadline passed");
    });

    it("should reject extension to earlier than current deadline", async function () {
      const currentDeadline = await escrow.deadline();
      const earlierDeadline = currentDeadline - 1n;
      
      await expect(
        escrow.connect(buyer).approveDeadlineExtension(earlierDeadline)
      ).to.be.revertedWith("Escrow: new deadline must be later");
    });

    it("should reject extension from non-party", async function () {
      const currentDeadline = await escrow.deadline();
      const newDeadline = currentDeadline + BigInt(ONE_DAY);
      
      await expect(
        escrow.connect(random).approveDeadlineExtension(newDeadline)
      ).to.be.revertedWith("Escrow: not a party");
    });

    it("should track extension used correctly", async function () {
      const originalDeadline = await escrow.originalDeadline();
      const extension = BigInt(3 * ONE_DAY);
      const newDeadline = originalDeadline + extension;
      
      expect(await escrow.totalExtensionUsed()).to.equal(0);
      expect(await escrow.extensionRemaining()).to.equal(BigInt(TWO_WEEKS));
      
      await escrow.connect(buyer).approveDeadlineExtension(newDeadline);
      await escrow.connect(seller).approveDeadlineExtension(newDeadline);
      
      expect(await escrow.totalExtensionUsed()).to.equal(extension);
      expect(await escrow.extensionRemaining()).to.equal(BigInt(TWO_WEEKS) - extension);
    });
  });

  describe("Mutual Arbitrator Swap", function () {
    beforeEach(async function () {
      escrow = await createEscrow(ONE_WEEK, undefined, arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow.getAddress(), TARGET_AMOUNT);
    });

    it("should allow buyer to approve arbitrator swap", async function () {
      await escrow.connect(buyer).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      
      expect(await escrow.pendingSwapArb1()).to.equal(arb2.address);
      expect(await escrow.swapApprovedByFunder()).to.be.true;
      expect(await escrow.swapApprovedByPayout()).to.be.false;
    });

    it("should allow seller to approve arbitrator swap", async function () {
      await escrow.connect(seller).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      
      expect(await escrow.pendingSwapArb1()).to.equal(arb2.address);
      expect(await escrow.swapApprovedByFunder()).to.be.false;
      expect(await escrow.swapApprovedByPayout()).to.be.true;
    });

    it("should emit ArbitratorSwapApproved event", async function () {
      await expect(escrow.connect(buyer).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress))
        .to.emit(escrow, "ArbitratorSwapApproved")
        .withArgs(buyer.address, arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
    });

    it("should execute swap when both approve same set (1 arb)", async function () {
      await escrow.connect(buyer).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      
      expect(await escrow.arbitrator1()).to.equal(arb2.address);
      expect(await escrow.arbitrator2()).to.equal(ethers.ZeroAddress);
      expect(await escrow.arbitrator3()).to.equal(ethers.ZeroAddress);
      expect(await escrow.arbitratorCount()).to.equal(1);
    });

    it("should execute swap to 3 arbitrators", async function () {
      await escrow.connect(buyer).approveArbitratorSwap(arb1.address, arb2.address, arb3.address);
      await escrow.connect(seller).approveArbitratorSwap(arb1.address, arb2.address, arb3.address);
      
      expect(await escrow.arbitrator1()).to.equal(arb1.address);
      expect(await escrow.arbitrator2()).to.equal(arb2.address);
      expect(await escrow.arbitrator3()).to.equal(arb3.address);
      expect(await escrow.arbitratorCount()).to.equal(3);
    });

    it("should execute swap to 0 arbitrators", async function () {
      await escrow.connect(buyer).approveArbitratorSwap(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).approveArbitratorSwap(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
      
      expect(await escrow.arbitrator1()).to.equal(ethers.ZeroAddress);
      expect(await escrow.arbitratorCount()).to.equal(0);
    });

    it("should emit ArbitratorSwapExecuted event", async function () {
      const oldArb1 = await escrow.arbitrator1();
      const oldArb2 = await escrow.arbitrator2();
      const oldArb3 = await escrow.arbitrator3();
      
      await escrow.connect(buyer).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      
      const tx = escrow.connect(seller).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      
      await expect(tx).to.emit(escrow, "ArbitratorSwapExecuted");
    });

    it("should push deadline +7 days on swap", async function () {
      const beforeSwapTime = await time.latest();
      
      await escrow.connect(buyer).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      
      const newDeadline = await escrow.deadline();
      const afterSwapTime = await time.latest();
      
      // New deadline should be approximately block.timestamp + 7 days
      expect(newDeadline).to.be.closeTo(BigInt(afterSwapTime) + BigInt(ONE_WEEK), 5n);
      
      // arbWindowEnd should be newDeadline + 7 days
      expect(await escrow.arbWindowEnd()).to.equal(newDeadline + BigInt(ONE_WEEK));
    });

    it("should reset votes on swap", async function () {
      // Arb1 votes
      const deadline = await escrow.deadline();
      await time.increaseTo(deadline);
      await escrow.connect(arb1).arbitratorRelease();
      
      expect(await escrow.arbitratorVote(arb1.address)).to.equal(1); // Release
      
      // Now swap arbitrators (time will still be before new arb window end)
      await escrow.connect(buyer).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow.connect(seller).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      
      // Old arb1's vote should be reset
      expect(await escrow.arbitratorVote(arb1.address)).to.equal(0); // None
    });

    it("should reset deadlocked state on swap", async function () {
      // Create 3-arb escrow
      const escrow3 = await createEscrow(ONE_WEEK, undefined, arb1.address, arb2.address, arb3.address);
      await escrow3.connect(seller).confirm();
      await usdc.connect(buyer).transfer(await escrow3.getAddress(), TARGET_AMOUNT);
      
      const deadline = await escrow3.deadline();
      await time.increaseTo(deadline);
      
      // Create deadlock
      await escrow3.connect(arb1).arbitratorRelease();
      await escrow3.connect(arb2).arbitratorRefund();
      expect(await escrow3.deadlocked()).to.be.true;
      
      // Swap arbitrators
      await escrow3.connect(buyer).approveArbitratorSwap(arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      await escrow3.connect(seller).approveArbitratorSwap(arb1.address, ethers.ZeroAddress, ethers.ZeroAddress);
      
      expect(await escrow3.deadlocked()).to.be.false;
    });

    it("should reject swap with 2 arbitrators", async function () {
      await expect(
        escrow.connect(buyer).approveArbitratorSwap(arb1.address, arb2.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Escrow: must have 0, 1, or 3 arbitrators");
    });

    it("should reject swap with arbitrator == payout", async function () {
      await expect(
        escrow.connect(buyer).approveArbitratorSwap(seller.address, ethers.ZeroAddress, ethers.ZeroAddress)
      ).to.be.revertedWith("Escrow: arbitrator1 == payout");
    });

    it("should reject swap with arbitrator == funder", async function () {
      await expect(
        escrow.connect(buyer).approveArbitratorSwap(buyer.address, ethers.ZeroAddress, ethers.ZeroAddress)
      ).to.be.revertedWith("Escrow: arbitrator1 == funder");
    });

    it("should reject swap with duplicate arbitrators", async function () {
      await expect(
        escrow.connect(buyer).approveArbitratorSwap(arb1.address, arb1.address, arb2.address)
      ).to.be.revertedWith("Escrow: duplicate arbitrator");
    });

    it("should reject swap after arb window ends", async function () {
      const arbWindowEnd = await escrow.arbWindowEnd();
      await time.increaseTo(arbWindowEnd + 1n);
      
      await expect(
        escrow.connect(buyer).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress)
      ).to.be.revertedWith("Escrow: arb window ended");
    });

    it("should reject swap from non-party", async function () {
      await expect(
        escrow.connect(random).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress)
      ).to.be.revertedWith("Escrow: not a party");
    });

    it("should reset approvals when different set proposed", async function () {
      await escrow.connect(buyer).approveArbitratorSwap(arb2.address, ethers.ZeroAddress, ethers.ZeroAddress);
      expect(await escrow.swapApprovedByFunder()).to.be.true;
      
      // Seller proposes different set - should reset
      await escrow.connect(seller).approveArbitratorSwap(arb3.address, ethers.ZeroAddress, ethers.ZeroAddress);
      
      expect(await escrow.pendingSwapArb1()).to.equal(arb3.address);
      expect(await escrow.swapApprovedByFunder()).to.be.false;
      expect(await escrow.swapApprovedByPayout()).to.be.true;
    });
  });
});

describe("EscrowFactory", function () {
  let usdc: MockUSDC;
  let usdt: MockUSDC;
  let factory: EscrowFactory;
  
  let owner: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let newOracle: SignerWithAddress;
  let newTreasury: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  
  const TOKEN_DECIMALS = 6;
  const ONE_TOKEN = ethers.parseUnits("1", TOKEN_DECIMALS);
  const ONE_WEEK = 7 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, oracle, treasury, newOracle, newTreasury, seller, buyer] = await ethers.getSigners();
    
    const MockToken = await ethers.getContractFactory("MockUSDC");
    usdc = await MockToken.deploy("Mock USDC", "USDC", 6);
    usdt = await MockToken.deploy("Mock USDT", "USDT", 6);
    
    const Factory = await ethers.getContractFactory("EscrowFactory");
    factory = await Factory.deploy(
      oracle.address,
      treasury.address,
      await usdc.getAddress(),
      await usdt.getAddress(),
      ONE_TOKEN
    );
  });

  it("should allow owner to update oracle", async function () {
    await factory.connect(owner).setOracle(newOracle.address);
    expect(await factory.oracle()).to.equal(newOracle.address);
  });

  it("should allow owner to update treasury", async function () {
    await factory.connect(owner).setTreasury(newTreasury.address);
    expect(await factory.treasury()).to.equal(newTreasury.address);
  });

  it("should reject non-owner admin functions", async function () {
    await expect(
      factory.connect(oracle).setOracle(newOracle.address)
    ).to.be.revertedWith("Ownable: not owner");
  });

  it("should allow owner to set default bond cap", async function () {
    const newBondCap = ONE_TOKEN * 2n;
    await factory.connect(owner).setDefaultBondCap(newBondCap);
    expect(await factory.defaultBondCap()).to.equal(newBondCap);
  });

  it("legacy: defaultConfirmationAmount() returns defaultBondCap", async function () {
    expect(await factory.defaultConfirmationAmount()).to.equal(ONE_TOKEN);
  });

  it("legacy: setDefaultConfirmationAmount() sets defaultBondCap", async function () {
    const newBondCap = ONE_TOKEN * 3n;
    await factory.connect(owner).setDefaultConfirmationAmount(newBondCap);
    expect(await factory.defaultBondCap()).to.equal(newBondCap);
  });

  it("should emit EscrowCreated event with arbWindowEnd", async function () {
    const deadline = (await time.latest()) + ONE_WEEK;
    
    const tx = await factory.createEscrowSimple(
      seller.address,
      buyer.address,
      await usdc.getAddress(),
      ONE_TOKEN * 100n,
      deadline,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );
    
    const receipt = await tx.wait();
    const event = receipt?.logs.find(
      (log: any) => log.fragment?.name === "EscrowCreated"
    );
    const args = (event as any).args;
    
    // Check arbWindowEnd is deadline + 7 days
    expect(args.arbWindowEnd).to.equal(deadline + ONE_WEEK);
  });

  it("should allow USDC for escrow creation", async function () {
    const deadline = (await time.latest()) + ONE_WEEK;
    
    expect(await factory.isAllowedToken(await usdc.getAddress())).to.be.true;
    
    await expect(
      factory.createEscrowSimple(
        seller.address,
        buyer.address,
        await usdc.getAddress(),
        ONE_TOKEN * 100n,
        deadline,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.not.be.reverted;
  });

  it("should allow USDT for escrow creation", async function () {
    const deadline = (await time.latest()) + ONE_WEEK;
    
    expect(await factory.isAllowedToken(await usdt.getAddress())).to.be.true;
    
    await expect(
      factory.createEscrowSimple(
        seller.address,
        buyer.address,
        await usdt.getAddress(),
        ONE_TOKEN * 100n,
        deadline,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.not.be.reverted;
  });

  it("should reject non-allowlisted tokens", async function () {
    const deadline = (await time.latest()) + ONE_WEEK;
    
    const MockToken = await ethers.getContractFactory("MockUSDC");
    const randomToken = await MockToken.deploy("Random Token", "RND", 6);
    
    await expect(
      factory.createEscrowSimple(
        seller.address,
        buyer.address,
        await randomToken.getAddress(),
        ONE_TOKEN * 100n,
        deadline,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.be.revertedWith("Factory: token not allowed");
  });

  it("should allow owner to update token allowlist", async function () {
    const MockToken = await ethers.getContractFactory("MockUSDC");
    const newToken = await MockToken.deploy("New Token", "NEW", 6);
    
    expect(await factory.isAllowedToken(await newToken.getAddress())).to.be.false;
    
    await factory.connect(owner).setTokenAllowed(await newToken.getAddress(), true);
    expect(await factory.isAllowedToken(await newToken.getAddress())).to.be.true;
    
    await factory.connect(owner).setTokenAllowed(await newToken.getAddress(), false);
    expect(await factory.isAllowedToken(await newToken.getAddress())).to.be.false;
  });
});
