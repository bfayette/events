#!/usr/bin/env bash
set -euo pipefail

# Minimal CI helper for running unit & E2E tests inside CI.
# Required env vars (example):
#  OPERATOR_SECRET, API_KEYS (single-line JSON), AUTH_ENFORCED (true/false)
: "${OPERATOR_SECRET:?Need OPERATOR_SECRET env var}"
: "${API_KEYS:?Need API_KEYS env var}"

export NODE_ENV=${NODE_ENV:-test}
export AUTH_ENFORCED=${AUTH_ENFORCED:-true}
export SEED_DEMO_DATA=${SEED_DEMO_DATA:-true}

echo "Installing dependencies..."
npm ci

echo "Running unit tests..."
npm test --silent

echo "Running E2E tests..."
npm run test:e2e --silent

echo "All tests passed."
