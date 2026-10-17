# Sandbox E2E Testing & Verification Guide

This guide provides comprehensive instructions for running **automated** and **manual** end-to-end (E2E) testing of the Headless E-Ticketing & Loyalty Platform within the sandbox environment.

---

## 1. Automated E2E Test Suite

The platform includes a zero-dependency automated E2E script (`scripts/e2e-test.js`) that boots an isolated server instance, provisions wallets, issues passes, performs dynamic TOTP gate check-ins, tests anti-replay protection, and dispatches gasless ERC-4337 transactions.

### Running Automated E2E Tests:
```bash
npm run test:e2e
```

**Expected Output:**
```
🚀 Starting E2E Sandbox Verification Suite...
[1/5] Testing Healthcheck Endpoint...
  ✅ Server health ok
[2/5] Testing Turnkey Sub-Organization Provisioning...
  ✅ Provisioned wallet: 0x... (SubOrg: suborg-...)
[3/5] Testing Apple .pkpass & Google Wallet Pass Issuance...
  ✅ Apple Wallet .pkpass binary generated successfully
  ✅ Google Wallet Save URL generated: https://pay.google.com/gp/v/save/...
[4/5] Testing Dynamic TOTP Gate Verification & Anti-Replay Cache...
  ✅ Initial gate scan successful (Status: CHECKED_IN)
  ✅ Replay attack correctly blocked (HTTP 409 Conflict)
[5/5] Testing ERC-4337 Gasless UserOp Construction & Dispatch...
  ✅ ERC-4337 UserOperation intent constructed
  ✅ UserOp dispatched successfully (Tx Hash: 0x_tx_hash_...)

🎉 ALL E2E SANDBOX TESTS PASSED SUCCESSFULLY!
```

---

## 2. Manual E2E Testing (cURL Walkthrough)

To manually test and inspect HTTP responses in the sandbox, first start the development server:

```bash
npm run dev
```

The server will run on `http://localhost:3000`. Open a separate terminal session for cURL commands.

---

### Step A: System Health Check
```bash
curl -X GET "http://localhost:3000/health"
```
**Expected Response:** `HTTP 200`
```json
{
  "status": "ok",
  "service": "headless-ticketing-platform"
}
```

---

### Step B: Provision Non-Custodial Wallet (Turnkey Sub-Org)
```bash
curl -X POST "http://localhost:3000/api/users/provision-wallet" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "alice_sandbox_01",
    "subOrgName": "Alice SubOrg",
    "passkeyName": "Alice iPhone Passkey"
  }'
```
**Expected Response:** `HTTP 201 Created`
```json
{
  "message": "Sub-organization and wallet provisioned successfully",
  "user": {
    "userId": "alice_sandbox_01",
    "subOrganizationId": "suborg-1712345678-1029",
    "walletId": "wallet-1712345678",
    "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "createdAt": "2025-10-17T14:50:00.000Z"
  }
}
```

---

### Step C: Request Apple Wallet `.pkpass` File
```bash
curl -X GET "http://localhost:3000/api/tickets/tkt_001/apple-pass" \
  --output ticket-tkt_001.pkpass
```
*Creates a valid binary `ticket-tkt_001.pkpass` zip archive containing `pass.json`, assets, and `manifest.json`.*

---

### Step D: Request Google Wallet Save URL
```bash
curl -X GET "http://localhost:3000/api/tickets/tkt_001/google-pass-url"
```
**Expected Response:** `HTTP 200 OK`
```json
{
  "saveUrl": "https://pay.google.com/gp/v/save/eyJhbGciOiJIUzI1Ni...",
  "claims": { ... }
}
```

---

### Step E: Gate Scan Verification & Anti-Replay Attack Testing

#### 1. Generate valid TOTP token for test ticket `tkt_001` (Secret: `JBSWY3DPEHPK3PXP`)
Using `node`:
```bash
node -e 'console.log(require("otplib").authenticator.generate("JBSWY3DPEHPK3PXP"))'
```
*(Suppose the output token is `582910`)*

#### 2. Execute First Gate Scan
```bash
curl -X POST "http://localhost:3000/api/passes/verify" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": "tkt_001",
    "totpToken": "582910"
  }'
```
**Expected Response:** `HTTP 200 OK`
```json
{
  "message": "Gate check-in successful",
  "ticketId": "tkt_001",
  "status": "CHECKED_IN",
  "checkedInAt": "2025-10-17T14:55:00.000Z"
}
```

#### 3. Execute Duplicate Gate Scan (Replay Attack Attempt)
Re-send the exact same cURL request immediately:
```bash
curl -X POST "http://localhost:3000/api/passes/verify" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": "tkt_001",
    "totpToken": "582910"
  }'
```
**Expected Response:** `HTTP 409 Conflict`
```json
{
  "message": "Replay attack detected: Token has already been scanned"
}
```

---

### Step F: Gasless ERC-4337 Ticket Transfer & Dispatch

#### 1. Construct Ticket Transfer UserOperation Intent
```bash
curl -X POST "http://localhost:3000/api/aa/transfer-ticket" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": "tkt_001",
    "recipientAddress": "0x9999999999999999999999999999999999999999"
  }'
```
**Expected Response:** `HTTP 200 OK` (returns constructed UserOp JSON payload).

#### 2. Dispatch Signed UserOperation via Paymaster
```bash
curl -X POST "http://localhost:3000/api/aa/dispatch" \
  -H "Content-Type: application/json" \
  -d '{
    "userOp": {
      "sender": "0x1234567890abcdef1234567890abcdef12345678",
      "callData": "0x_transferTicket_tkt_001_to_0x9999999999999999999999999999999999999999",
      "paymasterAndData": "0x_paymaster_sponsored_gasless_v1"
    },
    "signature": "0x_webauthn_stamped_signature"
  }'
```
**Expected Response:** `HTTP 200 OK`
```json
{
  "message": "UserOperation dispatched successfully via Paymaster",
  "result": {
    "status": "SUBMITTED",
    "userOpHash": "0x_userop_hash_...",
    "transactionHash": "0x_tx_hash_...",
    "paymasterSponsored": true
  }
}
```
