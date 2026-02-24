import { ethers } from "hardhat";

/**
 * Deploy PaymentRouter to Arbitrum One (production)
 *
 * The PaymentRouter stores payment-link parameters on-chain so that
 * the payer cannot alter the recipient or amount.  The owner (oracle
 * wallet) creates links; anyone can call pay(id) after approving
 * the token spend.
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying PaymentRouter with account:", deployer.address);
  console.log(
    "Account balance:",
    (await ethers.provider.getBalance(deployer.address)).toString()
  );

  const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const USDT_ADDRESS = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";

  console.log("\n=== PaymentRouter Deployment ===");
  console.log("Network: Arbitrum One (42161)");
  console.log("USDC:", USDC_ADDRESS);
  console.log("USDT:", USDT_ADDRESS);
  console.log("Owner (oracle):", deployer.address);
  console.log("\nDeploying in 10 seconds... (ctrl+c to cancel)");

  await new Promise((resolve) => setTimeout(resolve, 10000));

  console.log("\nDeploying PaymentRouter...");
  const PaymentRouter = await ethers.getContractFactory("PaymentRouter");
  const router = await PaymentRouter.deploy(USDC_ADDRESS, USDT_ADDRESS);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("PaymentRouter deployed to:", routerAddress);

  console.log("\n=== Deployment Summary ===");
  console.log("PaymentRouter:", routerAddress);
  console.log("Owner:", deployer.address);
  console.log("Allowed tokens: USDC, USDT");

  console.log("\n=== Next Steps ===");
  console.log("1. Verify contract:");
  console.log(
    `   npx hardhat verify --network arbitrumOne ${routerAddress} ${USDC_ADDRESS} ${USDT_ADDRESS}`
  );
  console.log("\n2. Add env var to oracle + UI:");
  console.log(`   PAYMENT_ROUTER_ADDRESS=${routerAddress}`);
  console.log(`   NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS=${routerAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
