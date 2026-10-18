# Headless Ticketing & Loyalty Platform

A headless ticketing and loyalty platform built with Node.js and Express. It issues Apple Wallet `.pkpass` files and Google Wallet passes for event tickets and loyalty cards, validates entry scans using TOTP-based gate checks, and can submit on-chain actions through an ERC-4337 paymaster/bundler layer when transaction execution is needed.

The platform keeps application state in its own backend services and does not store raw user private keys or seed phrases. Where on-chain execution is required, it relies on scoped operator delegation, auditable action logs, and constrained transaction policies rather than exposing full wallet control to end users.

---

## Architecture Overview

### 1. Application Model
- **API layer:** Express service exposes event, pass, verification, and wallet endpoints.
- **Pass issuance:** Produces Apple Wallet `.pkpass` archives and Google Wallet JWT links for event tickets and loyalty cards.
- **Gate validation:** Uses TOTP-based validation and a replay cache to prevent duplicate scans.
- **Wallet / transaction layer:** Integrates with Turnkey and optional ERC-4337 infrastructure for account creation and gasless intent submission.

### 2. Operator-Managed Transaction Model
- The backend does not keep raw user signing keys in memory, logs, or the database.
- When a transaction is required, the platform operates under an operator or delegated authority model with explicit scope, limits, and audit logs.
- This is designed for ticketing and loyalty use cases where the primary value is access control and promotions rather than unrestricted monetary custody.

### 3. Ticketing & Loyalty Scope
- **Ticketing:** Event access, scan validation, and status transitions.
- **Loyalty:** Pass issuance, personalized offers, and points or redemption flows where value remains bounded and auditable.
- **Not a general-purpose custody platform:** The system is intentionally scoped to access and promotion flows, not unrestricted wallet custody or uncontrolled token transfer.

---

## Key Features & Architecture

### 1. Turnkey Integration
- **No raw private key storage:** The backend never stores raw private keys or seed phrases in memory, logs, or databases.
- **Provisioning flow:** User wallets are created in isolated sub-organizations or delegated contexts using Turnkey (`@turnkey/http`).
- **Persisted metadata:** Stores only operational identifiers such as `subOrganizationId`, `walletId`, and public wallet addresses when required by the integration.
- **Passkey stamping:** Relays client-signed WebAuthn signatures directly to Turnkey without modifying request payloads.

### 2. Device-Native Wallet Passes
- **Apple Wallet (`.pkpass`):** Dynamic pass archives compliant with PassKit for event tickets and loyalty cards.
- **Google Wallet (JWT):** Signed JWT links for pass issuance and Google Wallet object generation.
- **Dynamic barcodes:** Pass barcodes may contain rotating TOTP tokens or other short-lived validation data.

### 3. Gate Verification & Anti-Replay Engine
- **Endpoint:** `POST /api/passes/verify`
- **Dynamic TOTP validation:** Validates ticket or pass codes against a short-lived rotating secret.
- **Replay protection:** Uses a single-use cache and TTL to reject duplicate scans.
- **Atomic status transitions:** Moves tickets from active to checked-in or otherwise consumed states.

### 4. Gasless Intent Infrastructure (ERC-4337)
- **Account abstraction support:** Formats approved actions into ERC-4337 `UserOperation` payloads when a transaction-backed workflow is required.
- **Paymaster routing:** Can dispatch client-signed intents through an ERC-4337 paymaster and bundler layer.
- **Scope-bound execution:** Paymaster and relayer policies should enforce allowlists, limits, and explicit approval rules.

---

## Directory Structure

```
src/
├── app.js                   # Main Express application configuration
├── server.js                # Server entrypoint
├── app.test.js              # Server health test
└── modules/
    ├── events/              # Event, ticket, and loyalty data models + services
    ├── passes/              # Apple .pkpass and Google Wallet pass generation
    ├── turnkey/             # Turnkey sub-org provisioning and request proxying
    ├── validation/          # TOTP gate verification and anti-replay logic
    └── aa/                  # ERC-4337 intent builders and paymaster routing

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
Run all Jest test suites covering pass mapping, Turnkey sub-org creation, TOTP gate checks, and ERC-4337 intent builders:
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

### 1. Events & Loyalty
- `GET /api/events` — Retrieve list of events
- `GET /api/events/:id` — Retrieve event details

### 2. Wallet Passes (Apple & Google)
- `GET /api/tickets/:id/apple-pass` — Download Apple Wallet `.pkpass` file
- `GET /api/tickets/:id/google-pass-url` — Get "Save to Google Wallet" link
- `GET /api/loyalty/:id/apple-pass` — Download Apple Loyalty `.pkpass` file
- `GET /api/loyalty/:id/google-pass-url` — Get Google Wallet Loyalty link

### 3. Turnkey Sub-Org Provisioning
- `POST /api/users/provision-wallet` — Provision a user sub-organization or delegated wallet context
- `GET /api/users/:userId/wallet` — Retrieve wallet metadata if configured for the integration
- `POST /api/turnkey/proxy` — Relay client-signed stamps to Turnkey API

### 4. Gate Verification
- `POST /api/passes/verify` — Validate a scanned code and update ticket status
  - Body payload: `{ "ticketId": "tkt_001", "totpToken": "123456" }` or `{ "payload": "tkt_001:123456" }`

### 5. ERC-4337 Gasless Intents
- `POST /api/aa/transfer-ticket` — Build a ticket transfer intent
- `POST /api/aa/redeem-points` — Build a points redemption intent
- `POST /api/aa/dispatch` — Relay a signed UserOperation to a Paymaster / Bundler

---

## Operational Notes

### Scope and Risk Model
This project is intentionally designed for access-control and promotional flows where the core value is validity, redemption, and loyalty benefits rather than unrestricted asset custody. As a result, the operating model emphasizes:
- scoped delegation,
- minimal secret exposure,
- replay protection,
- signed/verifiable actions,
- and explicit operational limits.

### Why This Matters
This architecture keeps the backend simple and avoids the operational complexity of unrestricted wallet custody. It is a better fit for ticketing and loyalty use cases, where the primary concern is reliable pass issuance and redemption rather than broad on-chain financial autonomy.
