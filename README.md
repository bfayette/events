# Headless Non-Custodial E-Ticketing & Loyalty Platform

A headless, non-custodial digital ticketing and loyalty platform built with Node.js and Express. End-users interact strictly via native device wallets (**Apple Wallet `.pkpass`** and **Google Wallet JWT**) and **WebAuthn Passkeys**. The platform provisions Turnkey-backed sub-organizations for zero-custody wallet isolation and processes gasless transactions via ERC-4337 Account Abstraction without holding raw private keys.

---

## Key Features & Architecture

### 1. Zero-Custody Architecture (Turnkey Integration)
- **No Private Key Access:** The backend service **never** holds, generates, or stores raw private keys or seed phrases in memory, logs, or databases.
- **Turnkey Sub-Organizations:** User wallets are created in isolated Sub-Organizations provisioned via Turnkey (`@turnkey/http`).
- **Data Persistence:** Stores only `subOrganizationId`, `walletId`, and public `walletAddress`.
- **Passkey Stamping:** Relays client-signed WebAuthn signatures directly to Turnkey without modifying request payloads.

### 2. Device-Native Wallet Passes
- **Apple Wallet (.pkpass):** Dynamic `.pkpass` archives compliant with PassKit specifications (`eventTicket` and `storeCard`). Generates ZIP buffers containing `pass.json`, manifest SHA-1 hashes, and assets.
- **Google Wallet (JWT):** Signed JWTs generating "Save to Google Wallet" links for `EventTicket` and `Loyalty` classes and objects.
- **Anti-Screenshot TOTP Barcodes:** Pass barcodes contain dynamic time-based rotating payload strings (`ticketId:totp_token`).

### 3. Gate Verification & Anti-Replay Engine
- **Endpoint:** `POST /api/passes/verify`
- **Dynamic TOTP Validation:** Validates TOTP against ticket secrets with a sliding time window ($\pm 30$ seconds).
- **In-Memory Replay Cache:** Uses single-use token consumption caching with TTL to reject duplicate scans (`409 Conflict`).
- **Atomic State Transition:** Automatically transitions ticket status to `CHECKED_IN`.

### 4. Gasless Intent Infrastructure (ERC-4337)
- **Account Abstraction:** Formats ticket transfers and loyalty points redemptions into ERC-4337 `UserOperation` payloads.
- **Paymaster Routing:** Dispatches client-signed intents through an ERC-4337 Paymaster and Bundler so end-users require zero native gas tokens (ETH/MATIC).

---

## Directory Structure

```
src/
├── app.js                   # Main Express application configuration
├── server.js                # Server entrypoint
├── app.test.js              # Server health test
└── modules/
    ├── events/              # Event, ticket & loyalty data models & service
    ├── passes/              # Apple .pkpass and Google Wallet JWT pass engine
    ├── turnkey/             # Turnkey sub-org provisioning & stamp proxy
    ├── validation/          # TOTP gate verification & anti-replay cache
    └── aa/                  # ERC-4337 UserOp intent builders & Paymaster routing
docs/
└── E2E_GUIDE.md             # Detailed sandbox manual & automated E2E testing guide
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
- `POST /api/users/provision-wallet` — Provision user sub-organization & wallet
- `GET /api/users/:userId/wallet` — Retrieve user's public wallet address & subOrg ID
- `POST /api/turnkey/proxy` — Relay client-signed stamps to Turnkey API

### 4. Gate Verification
- `POST /api/passes/verify` — Validate TOTP scanned code & update ticket status to `CHECKED_IN`
  - Body payload: `{ "ticketId": "tkt_001", "totpToken": "123456" }` or `{ "payload": "tkt_001:123456" }`

### 5. ERC-4337 Gasless Intents
- `POST /api/aa/transfer-ticket` — Build ticket transfer UserOp intent
- `POST /api/aa/redeem-points` — Build points redemption UserOp intent
- `POST /api/aa/dispatch` — Relay signed UserOp to Paymaster / Bundler
