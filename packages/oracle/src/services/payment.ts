import { sql, hexToBuffer, bufferToHex } from "../db/client.js";
import { nanoid } from "nanoid";
import { keccak256, toHex, toBytes } from "viem";
import { submitTxJob } from "../blockchain/tx-queue.js";

function deriveLinkId(code: string): `0x${string}` {
  return keccak256(toHex(toBytes(code)));
}

export async function createPaymentLink(params: {
  wallet: string;
  token: string;
  amount: string;
  description?: string;
}): Promise<{ code: string; linkId: string }> {
  const code = nanoid(10);
  const linkId = deriveLinkId(code);

  await sql`
    INSERT INTO payment_links (code, wallet, token, amount, description, link_id)
    VALUES (
      ${code},
      ${hexToBuffer(params.wallet)},
      ${hexToBuffer(params.token)},
      ${params.amount},
      ${params.description ?? null},
      ${hexToBuffer(linkId)}
    )
  `;

  console.log(`🔗 Payment link created: ${code} (linkId: ${linkId}) → ${params.wallet}`);

  registerLinkOnChain(code, linkId, params.token, params.wallet, params.amount);

  return { code, linkId };
}

/**
 * Fire-and-forget on-chain registration via the tx queue.
 * If it fails the link still works off-chain; the flag is updated on success.
 */
async function registerLinkOnChain(
  code: string,
  linkId: string,
  token: string,
  recipient: string,
  amount: string,
): Promise<void> {
  try {
    const job = await submitTxJob("createPaymentLink", {
      linkId,
      token,
      recipient,
      amount,
    });

    job.waitUntilFinished(
      (await import("../blockchain/tx-queue.js")).getQueueEvents(),
      120_000,
    ).then(async (result) => {
      if (result.success) {
        await sql`UPDATE payment_links SET on_chain = TRUE WHERE code = ${code}`;
        console.log(`✅ Payment link ${code} registered on-chain (tx: ${result.txHash})`);
      } else {
        console.error(`❌ On-chain registration failed for ${code}: ${result.error}`);
      }
    }).catch((err) => {
      console.error(`❌ On-chain registration error for ${code}:`, err);
    });
  } catch (err) {
    console.error(`❌ Failed to submit on-chain registration job for ${code}:`, err);
  }
}

export async function getPaymentLink(code: string): Promise<{
  code: string;
  wallet: string;
  token: string;
  amount: string;
  description: string | null;
  onChain: boolean;
  linkId: string | null;
  createdAt: string;
}> {
  const rows = await sql`
    SELECT code, wallet, token, amount, description, on_chain, link_id, created_at
    FROM payment_links
    WHERE code = ${code}
  `;

  if (rows.length === 0) {
    throw new Error(`Payment link not found: ${code}`);
  }

  const row = rows[0] as any;
  return {
    code: row.code,
    wallet: bufferToHex(row.wallet as Buffer),
    token: bufferToHex(row.token as Buffer),
    amount: row.amount,
    description: row.description ?? null,
    onChain: row.on_chain ?? false,
    linkId: row.link_id ? bufferToHex(row.link_id as Buffer) : deriveLinkId(row.code),
    createdAt: row.created_at.toISOString(),
  };
}
