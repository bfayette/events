# Headless Ticketing & Loyalty Platform

A headless ticketing and loyalty platform built with Node.js and Express. It issues Apple Wallet `.pkpass` files and Google Wallet passes for event tickets and loyalty cards, and validates entry scans using TOTP-based gate checks.

---

## Architecture Overview

### 1. Application Model
- **API layer:** Express service exposes event, pass, and verification endpoints.
- **Pass issuance:** Produces Apple Wallet `.pkpass` archives and Google Wallet JWT links for event tickets and loyalty cards.
- **Gate validation:** Uses TOTP-based validation and a replay cache to prevent duplicate scans.

### 2. Ticketing & Loyalty Scope
- **Ticketing:** Event access, scan validation, and status transitions.
- **Loyalty:** Pass issuance, personalized offers, and points or redemption flows.

---

## Key Features & Architecture

### 1. Device-Native Wallet Passes
- **Apple Wallet (`.pkpass`):** Dynamic pass archives compliant with PassKit for event tickets and loyalty cards.
- **Google Wallet (JWT):** Signed JWT links for pass issuance and Google Wallet object generation.
- **Dynamic barcodes:** Pass barcodes contain rotating TOTP tokens for short-lived validation.

### 2. Gate Verification & Anti-Replay Engine
- **Endpoint:** `POST /api/passes/verify`
- **Dynamic TOTP validation:** Validates ticket or pass codes against a short-lived rotating secret.
- **Replay protection:** Uses a single-use cache and TTL to reject duplicate scans.
- **Atomic status transitions:** Moves tickets from active to checked-in or otherwise consumed states.

---

## Configuration

The application uses validated environment configuration. In production environments, required secrets must be supplied and meet length and security constraints. In development and test environments, missing secrets are automatically generated as ephemeral random secrets per process.

### Environment Variables

| Variable | Required in Production? | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Application environment (`development`, `test`, `production`). |
| `PORT` | No | `3000` | HTTP server listening port. |
| `OPERATOR_KEY_ID` | No | `op-key-1` | Active key ID (`kid`) used for signing JWS receipts. |
| `OPERATOR_SECRET` | Yes (min 32 chars) | Random string (dev/test) | HS256 secret for active operator key receipt signing. Must not be a known insecure default. |
| `OPERATOR_PREVIOUS_KEYS` | No | `{}` | JSON map of previous `kid` to secret used solely for verifying receipts during key rotation. Each secret must be at least 32 chars. |
| `GOOGLE_WALLET_SECRET` | Yes (min 32 chars) | Random string (dev/test) | HS256 secret for Google Wallet save URL JWT signatures. Must not be a known insecure default. |
| `SEED_DEMO_DATA` | No | `true` in dev/test, `false` in prod | Populates in-memory stores with demo fixtures outside production. Setting `SEED_DEMO_DATA=true` in production fails startup. |

### Generating Secrets

Secrets can be generated using OpenSSL:
```bash
openssl rand -base64 48
```

### Key Rotation Procedure

To rotate signing keys without invalidating unexpired offline receipts:
1. Generate a new secret using `openssl rand -base64 48`.
2. Update `OPERATOR_KEY_ID` to the new key ID (e.g. `op-key-2`) and `OPERATOR_SECRET` to the new secret.
3. Move the previous active key ID and secret into `OPERATOR_PREVIOUS_KEYS` as a JSON string:
   ```bash
   OPERATOR_PREVIOUS_KEYS='{"op-key-1":"<old_secret_value>"}'
   ```
4. Key verification will automatically verify receipts signed with previous keys, while all new receipts are signed exclusively with the active key.
5. Once all receipts signed by the old key have expired, remove the key entry from `OPERATOR_PREVIOUS_KEYS`.

Note on Receipt Signing: Receipts are HS256-signed using an operator secret loaded from the environment. Asymmetric signing is planned for future phases.

---

## Directory Structure

```
src/
├── app.js                   # Main Express application configuration
├── config.js                # Central validated configuration loader
├── server.js                # Server entrypoint
├── app.test.js              # Server health test
└── modules/
    ├── events/              # Event, ticket, and loyalty data models + seed fixtures
    ├── passes/              # Apple .pkpass and Google Wallet pass generation
    └── validation/          # TOTP gate verification and anti-replay logic

docs/
└── E2E_GUIDE.md             # Detailed sandbox manual and automated E2E testing guide

scripts/
└── e2e-test.js              # Automated E2E verification test runner
```

---

## Getting Started

### Prerequisites
- **Node.js**: v18.x or higher
- **npm**: v9.x or higher

### Installation
1. Clone the repository and navigate into the root directory:
   ```bash
   git clone https://github.com/bfayette/events.git
   cd events
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create local environment configuration:
   ```bash
   cp .env.example .env.development
   ```

### Running the Server
- **Development mode:**
  ```bash
  npm run dev
  ```
- **Production mode:**
  ```bash
  npm start
  ```

---

## Testing & Sandbox E2E Verification

### 1. Automated Unit & Integration Tests (Jest)
Run all Jest test suites covering pass mapping and TOTP gate checks:
```bash
npm test
```

### 2. Automated Sandbox E2E Suite
Run the automated end-to-end sandbox verification runner:
```bash
npm run test:e2e
```

### 3. Manual E2E Testing Guide
For step-by-step cURL commands and sandbox verification flows, consult [docs/E2E_GUIDE.md](docs/E2E_GUIDE.md).

---

## API Endpoints Overview

Note: These endpoints currently have no authentication and use in-memory storage (they are being replaced in later phases).

### 1. Healthcheck
- `GET /health` — Check API service status

### 2. Events & Loyalty
- `GET /api/events` — Retrieve list of events
- `GET /api/events/:id` — Retrieve event details

### 3. Wallet Passes (Apple & Google)
- `GET /api/tickets/:id/apple-pass` — Download Apple Wallet `.pkpass` file
- `GET /api/tickets/:id/google-pass-url` — Get "Save to Google Wallet" link
- `GET /api/loyalty/:id/apple-pass` — Download Apple Loyalty `.pkpass` file
- `GET /api/loyalty/:id/google-pass-url` — Get Google Wallet Loyalty link

### 4. Gate Verification & Offline Receipts
- `POST /api/passes/verify` — Validate a scanned TOTP code and update ticket status
- `POST /api/passes/issue-receipt` — Issue signed JWS receipt
- `POST /api/passes/verify-receipt` — Verify a single JWS receipt token
- `POST /api/passes/reconcile` — Batch reconcile offline scan receipts
- `GET /api/passes/tickets/:id/events` — Retrieve audit event history for a ticket
