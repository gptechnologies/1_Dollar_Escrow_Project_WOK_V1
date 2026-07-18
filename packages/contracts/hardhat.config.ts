import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

// Load env from root
dotenv.config({ path: "../../.env.test" });
dotenv.config({ path: "../../.env.prod" });

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.ORACLE_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    arbitrumSepolia: {
      url: process.env.RPC_HTTP || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: deployerKey ? [deployerKey] : [],
      chainId: 421614,
    },
    arbitrumOne: {
      url: process.env.ARBITRUM_RPC_HTTP || process.env.RPC_HTTP || "https://arb1.arbitrum.io/rpc",
      accounts: deployerKey ? [deployerKey] : [],
      chainId: 42161,
    },
    ethereum: {
      url: process.env.ETHEREUM_RPC_HTTP || "https://ethereum-rpc.publicnode.com",
      accounts: deployerKey ? [deployerKey] : [],
      chainId: 1,
    },
  },
  etherscan: {
    apiKey: {
      arbitrumSepolia: process.env.ETHERSCAN_API_KEY || "",
      arbitrumOne: process.env.ETHERSCAN_API_KEY || "",
      ethereum: process.env.ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
    ],
  },
};

export default config;
