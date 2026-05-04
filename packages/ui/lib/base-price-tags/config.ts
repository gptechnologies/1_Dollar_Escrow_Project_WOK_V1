import { base, baseSepolia } from 'viem/chains';

export type BasePriceTagNetwork = 'base' | 'base-sepolia';

export type BasePriceTagChain = {
  key: BasePriceTagNetwork;
  chainId: number;
  name: string;
  viemChain: typeof base | typeof baseSepolia;
  usdcAddress: `0x${string}`;
  explorerTxBaseUrl: string;
  rpcUrl?: string;
  testnet: boolean;
};

export const BASE_MAINNET_USDC =
  (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS ||
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913') as `0x${string}`;

export const BASE_SEPOLIA_USDC =
  (process.env.NEXT_PUBLIC_BASE_SEPOLIA_USDC_ADDRESS ||
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`;

export function isBaseTestnet(): boolean {
  return process.env.NEXT_PUBLIC_BASE_TESTNET === 'true';
}

export function getBasePriceTagChain(): BasePriceTagChain {
  if (isBaseTestnet()) {
    return {
      key: 'base-sepolia',
      chainId: 84532,
      name: 'Base Sepolia',
      viemChain: baseSepolia,
      usdcAddress: BASE_SEPOLIA_USDC,
      explorerTxBaseUrl: 'https://sepolia.basescan.org/tx/',
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
      testnet: true,
    };
  }

  return {
    key: 'base',
    chainId: 8453,
    name: 'Base',
    viemChain: base,
    usdcAddress: BASE_MAINNET_USDC,
    explorerTxBaseUrl: 'https://basescan.org/tx/',
    rpcUrl: process.env.BASE_RPC_URL,
    testnet: false,
  };
}

export function getBasePriceTagPublicConfig() {
  const chain = getBasePriceTagChain();

  return {
    chainId: chain.chainId,
    chainName: chain.name,
    usdcAddress: chain.usdcAddress,
    explorerTxBaseUrl: chain.explorerTxBaseUrl,
    testnet: chain.testnet,
  };
}

export function buildBaseScanTxUrl(txHash: string): string {
  return `${getBasePriceTagChain().explorerTxBaseUrl}${txHash}`;
}

