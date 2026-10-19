#!/usr/bin/env bash
# scripts/httpie-flows.sh
# Quick flows for local dev. Set API_KEY and VERIFIER_KEY in environment or replace inline.

BASE_URL=${BASE_URL:-http://localhost:3000}
API_KEY=${API_KEY:-"<API_KEY>"}
VERIFIER_KEY=${VERIFIER_KEY:-"<VERIFIER_KEY>"}

echo "1) Issue STATIC ticket (with optional short code request)"
http POST ${BASE_URL}/api/tickets \
  Authorization:"Bearer ${API_KEY}" \
  eventId=evt_demo codeMode=STATIC holderName="Alex Paper" holderPhone="+15551231234" maxEntries:=1 shortCodeRequested:=true

echo "-----"
echo "2) Verify STATIC QR (replace <qrPayload> with actual returned payload)"
echo "http POST ${BASE_URL}/api/passes/verify Authorization:\"Bearer ${VERIFIER_KEY}\" method=STATIC_QR payload=<qrPayload> eventId=evt_demo"

echo "-----"
echo "3) Verify SHORT_CODE"
echo "http POST ${BASE_URL}/api/passes/verify Authorization:\"Bearer ${VERIFIER_KEY}\" method=SHORT_CODE code==\"ABCD-EFGH\" eventId=evt_demo"

echo "-----"
echo "4) Staff lookup"
http POST ${BASE_URL}/api/lookup Authorization:"Bearer ${VERIFIER_KEY}" eventId=evt_demo phone=+15559877654

echo "-----"
echo "5) Consume lookup token (replace <lookupToken>)"
echo "http POST ${BASE_URL}/api/passes/verify Authorization:\"Bearer ${VERIFIER_KEY}\" method=LOOKUP lookupToken==\"<lookupToken>\" idChecked==true"

echo "Done - replace placeholders with real values from the issue/lookup responses."
