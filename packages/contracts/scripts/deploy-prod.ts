import { ethers } from "hardhat";

/**
 * Deploy EscrowFactory to Arbitrum One (production)
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
  
  console.log("Deploying contracts to Arbitrum One with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Real USDC and USDT on Arbitrum One
  const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const USDT_ADDRESS = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";

  // Oracle and Treasury addresses (MUST be set for production)
  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  const treasuryAddress = process.env.TREASURY_ADDRESS;
  
  if (!treasuryAddress) {
    console.error("\n❌ ERROR: TREASURY_ADDRESS must be set for production!");
    console.error("   Use a Safe multi-sig wallet: https://app.safe.global/");
    process.exit(1);
  }

  if (oracleAddress === deployer.address) {
    console.warn("\n⚠️  WARNING: Oracle is set to deployer address.");
    console.warn("   Consider using a dedicated oracle wallet.\n");
  }

  // Default confirmation amount ($1)
  const defaultConfirmationAmount = ethers.parseUnits("1", 6);

  console.log("\n=== Production Deployment Configuration ===");
  console.log("Network: Arbitrum One (42161)");
  console.log("USDC Address:", USDC_ADDRESS);
  console.log("USDT Address:", USDT_ADDRESS);
  console.log("Oracle Address:", oracleAddress);
  console.log("Treasury Address:", treasuryAddress);
  console.log("Default Confirmation Amount: $1");
  console.log("Fee Structure: 1% up to $100, $1 cap above $100, $0.01 min");
  console.log("\n⚠️  This is a PRODUCTION deployment!");
  console.log("Proceed? (ctrl+c to cancel, or continue in 10 seconds...)");
  
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Deploy EscrowFactory with USDC and USDT allowlisted
  console.log("\nDeploying EscrowFactory...");
  const EscrowFactory = await ethers.getContractFactory("EscrowFactory");
  const factory = await EscrowFactory.deploy(
    oracleAddress,
    treasuryAddress,
    USDC_ADDRESS,
    USDT_ADDRESS,
    defaultConfirmationAmount
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("EscrowFactory deployed to:", factoryAddress);

  // Summary
  console.log("\n=== Production Deployment Summary ===");
  console.log("Network: Arbitrum One (42161)");
  console.log("USDC:", USDC_ADDRESS);
  console.log("USDT:", USDT_ADDRESS);
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
  console.log("1. Verify contract:");
  console.log(`   npx hardhat verify --network arbitrumOne ${factoryAddress} ${oracleAddress} ${treasuryAddress} ${USDC_ADDRESS} ${USDT_ADDRESS} ${defaultConfirmationAmount}`);
  console.log("\n2. Update .env.prod with:");
  console.log(`   FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`   USDC_ADDRESS=${USDC_ADDRESS}`);
  console.log(`   USDT_ADDRESS=${USDT_ADDRESS}`);
  console.log(`   TREASURY_ADDRESS=${treasuryAddress}`);
  console.log("\n3. Transfer factory ownership to multi-sig (recommended):");
  console.log(`   factory.transferOwnership("0xYourSafeAddress")`);
  console.log("\n4. Run database migration:");
  console.log("   cd packages/oracle && NODE_ENV=production npm run migrate");
  console.log("\n5. Deploy oracle service to hosting provider");
  console.log("\n6. Deploy UI to Vercel with env vars:");
  console.log("   NEXT_PUBLIC_ORACLE_API_URL=https://your-oracle.com");
  console.log("   NEXT_PUBLIC_USDC_ADDRESS=" + USDC_ADDRESS);
  console.log("   NEXT_PUBLIC_USDT_ADDRESS=" + USDT_ADDRESS);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
