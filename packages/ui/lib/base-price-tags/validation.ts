import { isAddress, getAddress } from 'viem';

export function normalizeAddress(address: string): `0x${string}` {
  const trimmed = address.trim();

  if (!isAddress(trimmed)) {
    throw new Error('Invalid Base wallet address');
  }

  return getAddress(trimmed);
}

export function normalizeDescription(description: unknown): string {
  if (typeof description !== 'string') {
    throw new Error('Description is required');
  }

  const normalized = description.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    throw new Error('Description is required');
  }

  if (normalized.length > 120) {
    throw new Error('Description must be 120 characters or fewer');
  }

  return normalized;
}

export function assertTxHash(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('Invalid transaction hash');
  }

  return value as `0x${string}`;
}

