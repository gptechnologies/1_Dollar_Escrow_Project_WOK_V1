import { ethers } from "hardhat";

/**
 * Deploy EscrowFactoryV2 to Arbitrum Sepolia (testnet).
 *
 * P2P escrow design:
 * - Immutable parties (seller / buyer-refund), one settlement date, terms hash
 * - Push funding; sellerConfirm is optional and requires full funding
 * - 0/1/3 arbitration with 2-of-3 voting + 30-day mutual-resolution override
 * - No oracle, no bond. Platform fee: 1% up to $100, $1 cap above, $0.01 min
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying EscrowFactoryV2 to Arbitrum Sepolia with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy mock tokens (6 decimals like USDC/USDT)
  const MockToken = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockToken.deploy("Mock USDC", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("MockUSDC deployed to:", usdcAddress);

  const usdt = await MockToken.deploy("Mock USDT", "USDT", 6);
  await usdt.waitForDeployment();
  const usdtAddress = await usdt.getAddress();
  console.log("MockUSDT deployed to:", usdtAddress);

  // Mint test tokens to deployer
  const mintAmount = ethers.parseUnits("100000", 6);
  await (await usdc.mint(deployer.address, mintAmount)).wait();
  await (await usdt.mint(deployer.address, mintAmount)).wait();
  console.log("Minted 100,000 USDC and 100,000 USDT to:", deployer.address);

  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  if (treasuryAddress === deployer.address) {
    console.warn("\n⚠️  Treasury is the deployer address. Use a multi-sig Safe for production.\n");
  }

  const Factory = await ethers.getContractFactory("EscrowFactoryV2");
  const factory = await Factory.deploy(treasuryAddress, usdcAddress, usdtAddress);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("EscrowFactoryV2 deployed to:", factoryAddress);

  console.log("\n=== Deployment Summary (Arbitrum Sepolia 421614) ===");
  console.log("MockUSDC:", usdcAddress);
  console.log("MockUSDT:", usdtAddress);
  console.log("EscrowFactoryV2:", factoryAddress);
  console.log("Treasury:", treasuryAddress);
  console.log("\n=== Next steps ===");
  console.log("1. Verify:");
  console.log(`   npx hardhat verify --network arbitrumSepolia ${factoryAddress} ${treasuryAddress} ${usdcAddress} ${usdtAddress}`);
  console.log("2. Update .env.test FACTORY_ADDRESS, NEXT_PUBLIC_FACTORY_ADDRESS, and INDEXER_START_BLOCK.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
