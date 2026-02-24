import { sql, hexToBuffer, bufferToHex } from "../db/client.js";
import { nanoid } from "nanoid";

export async function createPaymentLink(params: {
  wallet: string;
  token: string;
  amount: string;
  description?: string;
}): Promise<{ code: string }> {
  const code = nanoid(10);

  await sql`
    INSERT INTO payment_links (code, wallet, token, amount, description)
    VALUES (
      ${code},
      ${hexToBuffer(params.wallet)},
      ${hexToBuffer(params.token)},
      ${params.amount},
      ${params.description ?? null}
    )
  `;

  console.log(`🔗 Payment link created: ${code} → ${params.wallet}`);

  return { code };
}

export async function getPaymentLink(code: string): Promise<{
  code: string;
  wallet: string;
  token: string;
  amount: string;
  description: string | null;
  createdAt: string;
}> {
  const rows = await sql`
    SELECT code, wallet, token, amount, description, created_at
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
    createdAt: row.created_at.toISOString(),
  };
}
