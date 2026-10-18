# E2E Testing Guide

This guide describes how to run E2E verification tests.

## Running E2E Tests
Run:
```bash
npm run test:e2e
```

The script verifies:
1. Health check endpoint
2. Apple `.pkpass` and Google Wallet pass issuance
3. TOTP gate check-in and anti-replay cache
4. Signed receipt issuance and offline reconciliation
