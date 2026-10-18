# Sandbox E2E Testing & Verification Guide

This guide provides comprehensive instructions for running **automated** and **manual** end-to-end (E2E) testing of the Headless E-Ticketing & Loyalty Platform within the sandbox environment.

---

## 1. Automated E2E Test Suite

The platform includes a zero-dependency automated E2E script (`scripts/e2e-test.js`) that boots an isolated server instance, issues passes, performs dynamic TOTP gate check-ins, and tests anti-replay protection.

### Running Automated E2E Tests:
```bash
npm run test:e2e
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

### Step B: Request Apple Wallet `.pkpass` File
```bash
curl -X GET "http://localhost:3000/api/tickets/tkt_001/apple-pass" \
  --output ticket-tkt_001.pkpass
```
*Creates a valid binary `ticket-tkt_001.pkpass` zip archive containing `pass.json`, assets, and `manifest.json`.*

---

### Step C: Request Google Wallet Save URL
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

### Step D: Gate Scan Verification & Anti-Replay Attack Testing

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
