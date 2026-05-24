import { getAddress } from 'viem';
import { buildBaseScanTxUrl, getBasePriceTagChain } from './config';
import { createPaymentId, createPriceTagCode } from './code';
import { ensureBasePriceTagSchema, getSql } from './db';
import { buildPriceTagPaymentUrl } from './urls';
import type {
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceTag,
  PriceTagPayment,
  PriceTagPaymentWithTag,
} from './types';

type PriceTagRow = {
  code: string;
  amount_raw: string;
  amount_display: string;
  description: string;
  recipient_address: string;
  chain_id: number;
  token_address: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type PaymentRow = {
  id: string;
  price_tag_code: string;
  method: PaymentMethod;
  provider: PaymentProvider;
  provider_payment_id: string | null;
  tx_hash: string | null;
  expected_amount_raw: string;
  expected_amount_display: string;
  recipient_address: string;
  chain_id: number;
  token_address: string;
  payer_address: string | null;
  status: PaymentStatus;
  provider_status: string | null;
  partner_user_ref: string | null;
  onramp_url: string | null;
  payment_currency: string | null;
  payment_total: string | null;
  payment_subtotal: string | null;
  provider_response_json: unknown | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
  confirmed_at: Date | null;
};

type PaymentWithTagRow = PaymentRow & {
  price_tag_description: string;
};

function mapPriceTag(row: PriceTagRow, origin?: string): PriceTag {
  const chain = getBasePriceTagChain();

  return {
    code: row.code,
    amountRaw: row.amount_raw,
    amountDisplay: row.amount_display,
    description: row.description,
    recipientAddress: getAddress(row.recipient_address) as `0x${string}`,
    chainId: row.chain_id,
    chainName: row.chain_id === chain.chainId ? chain.name : `Chain ${row.chain_id}`,
    tokenAddress: getAddress(row.token_address) as `0x${string}`,
    tokenSymbol: 'USDC',
    isActive: row.is_active,
    paymentUrl: buildPriceTagPaymentUrl(row.code, origin),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapPayment(row: PaymentRow): PriceTagPayment {
  return {
    id: row.id,
    priceTagCode: row.price_tag_code,
    method: row.method,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    txHash: row.tx_hash as `0x${string}` | null,
    expectedAmountRaw: row.expected_amount_raw,
    expectedAmountDisplay: row.expected_amount_display,
    recipientAddress: getAddress(row.recipient_address) as `0x${string}`,
    chainId: row.chain_id,
    tokenAddress: getAddress(row.token_address) as `0x${string}`,
    payerAddress: row.payer_address ? (getAddress(row.payer_address) as `0x${string}`) : null,
    status: row.status,
    providerStatus: row.provider_status,
    partnerUserRef: row.partner_user_ref,
    onrampUrl: row.onramp_url,
    paymentCurrency: row.payment_currency,
    paymentTotal: row.payment_total,
    paymentSubtotal: row.payment_subtotal,
    failureReason: row.failure_reason,
    explorerUrl: row.tx_hash ? buildBaseScanTxUrl(row.tx_hash) : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
  };
}

function mapPaymentWithTag(row: PaymentWithTagRow): PriceTagPaymentWithTag {
  return {
    ...mapPayment(row),
    priceTagDescription: row.price_tag_description,
  };
}

export async function createPriceTag(params: {
  amountRaw: string;
  amountDisplay: string;
  description: string;
  recipientAddress: `0x${string}`;
  origin?: string;
}): Promise<PriceTag> {
  await ensureBasePriceTagSchema();

  const sql = getSql();
  const chain = getBasePriceTagChain();

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = createPriceTagCode();
    const rows = await sql<PriceTagRow[]>`
      INSERT INTO price_tags (
        code,
        amount_raw,
        amount_display,
        description,
        recipient_address,
        chain_id,
        token_address
      )
      VALUES (
        ${code},
        ${params.amountRaw},
        ${params.amountDisplay},
        ${params.description},
        ${params.recipientAddress.toLowerCase()},
        ${chain.chainId},
        ${chain.usdcAddress.toLowerCase()}
      )
      ON CONFLICT (code) DO NOTHING
      RETURNING *
    `;

    if (rows[0]) {
      return mapPriceTag(rows[0], params.origin);
    }
  }

  throw new Error('Could not generate a unique price tag code');
}

export async function getPriceTag(code: string, origin?: string): Promise<PriceTag | null> {
  await ensureBasePriceTagSchema();

  const rows = await getSql()<PriceTagRow[]>`
    SELECT *
    FROM price_tags
    WHERE code = ${code}
  `;

  return rows[0] ? mapPriceTag(rows[0], origin) : null;
}

export async function listRecentPriceTags(limit = 25, origin?: string): Promise<PriceTag[]> {
  await ensureBasePriceTagSchema();

  const rows = await getSql()<PriceTagRow[]>`
    SELECT *
    FROM price_tags
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => mapPriceTag(row, origin));
}

export async function listPriceTagsByRecipient(params: {
  recipientAddress: `0x${string}`;
  limit?: number;
  origin?: string;
}): Promise<PriceTag[]> {
  await ensureBasePriceTagSchema();

  const rows = await getSql()<PriceTagRow[]>`
    SELECT *
    FROM price_tags
    WHERE recipient_address = ${params.recipientAddress.toLowerCase()}
    ORDER BY created_at DESC
    LIMIT ${params.limit ?? 100}
  `;

  return rows.map((row) => mapPriceTag(row, params.origin));
}

export async function createPendingPayment(params: {
  priceTagCode: string;
  txHash: `0x${string}`;
}): Promise<PriceTagPayment> {
  await ensureBasePriceTagSchema();

  const sql = getSql();
  const tag = await getPriceTag(params.priceTagCode);

  if (!tag) {
    throw new Error('Price tag not found');
  }

  const rows = await sql<PaymentRow[]>`
    INSERT INTO payments (
      id,
      price_tag_code,
      tx_hash,
      method,
      provider,
      provider_payment_id,
      expected_amount_raw,
      expected_amount_display,
      recipient_address,
      chain_id,
      token_address,
      status
    )
    VALUES (
      ${createPaymentId()},
      ${tag.code},
      ${params.txHash.toLowerCase()},
      'BASE_PAY',
      'base',
      ${params.txHash.toLowerCase()},
      ${tag.amountRaw},
      ${tag.amountDisplay},
      ${tag.recipientAddress.toLowerCase()},
      ${tag.chainId},
      ${tag.tokenAddress.toLowerCase()},
      'pending'
    )
    ON CONFLICT (tx_hash) DO NOTHING
    RETURNING *
  `;

  if (rows[0]) {
    return mapPayment(rows[0]);
  }

  const existing = await getPaymentByTxHash(params.txHash);

  if (!existing) {
    throw new Error('Transaction hash is already used');
  }

  if (existing.priceTagCode !== tag.code) {
    throw new Error('Transaction hash is already used by another payment');
  }

  return existing;
}

export async function getPayment(id: string): Promise<PriceTagPayment | null> {
  await ensureBasePriceTagSchema();

  const rows = await getSql()<PaymentRow[]>`
    SELECT *
    FROM payments
    WHERE id = ${id}
  `;

  return rows[0] ? mapPayment(rows[0]) : null;
}

export async function getPaymentByTxHash(txHash: string): Promise<PriceTagPayment | null> {
  await ensureBasePriceTagSchema();

  const rows = await getSql()<PaymentRow[]>`
    SELECT *
    FROM payments
    WHERE tx_hash = ${txHash.toLowerCase()}
  `;

  return rows[0] ? mapPayment(rows[0]) : null;
}

export async function updatePaymentStatus(params: {
  id: string;
  status: PaymentStatus;
  payerAddress?: `0x${string}` | null;
  failureReason?: string | null;
}): Promise<PriceTagPayment> {
  await ensureBasePriceTagSchema();

  const rows = await getSql()<PaymentRow[]>`
    UPDATE payments
    SET
      status = ${params.status},
      payer_address = ${params.payerAddress?.toLowerCase() ?? null},
      failure_reason = ${params.failureReason ?? null},
      updated_at = NOW(),
      confirmed_at = CASE WHEN ${params.status} = 'confirmed' THEN NOW() ELSE confirmed_at END
    WHERE id = ${params.id}
    RETURNING *
  `;

  if (!rows[0]) {
    throw new Error('Payment not found');
  }

  return mapPayment(rows[0]);
}

export async function listRecentPayments(limit = 25): Promise<PriceTagPayment[]> {
  await ensureBasePriceTagSchema();

  const rows = await getSql()<PaymentRow[]>`
    SELECT *
    FROM payments
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map(mapPayment);
}

export async function listPaymentsByRecipient(params: {
  recipientAddress: `0x${string}`;
  limit?: number;
}): Promise<PriceTagPaymentWithTag[]> {
  await ensureBasePriceTagSchema();

  const rows = await getSql()<PaymentWithTagRow[]>`
    SELECT payments.*, price_tags.description AS price_tag_description
    FROM payments
    JOIN price_tags ON payments.price_tag_code = price_tags.code
    WHERE payments.recipient_address = ${params.recipientAddress.toLowerCase()}
      AND payments.status = 'confirmed'
    ORDER BY payments.confirmed_at DESC NULLS LAST, payments.created_at DESC
    LIMIT ${params.limit ?? 100}
  `;

  return rows.map(mapPaymentWithTag);
}

export async function createPendingOnrampPayment(params: {
  id?: string;
  priceTagCode: string;
  partnerUserRef: string;
  onrampUrl?: string | null;
}): Promise<PriceTagPayment> {
  await ensureBasePriceTagSchema();

  const tag = await getPriceTag(params.priceTagCode);

  if (!tag) {
    throw new Error('Price tag not found');
  }

  const rows = await getSql()<PaymentRow[]>`
    INSERT INTO payments (
      id,
      price_tag_code,
      method,
      provider,
      expected_amount_raw,
      expected_amount_display,
      recipient_address,
      chain_id,
      token_address,
      status,
      provider_status,
      partner_user_ref,
      onramp_url
    )
    VALUES (
      ${params.id ?? createPaymentId()},
      ${tag.code},
      'COINBASE_ONRAMP_HOSTED',
      'coinbase_onramp',
      ${tag.amountRaw},
      ${tag.amountDisplay},
      ${tag.recipientAddress.toLowerCase()},
      ${tag.chainId},
      ${tag.tokenAddress.toLowerCase()},
      'pending',
      'created',
      ${params.partnerUserRef},
      ${params.onrampUrl ?? null}
    )
    RETURNING *
  `;

  if (!rows[0]) {
    throw new Error('Failed to create onramp payment');
  }

  return mapPayment(rows[0]);
}

export async function updateOnrampSession(params: {
  id: string;
  onrampUrl: string;
  providerStatus?: string | null;
  providerResponse?: unknown;
}): Promise<PriceTagPayment> {
  await ensureBasePriceTagSchema();

  const rows = await getSql()<PaymentRow[]>`
    UPDATE payments
    SET
      onramp_url = ${params.onrampUrl},
      provider_status = ${params.providerStatus ?? 'session_created'},
      provider_response_json = ${params.providerResponse ? JSON.stringify(params.providerResponse) : null},
      updated_at = NOW()
    WHERE id = ${params.id}
    RETURNING *
  `;

  if (!rows[0]) {
    throw new Error('Payment not found');
  }

  return mapPayment(rows[0]);
}

export async function updateOnrampPaymentStatus(params: {
  id: string;
  status: PaymentStatus;
  providerStatus?: string | null;
  providerPaymentId?: string | null;
  txHash?: `0x${string}` | null;
  paymentCurrency?: string | null;
  paymentTotal?: string | null;
  paymentSubtotal?: string | null;
  failureReason?: string | null;
  providerResponse?: unknown;
}): Promise<PriceTagPayment> {
  await ensureBasePriceTagSchema();

  const rows = await getSql()<PaymentRow[]>`
    UPDATE payments
    SET
      status = ${params.status},
      provider_status = ${params.providerStatus ?? null},
      provider_payment_id = COALESCE(${params.providerPaymentId ?? null}, provider_payment_id),
      tx_hash = COALESCE(${params.txHash?.toLowerCase() ?? null}, tx_hash),
      payment_currency = COALESCE(${params.paymentCurrency ?? null}, payment_currency),
      payment_total = COALESCE(${params.paymentTotal ?? null}, payment_total),
      payment_subtotal = COALESCE(${params.paymentSubtotal ?? null}, payment_subtotal),
      failure_reason = ${params.failureReason ?? null},
      provider_response_json = COALESCE(${params.providerResponse ? JSON.stringify(params.providerResponse) : null}::jsonb, provider_response_json),
      updated_at = NOW(),
      confirmed_at = CASE WHEN ${params.status} = 'confirmed' THEN NOW() ELSE confirmed_at END
    WHERE id = ${params.id}
    RETURNING *
  `;

  if (!rows[0]) {
    throw new Error('Payment not found');
  }

  return mapPayment(rows[0]);
}
