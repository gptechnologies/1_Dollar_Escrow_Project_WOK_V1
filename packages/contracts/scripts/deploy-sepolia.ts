import { ethers } from "hardhat";

/**
 * Deploy EscrowFactory to Arbitrum Sepolia (testnet)
 * 
 * Deterministic V2 - Multi-token (USDC/USDT):
 * - Buyer/seller bound immutably at creation
 * - 24h confirmation window, deadline-based funding
 * - Deterministic payout after deadline (no refunds once funded)
 * - Supports USDC or USDT escrows (allowlisted)
 * - New fee structure: 1% up to $100, $1 cap above $100
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying contracts to Arbitrum Sepolia with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy MockUSDC (6 decimals like real USDC)
  console.log("\n1. Deploying MockUSDC...");
  const MockToken = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockToken.deploy("Mock USDC", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("MockUSDC deployed to:", usdcAddress);

  // Deploy MockUSDT (6 decimals like real USDT)
  console.log("\n2. Deploying MockUSDT...");
  const usdt = await MockToken.deploy("Mock USDT", "USDT", 6);
  await usdt.waitForDeployment();
  const usdtAddress = await usdt.getAddress();
  console.log("MockUSDT deployed to:", usdtAddress);

  // Mint test tokens to deployer (100,000 each)
  console.log("\n3. Minting test tokens...");
  const mintAmount = ethers.parseUnits("100000", 6);
  await (await usdc.mint(deployer.address, mintAmount)).wait();
  await (await usdt.mint(deployer.address, mintAmount)).wait();
  console.log("Minted 100,000 USDC and 100,000 USDT to:", deployer.address);

  // Oracle and Treasury addresses
  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  
  if (treasuryAddress === deployer.address) {
    console.warn("\n⚠️  WARNING: Treasury is set to deployer address.");
    console.warn("   For production, use a multi-sig Safe wallet.\n");
  }

  // Default confirmation amount ($1)
  const defaultConfirmationAmount = ethers.parseUnits("1", 6);

  // Deploy EscrowFactory with USDC and USDT allowlisted
  console.log("\n4. Deploying EscrowFactory...");
  console.log("   Oracle:", oracleAddress);
  console.log("   Treasury:", treasuryAddress);
  console.log("   USDC:", usdcAddress);
  console.log("   USDT:", usdtAddress);
  console.log("   Default Confirmation Amount: $1");

  const EscrowFactory = await ethers.getContractFactory("EscrowFactory");
  const factory = await EscrowFactory.deploy(
    oracleAddress,
    treasuryAddress,
    usdcAddress,
    usdtAddress,
    defaultConfirmationAmount
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("EscrowFactory deployed to:", factoryAddress);

  // Summary
  console.log("\n=== Deployment Summary ===");
  console.log("Network: Arbitrum Sepolia (421614)");
  console.log("MockUSDC:", usdcAddress);
  console.log("MockUSDT:", usdtAddress);
  console.log("EscrowFactory:", factoryAddress);
  console.log("Oracle:", oracleAddress);
  console.log("Treasury:", treasuryAddress);
  console.log("\n=== Key Features ===");
  console.log("- Multi-token: USDC and USDT supported");
  console.log("- Immutable parties: buyer/seller set at creation");
  console.log("- 24h confirmation window for seller $1");
  console.log("- Fee: 1% up to $100, $1 cap above $100, $0.01 minimum");
  console.log("- Deterministic payout after deadline if funded");
  console.log("- No refunds once funded");
  console.log("\n=== Next Steps ===");
  console.log("1. Verify contracts:");
  console.log(`   npx hardhat verify --network arbitrumSepolia ${usdcAddress} "Mock USDC" "USDC" 6`);
  console.log(`   npx hardhat verify --network arbitrumSepolia ${usdtAddress} "Mock USDT" "USDT" 6`);
  console.log(`   npx hardhat verify --network arbitrumSepolia ${factoryAddress} ${oracleAddress} ${treasuryAddress} ${usdcAddress} ${usdtAddress} ${defaultConfirmationAmount}`);
  console.log("\n2. Update .env.test with:");
  console.log(`   FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`   USDC_ADDRESS=${usdcAddress}`);
  console.log(`   USDT_ADDRESS=${usdtAddress}`);
  console.log(`   TREASURY_ADDRESS=${treasuryAddress}`);
  console.log("\n3. Run database migration:");
  console.log("   cd packages/oracle && NODE_ENV=test npm run migrate");
  console.log("\n4. Start oracle service:");
  console.log("   cd packages/oracle && NODE_ENV=test npm run dev");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
