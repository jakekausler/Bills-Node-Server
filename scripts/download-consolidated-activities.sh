#!/bin/bash
# Downloads consolidated activities for all accounts from a server
# Usage: ./download-consolidated-activities.sh <output_file> [base_url] [token]
# Defaults: base_url=http://localhost:5003, token=dummy (dev mode)

set -e

OUTPUT_FILE="${1:?Usage: $0 <output_file> [base_url] [token]}"
BASE_URL="${2:-http://localhost:5003}"
TOKEN="${3:-dummy}"
START_DATE="2026-01-01"
END_DATE="2083-12-31"
SIMULATION="Default"

echo "Downloading consolidated activities from ${BASE_URL}..."
echo "Date range: ${START_DATE} to ${END_DATE}"

# Get all account IDs
ACCOUNTS=$(curl -s -H "Authorization: ${TOKEN}" \
  "${BASE_URL}/api/accounts?simulation=${SIMULATION}&startDate=${START_DATE}&endDate=${END_DATE}" \
  | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');JSON.parse(d).forEach(a=>console.log(a.id+'|'+a.name))")

echo "Found accounts:"
echo "${ACCOUNTS}"
echo ""

# Build JSON output with all accounts
echo "{" > "${OUTPUT_FILE}"
FIRST=true

while IFS='|' read -r ACCOUNT_ID ACCOUNT_NAME; do
  [ -z "${ACCOUNT_ID}" ] && continue

  echo "  Downloading: ${ACCOUNT_NAME} (${ACCOUNT_ID})..."

  if [ "${FIRST}" = true ]; then
    FIRST=false
  else
    echo "," >> "${OUTPUT_FILE}"
  fi

  # Download consolidated activities for this account
  ACTIVITIES=$(curl -s -H "Authorization: ${TOKEN}" \
    "${BASE_URL}/api/accounts/${ACCOUNT_ID}/consolidated_activity?simulation=${SIMULATION}&startDate=${START_DATE}&endDate=${END_DATE}")

  printf '  "%s": {"name": "%s", "activities": %s}' "${ACCOUNT_ID}" "${ACCOUNT_NAME}" "${ACTIVITIES}" >> "${OUTPUT_FILE}"

done <<< "${ACCOUNTS}"

echo "" >> "${OUTPUT_FILE}"
echo "}" >> "${OUTPUT_FILE}"

echo ""
echo "Done! Saved to ${OUTPUT_FILE}"
echo "File size: $(wc -c < "${OUTPUT_FILE}") bytes"
