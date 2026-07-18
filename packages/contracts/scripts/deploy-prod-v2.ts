import { ethers, network } from "hardhat";

type RawDeploymentReceipt = {
  status?: string;
  blockNumber?: string;
  contractAddress?: string | null;
};

function transactionHashFromError(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;

  const candidate = error as {
    value?: { hash?: unknown };
    transaction?: { hash?: unknown };
    transactionHash?: unknown;
  };
  const hashes = [
    candidate.value?.hash,
    candidate.transaction?.hash,
    candidate.transactionHash,
  ];

  return hashes.find(
    (hash): hash is string => typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash)
  );
}

async function waitForRawDeploymentReceipt(txHash: string): Promise<RawDeploymentReceipt> {
  // Use raw JSON-RPC here. Some RPC gateways have returned an empty string for
  // `to` on contract-creation transactions, which ethers correctly rejects as
  // an invalid address even though the deployment itself was successful.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const receipt = await network.provider.send("eth_getTransactionReceipt", [txHash]) as RawDeploymentReceipt | null;
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Timed out waiting for deployment transaction ${txHash}`);
}

/**
 * Deploy EscrowFactoryV2 to Arbitrum One or Ethereum mainnet.
 *
 * P2P escrow design:
 * - Immutable parties (seller / buyer-refund), one settlement date, terms hash
 * - Push funding; sellerConfirm is optional and requires full funding
 * - 0/1/3 arbitration with 2-of-3 voting + 30-day mutual-resolution override
 * - No oracle, no bond. Platform fee: 1% up to $100, $1 cap above, $0.01 min
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  const isEthereum = network.config.chainId === 1;
  const networkName = isEthereum ? "Ethereum" : "Arbitrum One";
  console.log(`Deploying EscrowFactoryV2 to ${networkName} with account:`, deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const USDC_ADDRESS = isEthereum
    ? "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const USDT_ADDRESS = isEthereum
    ? "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    : "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";

  const treasuryAddress = process.env.TREASURY_ADDRESS;
  if (!treasuryAddress) {
    console.error("\n❌ ERROR: TREASURY_ADDRESS must be set for production!");
    console.error("   Use a Safe multi-sig wallet: https://app.safe.global/");
    process.exit(1);
  }

  console.log("\n=== Production Deployment Configuration ===");
  console.log(`Network: ${networkName} (${network.config.chainId})`);
  console.log("USDC:", USDC_ADDRESS);
  console.log("USDT:", USDT_ADDRESS);
  console.log("Treasury:", treasuryAddress);
  console.log("\n⚠️  This is a PRODUCTION deployment! Proceed in 10 seconds (ctrl+c to cancel)...");
  await new Promise((resolve) => setTimeout(resolve, 10000));

  const Factory = await ethers.getContractFactory("EscrowFactoryV2");
  let deploymentTxHash: string | undefined;

  try {
    const factory = await Factory.deploy(treasuryAddress, USDC_ADDRESS, USDT_ADDRESS);
    deploymentTxHash = factory.deploymentTransaction()?.hash;
  } catch (error) {
    deploymentTxHash = transactionHashFromError(error);
    if (!deploymentTxHash) throw error;
    console.warn("RPC returned a malformed contract-creation transaction; recovering from transaction hash:", deploymentTxHash);
  }

  if (!deploymentTxHash) {
    throw new Error("Deployment transaction hash is unavailable");
  }

  const deploymentReceipt = await waitForRawDeploymentReceipt(deploymentTxHash);
  if (deploymentReceipt.status !== "0x1") {
    throw new Error(`Deployment transaction ${deploymentTxHash} failed with status ${deploymentReceipt.status ?? "unknown"}`);
  }
  if (!deploymentReceipt.contractAddress || !deploymentReceipt.blockNumber) {
    throw new Error(`Deployment receipt ${deploymentTxHash} is missing its contract address or block number`);
  }

  const factoryAddress = ethers.getAddress(deploymentReceipt.contractAddress);
  const deploymentBlock = Number(BigInt(deploymentReceipt.blockNumber));
  const envPrefix = isEthereum ? "ETHEREUM" : "ARBITRUM";
  console.log("EscrowFactoryV2 deployed to:", factoryAddress);

  console.log("\n=== Production Deployment Summary ===");
  console.log(`Network: ${networkName} (${network.config.chainId})`);
  console.log("Deployment transaction:", deploymentTxHash);
  console.log("Deployment block:", deploymentBlock);
  console.log("EscrowFactoryV2:", factoryAddress);
  console.log("Treasury:", treasuryAddress);
  console.log("USDC:", USDC_ADDRESS);
  console.log("USDT:", USDT_ADDRESS);
  console.log("\n=== Copy-ready environment values ===");
  console.log(`${envPrefix}_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`${envPrefix}_INDEXER_START_BLOCK=${deploymentBlock}`);
  console.log(`NEXT_PUBLIC_${envPrefix}_FACTORY_ADDRESS=${factoryAddress}`);
  console.log("\n=== Next steps ===");
  console.log("1. Verify:");
  console.log(`   npx hardhat verify --network ${network.name} ${factoryAddress} ${treasuryAddress} ${USDC_ADDRESS} ${USDT_ADDRESS}`);
  console.log(`2. Add the copy-ready values above to the appropriate Render and Vercel environments.`);
  console.log("3. Transfer factory ownership to the multi-sig: factory.transferOwnership(<Safe>).");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
