import { ARBITRUM_CHAIN_ID } from './chain';

/**
 * Build an EIP-681 URI for an ERC-20 transfer on Arbitrum.
 * Most wallets (MetaMask, Coinbase, Trust) recognize this format
 * when scanned via their QR scanner.
 *
 * Format: ethereum:<token>@<chainId>/transfer?address=<to>&uint256=<amount>
 */
export function buildEIP681Uri(
  tokenAddress: string,
  recipientAddress: string,
  rawAmount: string,
): string {
  return `ethereum:${tokenAddress}@${ARBITRUM_CHAIN_ID}/transfer?address=${recipientAddress}&uint256=${rawAmount}`;
}

/**
 * Build the shareable payment page URL from a code.
 */
export function buildPaymentUrl(code: string): string {
  const base =
    typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_BASE_URL || '';
  return `${base}/p/${code}`;
}
