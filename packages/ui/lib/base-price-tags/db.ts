import postgres from 'postgres';

type SqlClient = ReturnType<typeof postgres>;

let sqlClient: SqlClient | null = null;
let schemaReady: Promise<void> | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!url) {
    throw new Error('DATABASE_URL or POSTGRES_URL is required for Base price tags');
  }

  return url;
}

export function getSql(): SqlClient {
  if (!sqlClient) {
    sqlClient = postgres(getDatabaseUrl(), {
      max: 2,
      idle_timeout: 75,
      connect_timeout: 15,
    });
  }

  return sqlClient;
}

export async function ensureBasePriceTagSchema(): Promise<void> {
  if (!schemaReady) {
    const sql = getSql();

    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS price_tags (
          code TEXT PRIMARY KEY,
          amount_raw TEXT NOT NULL,
          amount_display TEXT NOT NULL,
          description TEXT NOT NULL,
          recipient_address TEXT NOT NULL,
          chain_id INTEGER NOT NULL,
          token_address TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY,
          price_tag_code TEXT NOT NULL REFERENCES price_tags(code),
          tx_hash TEXT UNIQUE,
          expected_amount_raw TEXT NOT NULL,
          expected_amount_display TEXT NOT NULL,
          recipient_address TEXT NOT NULL,
          chain_id INTEGER NOT NULL,
          token_address TEXT NOT NULL,
          payer_address TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          failure_reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          confirmed_at TIMESTAMPTZ
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS idx_price_tags_recipient ON price_tags(recipient_address)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_price_tags_created_at ON price_tags(created_at)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_payments_price_tag_code ON payments(price_tag_code)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at)`;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_payments_recipient_status_confirmed
        ON payments(recipient_address, status, confirmed_at DESC)
      `;
    })();
  }

  return schemaReady;
}
