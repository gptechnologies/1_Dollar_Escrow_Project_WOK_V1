# Escrow Oracle Service

Node.js backend service for the deterministic escrow system.

## Features

- **API Server**: Create escrows, check status
- **Event Watcher**: Monitors USDC transfers to escrows
- **Processor**: Records confirmations and funding on-chain
- **Keeper**: Finalizes payouts and expires stale escrows

## Quick Start

```bash
# Install dependencies
npm install

# Set environment
cp ../../env.test.template ../../.env.test
# Edit with your RPC, keys, database URLs

# Run database migration
psql $POSTGRES_URL < src/db/schema.sql

# Start development server
npm run dev
```

## API Endpoints

### POST /escrow/create

Create a new escrow.

**Request:**
```json
{
  "payout": "0xSellerAddress",
  "funder": "0xBuyerAddress",
  "targetAmount": "100000000",
  "deadline": 1735689600
}
```

**Response:**
```json
{
  "escrow": "0xEscrowAddress",
  "code": "abc123xyz0",
  "txHash": "0x...",
  "phase": 0,
  "confirmDeadline": 1735516800
}
```

**Headers:**
```
Authorization: Bearer YOUR_WEBHOOK_SHARED_SECRET
Content-Type: application/json
```

### GET /escrow/status/:code

Get escrow status by lookup code.

**Response:**
```json
{
  "escrow": "0xEscrowAddress",
  "code": "abc123xyz0",
  "phase": 1,
  "phaseName": "ConfirmedAwaitingFunding",
  "payout": "0xSeller",
  "funder": "0xBuyer",
  "targetAmount": "100000000",
  "confirmationAmount": "1000000",
  "deadline": 1735689600,
  "confirmDeadline": 1735516800,
  "createdAt": 1735430400,
  "confirmationRecorded": true,
  "fundingRecorded": false,
  "isPayable": false,
  "isExpirableNoConfirm": false,
  "isExpirableNoFund": false,
  "isTerminal": false
}
```

### GET /health

Health check endpoint.

```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

## Background Services

### Event Watcher

Monitors USDC Transfer events to escrow addresses:

1. Detects seller $1 confirmation transfers
2. Detects buyer funding transfers
3. Validates sender address and timing
4. Calls `recordConfirmation` or `recordFunding` on-chain

### Keeper

Periodic maintenance loop (every 60 seconds):

1. Calls `finalizeAfterDeadline` for funded escrows past deadline
2. Calls `expireIfNotConfirmed` for escrows past 24h window
3. Calls `expireIfNotFunded` for confirmed escrows past deadline
4. Calls `sweepToTreasury` for terminal escrows with balance

## Database

Uses Postgres for escrow registry and transaction deduplication.

**Tables:**
- `escrows`: Escrow addresses, codes, parties, deadlines
- `cursor`: Last processed block per network
- `processed_tx`: Transaction deduplication

**Migrate:**
```bash
psql $POSTGRES_URL < src/db/schema.sql
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `test` or `production` |
| `CHAIN_ID` | `421614` (Sepolia) or `42161` (Arbitrum One) |
| `RPC_HTTP` | Alchemy HTTP endpoint |
| `RPC_WSS` | Alchemy WebSocket endpoint |
| `ORACLE_PRIVATE_KEY` | Wallet private key for transactions |
| `FACTORY_ADDRESS` | Deployed EscrowFactory address |
| `USDC_ADDRESS` | USDC token address |
| `POSTGRES_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `PORT` | API server port (default: 3000) |
| `WEBHOOK_SHARED_SECRET` | API authentication token |

## Deployment

### Railway/Render/Fly

1. Connect git repository
2. Set environment variables
3. Build command: `npm install && npm run build`
4. Start command: `npm start`

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["npm", "start"]
```

## Development

```bash
# Run with hot reload
npm run dev

# Run tests
npm test

# Type check
npm run typecheck
```

## Logging

The service logs:
- API requests
- Transaction submissions
- Event detections
- Keeper actions
- Errors

All logs include timestamps and relevant addresses/hashes.
