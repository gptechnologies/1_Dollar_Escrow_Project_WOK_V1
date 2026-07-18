-- Escrow Indexer Database Schema
-- Run this against your Postgres instance (Neon/Supabase/Railway)

-- Track last processed block per network
CREATE TABLE IF NOT EXISTS cursor (
  network TEXT PRIMARY KEY,
  last_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Registry of all escrows we're watching
CREATE TABLE IF NOT EXISTS escrows (
  escrow BYTEA NOT NULL,
  code TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL,
  -- Immutable parties (bound at creation)
  payout BYTEA NOT NULL,        -- seller - receives funds
  funder BYTEA NOT NULL,        -- buyer - must fund
  -- Token (USDC or USDT)
  token BYTEA NOT NULL,         -- escrow token address (USDC or USDT)
  -- Amounts and one-date settlement model
  target_amount TEXT,           -- amount buyer must fund (stored as string for bigint)
  settlement_date INTEGER,      -- P2P: resolution / underfunded-refund time (unix timestamp)
  -- Terms (immutable hash on-chain; full text cached off-chain for the dashboard)
  terms_hash TEXT,
  terms_text TEXT,
  -- Optional arbitrators (0, 1, or 3)
  arbitrator1 BYTEA,
  arbitrator2 BYTEA,
  arbitrator3 BYTEA,
  -- State: phase_cached holds the EscrowV2 Status code (0..4)
  phase_cached SMALLINT DEFAULT 0,
  created_tx TEXT,
  created_block BIGINT,            -- block number when escrow was created (for bounded log queries)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (network, escrow)
);

-- Log-level deduplication for event indexing.
-- A single transaction can emit multiple relevant logs for the same escrow.
CREATE TABLE IF NOT EXISTS processed_logs (
  network TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  escrow BYTEA,
  event_type TEXT,
  seen_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (network, tx_hash, log_index)
);

-- Durable escrow action/event timeline for dashboard history and future action buttons.
CREATE TABLE IF NOT EXISTS escrow_events (
  id BIGSERIAL PRIMARY KEY,
  network TEXT NOT NULL,
  escrow BYTEA NOT NULL,
  event_name TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  log_index INTEGER NOT NULL,
  actor BYTEA,
  amount TEXT,
  outcome SMALLINT,
  raw_args JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (network, tx_hash, log_index)
);

-- Funding is push-based, so deposits are ERC-20 Transfer logs to escrow addresses.
CREATE TABLE IF NOT EXISTS escrow_token_transfers (
  id BIGSERIAL PRIMARY KEY,
  network TEXT NOT NULL,
  token BYTEA NOT NULL,
  escrow BYTEA NOT NULL,
  from_address BYTEA NOT NULL,
  to_address BYTEA NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  log_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (network, tx_hash, log_index)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_escrows_code ON escrows(code);
CREATE INDEX IF NOT EXISTS idx_escrows_network ON escrows(network);
CREATE INDEX IF NOT EXISTS idx_escrows_phase ON escrows(phase_cached);
CREATE INDEX IF NOT EXISTS idx_escrows_payout ON escrows(payout);
CREATE INDEX IF NOT EXISTS idx_escrows_funder ON escrows(funder);
CREATE INDEX IF NOT EXISTS idx_processed_logs_escrow ON processed_logs(escrow);
CREATE INDEX IF NOT EXISTS idx_escrow_events_escrow_block ON escrow_events(network, escrow, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS idx_escrow_token_transfers_escrow_block ON escrow_token_transfers(network, escrow, block_number DESC, log_index DESC);

-- Insert default cursors for the two supported production networks.
INSERT INTO cursor (network, last_block) VALUES ('42161', 0) ON CONFLICT DO NOTHING;
INSERT INTO cursor (network, last_block) VALUES ('1', 0) ON CONFLICT DO NOTHING;
