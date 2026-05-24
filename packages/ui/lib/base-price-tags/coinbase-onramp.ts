import { generateJwt } from '@coinbase/cdp-sdk/auth';
import { getAddress } from 'viem';
import { displayAmountToSixDecimalAmount } from './amount';
import { getBasePriceTagChain } from './config';
import type { PriceTag, PriceTagPayment } from './types';

type CoinbaseSessionResponse = {
  onrampUrl?: string;
  onramp_url?: string;
  url?: string;
  sessionToken?: string;
  session_token?: string;
  [key: string]: unknown;
};

type CoinbaseTransaction = {
  transaction_id?: string;
  id?: string;
  status?: string;
  tx_hash?: string;
  txHash?: string;
  purchase_currency?: string;
  purchaseCurrency?: string;
  purchase_network?: string;
  purchaseNetwork?: string;
  wallet_address?: string;
  walletAddress?: string;
  purchase_amount?: { value?: string } | string;
  purchaseAmount?: { value?: string } | string;
  payment_total?: { value?: string; currency?: string } | string;
  paymentTotal?: { value?: string; currency?: string } | string;
  payment_subtotal?: { value?: string } | string;
  paymentSubtotal?: { value?: string } | string;
  [key: string]: unknown;
};

export type OnrampVerificationResult =
  | { status: 'confirmed'; transaction: CoinbaseTransaction; txHash: `0x${string}` }
  | { status: 'pending'; reason: string; transaction?: CoinbaseTransaction }
  | { status: 'failed' | 'cancelled'; reason: string; transaction?: CoinbaseTransaction };

function getApiBaseUrl(): string {
  return (process.env.COINBASE_ONRAMP_API_BASE_URL || 'https://api.cdp.coinbase.com').replace(/\/$/, '');
}

function getStatusApiBaseUrl(): string {
  return (process.env.COINBASE_ONRAMP_STATUS_API_BASE_URL || 'https://api.developer.coinbase.com').replace(/\/$/, '');
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for Coinbase Onramp`);
  }

  return value.replace(/\\n/g, '\n');
}

function isSandbox(): boolean {
  return process.env.COINBASE_ONRAMP_ENV !== 'production';
}

export function getOnrampMinimumRaw(): bigint {
  const configured = process.env.COINBASE_ONRAMP_MIN_USD || '5.00';
  const [whole, cents = ''] = configured.split('.');
  const normalized = `${whole || '0'}.${cents.padEnd(2, '0').slice(0, 2)}`;
  const [dollars, fractional] = normalized.split('.');

  return BigInt(dollars) * BigInt(1_000_000) + BigInt(fractional) * BigInt(10_000);
}

export function isOnrampAvailableForPriceTag(priceTag: PriceTag): boolean {
  if (!priceTag.isActive) {
    return false;
  }

  return BigInt(priceTag.amountRaw) >= getOnrampMinimumRaw();
}

export function createPartnerUserRef(priceTagCode: string, paymentId: string): string {
  const prefix = isSandbox() ? 'sandbox-' : '';
  return `${prefix}crow-tag-${priceTagCode}-payment-${paymentId}`;
}

async function createJwt(method: string, apiBaseUrl: string, path: string): Promise<string> {
  const url = new URL(apiBaseUrl);

  return generateJwt({
    apiKeyId: getRequiredEnv('CDP_API_KEY_ID'),
    apiKeySecret: getRequiredEnv('CDP_API_KEY_SECRET'),
    requestMethod: method,
    requestHost: url.host,
    requestPath: path,
  });
}

function getAppBaseUrl(requestOrigin?: string): string {
  return (
    process.env.COINBASE_ONRAMP_REDIRECT_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    requestOrigin ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function amountValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object' && 'value' in value) {
    return readString((value as { value?: unknown }).value);
  }

  return null;
}

function extractOnrampUrl(data: CoinbaseSessionResponse): string | null {
  return readString(data.onrampUrl) || readString(data.onramp_url) || readString(data.url);
}

function extractTransactions(data: unknown): CoinbaseTransaction[] {
  if (Array.isArray(data)) {
    return data as CoinbaseTransaction[];
  }

  if (!data || typeof data !== 'object') {
    return [];
  }

  const record = data as Record<string, unknown>;

  if (Array.isArray(record.transactions)) {
    return record.transactions as CoinbaseTransaction[];
  }

  if (Array.isArray(record.data)) {
    return record.data as CoinbaseTransaction[];
  }

  return [];
}

export async function createCoinbaseOnrampSession(params: {
  priceTag: PriceTag;
  paymentId: string;
  partnerUserRef: string;
  clientIp: string;
  requestOrigin?: string;
}): Promise<{ onrampUrl: string; response: CoinbaseSessionResponse }> {
  const chain = getBasePriceTagChain();

  if (chain.chainId !== 8453 && process.env.COINBASE_ONRAMP_ENV === 'production') {
    throw new Error('Coinbase Onramp is only enabled for Base mainnet in production');
  }

  if (!isOnrampAvailableForPriceTag(params.priceTag)) {
    throw new Error('Card and Apple Pay payments require a minimum of about $5.00');
  }

  const path = '/platform/v2/onramp/sessions';
  const apiBaseUrl = getApiBaseUrl();
  const jwt = await createJwt('POST', apiBaseUrl, path);
  const redirectUrl = `${getAppBaseUrl(params.requestOrigin)}/pay/${params.priceTag.code}?onramp=return&attempt=${params.paymentId}`;

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      purchaseCurrency: 'USDC',
      destinationNetwork: 'base',
      destinationAddress: params.priceTag.recipientAddress,
      purchaseAmount: displayAmountToSixDecimalAmount(params.priceTag.amountDisplay),
      paymentCurrency: 'USD',
      redirectUrl,
      clientIp: params.clientIp,
      partnerUserRef: params.partnerUserRef,
      country: process.env.COINBASE_ONRAMP_DEFAULT_COUNTRY || 'US',
      subdivision: process.env.COINBASE_ONRAMP_DEFAULT_SUBDIVISION || undefined,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as CoinbaseSessionResponse;

  if (!response.ok) {
    throw new Error(readString(data.error) || readString(data.message) || 'Coinbase Onramp session creation failed');
  }

  const onrampUrl = extractOnrampUrl(data);

  if (!onrampUrl) {
    throw new Error('Coinbase Onramp did not return a hosted URL');
  }

  return { onrampUrl, response: data };
}

export async function verifyCoinbaseOnrampPayment(
  payment: PriceTagPayment,
): Promise<OnrampVerificationResult> {
  if (!payment.partnerUserRef) {
    return { status: 'failed', reason: 'Missing Coinbase partner user reference' };
  }

  const encodedRef = encodeURIComponent(payment.partnerUserRef);
  const path = `/onramp/v1/buy/user/${encodedRef}/transactions?pageSize=5`;
  const requestPath = `/onramp/v1/buy/user/${encodedRef}/transactions`;
  const apiBaseUrl = getStatusApiBaseUrl();
  const jwt = await createJwt('GET', apiBaseUrl, requestPath);

  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return { status: 'pending', reason: 'Coinbase Onramp status is not available yet' };
  }

  const transaction = extractTransactions(data)[0];

  if (!transaction) {
    return { status: 'pending', reason: 'Coinbase Onramp transaction has not appeared yet' };
  }

  const providerStatus = readString(transaction.status)?.toUpperCase() || '';

  if (providerStatus.includes('FAILED')) {
    return { status: 'failed', reason: 'Coinbase Onramp reported a failed transaction', transaction };
  }

  if (providerStatus.includes('CANCEL')) {
    return { status: 'cancelled', reason: 'Coinbase Onramp transaction was cancelled', transaction };
  }

  if (!providerStatus.includes('SUCCESS') && !providerStatus.includes('COMPLETED')) {
    return { status: 'pending', reason: 'Coinbase Onramp transaction is still processing', transaction };
  }

  const purchaseCurrency = readString(transaction.purchase_currency) || readString(transaction.purchaseCurrency);
  const purchaseNetwork = readString(transaction.purchase_network) || readString(transaction.purchaseNetwork);
  const walletAddress = readString(transaction.wallet_address) || readString(transaction.walletAddress);
  const purchaseAmount =
    amountValue(transaction.purchase_amount) || amountValue(transaction.purchaseAmount);
  const txHash = readString(transaction.tx_hash) || readString(transaction.txHash);

  if (purchaseCurrency?.toUpperCase() !== 'USDC') {
    return { status: 'failed', reason: 'Coinbase Onramp asset does not match price tag', transaction };
  }

  if (purchaseNetwork?.toLowerCase() !== 'base') {
    return { status: 'failed', reason: 'Coinbase Onramp network does not match price tag', transaction };
  }

  if (!walletAddress || getAddress(walletAddress) !== getAddress(payment.recipientAddress)) {
    return { status: 'failed', reason: 'Coinbase Onramp recipient does not match price tag', transaction };
  }

  if (purchaseAmount !== displayAmountToSixDecimalAmount(payment.expectedAmountDisplay)) {
    return { status: 'failed', reason: 'Coinbase Onramp amount does not match price tag', transaction };
  }

  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { status: 'pending', reason: 'Coinbase Onramp succeeded but tx hash is not available yet', transaction };
  }

  return { status: 'confirmed', transaction, txHash: txHash as `0x${string}` };
}

export function getCoinbaseTransactionMetadata(transaction: CoinbaseTransaction) {
  return {
    providerPaymentId: readString(transaction.transaction_id) || readString(transaction.id),
    providerStatus: readString(transaction.status),
    paymentCurrency:
      typeof transaction.payment_total === 'object'
        ? readString(transaction.payment_total?.currency)
        : typeof transaction.paymentTotal === 'object'
          ? readString(transaction.paymentTotal?.currency)
          : 'USD',
    paymentTotal: amountValue(transaction.payment_total) || amountValue(transaction.paymentTotal),
    paymentSubtotal: amountValue(transaction.payment_subtotal) || amountValue(transaction.paymentSubtotal),
  };
}
