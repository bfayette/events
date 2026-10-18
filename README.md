# Headless Ticketing Platform

A headless e-ticketing and loyalty platform built with Node.js and Express. It issues Apple Wallet `.pkpass` files and Google Wallet passes for event tickets and loyalty cards, and validates entry scans using TOTP-based gate checks.

---

## Architecture Overview

### 1. Application Model
- **API layer:** Express service exposes event, pass, and verification endpoints.
- **Pass issuance:** Produces Apple Wallet `.pkpass` archives and Google Wallet JWT links for event tickets and loyalty cards.
- **Gate validation:** Uses TOTP-based validation and a replay cache to prevent duplicate scans.

### 2. Ticketing & Loyalty Scope
- **Ticketing:** Event access, scan validation, and status transitions.
- **Loyalty:** Pass issuance, personalized offers, and points balance flows.

---

## Key Features & Architecture

### 1. Device-Native Wallet Passes
- **Apple Wallet (`.pkpass`):** Dynamic pass archives compliant with PassKit for event tickets and loyalty cards.
- **Google Wallet (JWT):** Signed JWT links for pass issuance and Google Wallet object generation.
- **Dynamic barcodes:** Pass barcodes contain rotating TOTP tokens or short-lived validation data.

### 2. Gate Verification & Anti-Replay Engine
- **Endpoint:** `POST /api/passes/verify`
- **Dynamic TOTP validation:** Validates ticket or pass codes against a short-lived rotating secret.
- **Replay protection:** Uses a single-use cache and TTL to reject duplicate scans.
- **Atomic status transitions:** Moves tickets from active to checked-in or otherwise consumed states.

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
   cp .env.example .env
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

### 1. Events & Loyalty
- `GET /api/events` — Retrieve list of events
- `GET /api/events/:id` — Retrieve event details

### 2. Wallet Passes (Apple & Google)
- `GET /api/tickets/:id/apple-pass` — Download Apple Wallet `.pkpass` file
- `GET /api/tickets/:id/google-pass-url` — Get "Save to Google Wallet" link
- `GET /api/loyalty/:id/apple-pass` — Download Apple Loyalty `.pkpass` file
- `GET /api/loyalty/:id/google-pass-url` — Get Google Wallet Loyalty link

### 3. Gate Verification
- `POST /api/passes/verify` — Validate a scanned code and update ticket status
  - Body payload: `{ "ticketId": "tkt_001", "totpToken": "123456" }` or `{ "payload": "tkt_001:123456" }`
