-- Escrow Oracle Database Schema (Deterministic V1)
-- Run this against your Postgres instance (Neon/Supabase/Railway)

-- Track last processed block per network
CREATE TABLE IF NOT EXISTS cursor (
  network TEXT PRIMARY KEY,
  last_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Registry of all escrows we're watching
CREATE TABLE IF NOT EXISTS escrows (
  escrow BYTEA PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL,
  -- Immutable parties (bound at creation)
  payout BYTEA NOT NULL,        -- seller - receives funds
  funder BYTEA NOT NULL,        -- buyer - must fund
  -- Token (USDC or USDT)
  token BYTEA NOT NULL,         -- escrow token address (USDC or USDT)
  -- Amounts and deadlines
  target_amount TEXT,           -- amount buyer must fund (stored as string for bigint)
  deadline INTEGER,             -- payout deadline (unix timestamp)
  confirm_deadline INTEGER,     -- 24h confirm window (unix timestamp)
  -- Optional arbitrators
  arbitrator1 BYTEA,
  arbitrator2 BYTEA,
  -- State
  phase_cached SMALLINT DEFAULT 0,
  created_tx TEXT,
  created_block BIGINT,            -- block number when escrow was created (for bounded log queries)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deduplication: track processed transactions
-- Primary key is (tx_hash, escrow) to handle multi-log transactions correctly
CREATE TABLE IF NOT EXISTS processed_tx (
  tx_hash TEXT NOT NULL,
  escrow BYTEA NOT NULL,
  event_type TEXT,
  seen_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tx_hash, escrow)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_escrows_code ON escrows(code);
CREATE INDEX IF NOT EXISTS idx_escrows_network ON escrows(network);
CREATE INDEX IF NOT EXISTS idx_escrows_phase ON escrows(phase_cached);
CREATE INDEX IF NOT EXISTS idx_escrows_payout ON escrows(payout);
CREATE INDEX IF NOT EXISTS idx_escrows_funder ON escrows(funder);
CREATE INDEX IF NOT EXISTS idx_processed_tx_escrow ON processed_tx(escrow);
CREATE INDEX IF NOT EXISTS idx_processed_tx_seen_at ON processed_tx(seen_at);

-- Insert default cursor for supported networks
INSERT INTO cursor (network, last_block) VALUES ('421614', 0) ON CONFLICT DO NOTHING;
INSERT INTO cursor (network, last_block) VALUES ('42161', 0) ON CONFLICT DO NOTHING;

-- Migration: Add created_block column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'escrows' AND column_name = 'created_block'
  ) THEN
    ALTER TABLE escrows ADD COLUMN created_block BIGINT;
  END IF;
END $$;

-- Migration: Add token column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'escrows' AND column_name = 'token'
  ) THEN
    ALTER TABLE escrows ADD COLUMN token BYTEA;
  END IF;
END $$;

-- Migration: Add arbitrator1 column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'escrows' AND column_name = 'arbitrator1'
  ) THEN
    ALTER TABLE escrows ADD COLUMN arbitrator1 BYTEA;
  END IF;
END $$;

-- Migration: Add arbitrator2 column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'escrows' AND column_name = 'arbitrator2'
  ) THEN
    ALTER TABLE escrows ADD COLUMN arbitrator2 BYTEA;
  END IF;
END $$;

-- Migration: Add arbitrator3 column if it doesn't exist (deadlock arbitrator for 3-arb setup)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'escrows' AND column_name = 'arbitrator3'
  ) THEN
    ALTER TABLE escrows ADD COLUMN arbitrator3 BYTEA;
  END IF;
END $$;

-- Migration: Add arb_window_end column if it doesn't exist (Hybrid Confirmation Model)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'escrows' AND column_name = 'arb_window_end'
  ) THEN
    ALTER TABLE escrows ADD COLUMN arb_window_end INTEGER;
  END IF;
END $$;

-- Payment links for QR-based stablecoin payments
CREATE TABLE IF NOT EXISTS payment_links (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  wallet BYTEA NOT NULL,
  token BYTEA NOT NULL,
  amount TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_links_code ON payment_links(code);

-- Migration: Change processed_tx primary key from tx_hash to (tx_hash, escrow)
-- This fixes multi-log transaction handling and improves reorg safety
DO $$
BEGIN
  -- Check if the old primary key constraint exists (single column tx_hash)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'processed_tx' 
    AND tc.constraint_type = 'PRIMARY KEY'
    AND kcu.column_name = 'tx_hash'
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.key_column_usage kcu2 
      WHERE kcu2.constraint_name = tc.constraint_name 
      AND kcu2.column_name = 'escrow'
    )
  ) THEN
    -- Drop the old primary key
    ALTER TABLE processed_tx DROP CONSTRAINT processed_tx_pkey;
    -- Make escrow NOT NULL (needed for composite PK)
    UPDATE processed_tx SET escrow = '\x0000000000000000000000000000000000000000'::BYTEA WHERE escrow IS NULL;
    ALTER TABLE processed_tx ALTER COLUMN escrow SET NOT NULL;
    -- Add the new composite primary key
    ALTER TABLE processed_tx ADD PRIMARY KEY (tx_hash, escrow);
    RAISE NOTICE 'Migrated processed_tx primary key to (tx_hash, escrow)';
  END IF;
END $$;
