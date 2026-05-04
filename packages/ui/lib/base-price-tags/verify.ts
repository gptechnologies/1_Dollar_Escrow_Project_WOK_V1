import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Address,
  type Hex,
} from 'viem';
import { basePayAmountToRaw } from './amount';
import { getBasePriceTagChain } from './config';
import type { PriceTagPayment } from './types';

const TRANSFER_EVENT_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    name: 'Transfer',
    type: 'event',
  },
] as const;

type BasePaymentStatus = {
  status: 'completed' | 'pending' | 'failed' | 'not_found' | string;
  id: string;
  message?: string;
  sender?: string;
  amount?: string;
  recipient?: string;
  error?: string;
};

export type PaymentVerificationResult =
  | { status: 'confirmed'; payerAddress: `0x${string}` | null }
  | { status: 'pending'; reason: string }
  | { status: 'failed'; reason: string };

async function getBasePayStatus(txHash: `0x${string}`): Promise<BasePaymentStatus | null> {
  try {
    const { getPaymentStatus } = await import('@base-org/account');
    const chain = getBasePriceTagChain();

    return (await getPaymentStatus({
      id: txHash,
      testnet: chain.testnet,
    })) as BasePaymentStatus;
  } catch (error) {
    console.warn('Base Pay status check failed, falling back to RPC verification:', error);
    return null;
  }
}

async function verifyFromReceipt(payment: PriceTagPayment): Promise<PaymentVerificationResult> {
  if (!payment.txHash) {
    return { status: 'failed', reason: 'Missing transaction hash' };
  }

  const chain = getBasePriceTagChain();
  const client = createPublicClient({
    chain: chain.viemChain,
    transport: http(chain.rpcUrl),
  });

  const receipt = await client.getTransactionReceipt({ hash: payment.txHash });

  if (receipt.status !== 'success') {
    return { status: 'failed', reason: 'Transaction failed on-chain' };
  }

  const expectedRecipient = getAddress(payment.recipientAddress);
  const expectedToken = getAddress(payment.tokenAddress);
  const expectedAmount = BigInt(payment.expectedAmountRaw);

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== expectedToken) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: TRANSFER_EVENT_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== 'Transfer') {
        continue;
      }

      const to = getAddress(decoded.args.to as Address);
      const value = decoded.args.value as bigint;

      if (to === expectedRecipient && value === expectedAmount) {
        return {
          status: 'confirmed',
          payerAddress: getAddress(decoded.args.from as Address) as `0x${string}`,
        };
      }
    } catch {
      continue;
    }
  }

  return { status: 'failed', reason: 'No matching USDC transfer found in transaction' };
}

export async function verifyPayment(payment: PriceTagPayment): Promise<PaymentVerificationResult> {
  if (!payment.txHash) {
    return { status: 'failed', reason: 'Missing transaction hash' };
  }

  const status = await getBasePayStatus(payment.txHash);

  if (status) {
    if (status.status === 'pending' || status.status === 'not_found') {
      return { status: 'pending', reason: status.message || 'Payment is still pending' };
    }

    if (status.status === 'failed') {
      return { status: 'failed', reason: status.error || status.message || 'Base Pay reported failure' };
    }

    if (status.status === 'completed') {
      const expectedRecipient = getAddress(payment.recipientAddress);
      const statusRecipient = status.recipient ? getAddress(status.recipient) : null;
      const statusAmountRaw = status.amount ? basePayAmountToRaw(status.amount) : null;

      if (statusRecipient !== expectedRecipient) {
        return { status: 'failed', reason: 'Base Pay recipient does not match price tag' };
      }

      if (statusAmountRaw !== payment.expectedAmountRaw) {
        return { status: 'failed', reason: 'Base Pay amount does not match price tag' };
      }

      return {
        status: 'confirmed',
        payerAddress: status.sender ? (getAddress(status.sender) as `0x${string}`) : null,
      };
    }
  }

  try {
    return await verifyFromReceipt(payment);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RPC verification failed';

    if (message.toLowerCase().includes('not found')) {
      return { status: 'pending', reason: 'Transaction receipt not available yet' };
    }

    return { status: 'failed', reason: message };
  }
}

export function isHexTxHash(value: string | null): value is Hex {
  return !!value && /^0x[a-fA-F0-9]{64}$/.test(value);
}

