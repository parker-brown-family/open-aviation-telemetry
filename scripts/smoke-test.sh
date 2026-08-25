#!/usr/bin/env bash
#
# End-to-end proof that the pipeline works, against a running stack.
#
# Each step asserts something a component further down the chain must have done,
# so a pass means the whole path ran — not that each service started. It is the
# fastest honest answer to "is this actually working right now".
#
#   make smoke                       against the local stack
#   API_URL=https://... make smoke   against a deployed one

set -euo pipefail

API_URL="${API_URL:-http://localhost:8080}"
AIRCRAFT_ID="${AIRCRAFT_ID:-C-GSMOKE}"

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

require() { command -v "$1" > /dev/null 2>&1 || fail "$1 is required but not installed"; }
require curl
require jq

echo "Smoke test against ${API_URL}"

# ---------------------------------------------------------------- 1. health
step "1. The API is alive and ready"

curl -sf "${API_URL}/health" > /dev/null || fail "/health did not respond"
pass "/health responds"

READY=$(curl -s "${API_URL}/ready")
echo "${READY}" | jq -e '.ready == true' > /dev/null \
  || fail "/ready reports not ready: ${READY}"
pass "/ready reports every dependency connected"

# ---------------------------------------------------------------- 2. ingest
step "2. A telemetry report is accepted and published"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
INGEST=$(curl -sf -X POST "${API_URL}/api/v1/telemetry" \
  -H 'content-type: application/json' \
  -d "{
        \"aircraft_id\": \"${AIRCRAFT_ID}\",
        \"timestamp\": \"${TIMESTAMP}\",
        \"position\": { \"latitude\": 49.9561, \"longitude\": -119.3777 },
        \"altitude_ft\": 24000,
        \"groundspeed_kts\": 360,
        \"heading_deg\": 78,
        \"vertical_rate_fpm\": 0,
        \"engine\": { \"temperature_c\": 92, \"rpm\": 2200 },
        \"fuel_remaining_kg\": 2400,
        \"identity\": { \"callsign\": \"SMOKE1\", \"type_icao\": \"DH8D\", \"operator\": \"Smoke Test\" }
      }") || fail "ingest was rejected"

EVENT_ID=$(echo "${INGEST}" | jq -r '.event_id')
[ "${EVENT_ID}" != "null" ] || fail "no event id returned: ${INGEST}"
pass "report accepted, published as event ${EVENT_ID:0:8}"

# ---------------------------------------------------------------- 3. validation
step "3. An invalid report is rejected, not stored"

STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API_URL}/api/v1/telemetry" \
  -H 'content-type: application/json' \
  -d '{"aircraft_id":"C-GBAD","timestamp":"nope","position":{"latitude":999,"longitude":0}}')
[ "${STATUS}" = "400" ] || fail "expected 400 for an invalid report, got ${STATUS}"
pass "invalid report rejected with 400"

# ---------------------------------------------------------------- 4. projection
step "4. The aircraft appears in current state"

for i in $(seq 1 15); do
  AIRCRAFT=$(curl -s "${API_URL}/api/v1/aircraft/${AIRCRAFT_ID}")
  if echo "${AIRCRAFT}" | jq -e '.aircraft_id' > /dev/null 2>&1; then break; fi
  sleep 1
done
echo "${AIRCRAFT}" | jq -e --arg id "${AIRCRAFT_ID}" '.aircraft_id == $id' > /dev/null \
  || fail "aircraft never appeared in current state"
pass "current-state projection written by the API"

# ---------------------------------------------------------------- 5. the stream
step "5. The stream processor consumed the event and wrote history"

# This is the important assertion: history is written ONLY by the Kafka
# consumer. If a row exists, the event genuinely travelled through the broker.
HISTORY_COUNT=0
for i in $(seq 1 30); do
  HISTORY_COUNT=$(curl -s "${API_URL}/api/v1/aircraft/${AIRCRAFT_ID}/telemetry" | jq -r '.count')
  [ "${HISTORY_COUNT}" -gt 0 ] 2> /dev/null && break
  sleep 1
done
[ "${HISTORY_COUNT}" -gt 0 ] 2> /dev/null \
  || fail "no history rows after 30s — the consumer did not process the event"
pass "history written downstream of Kafka (${HISTORY_COUNT} rows)"

# ---------------------------------------------------------------- 6. alerting
step "6. An out-of-limits reading becomes an alert"

ALERT_TS=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
curl -sf -X POST "${API_URL}/api/v1/telemetry" \
  -H 'content-type: application/json' \
  -d "{
        \"aircraft_id\": \"${AIRCRAFT_ID}\",
        \"timestamp\": \"${ALERT_TS}\",
        \"position\": { \"latitude\": 49.96, \"longitude\": -119.38 },
        \"altitude_ft\": 24000, \"groundspeed_kts\": 360, \"heading_deg\": 78,
        \"vertical_rate_fpm\": 0,
        \"engine\": { \"temperature_c\": 155, \"rpm\": 2200 }
      }" > /dev/null || fail "over-temperature report was rejected"

ALERTS=0
for i in $(seq 1 20); do
  ALERTS=$(curl -s "${API_URL}/api/v1/alerts?aircraft_id=${AIRCRAFT_ID}" | jq -r '.count')
  [ "${ALERTS}" -gt 0 ] 2> /dev/null && break
  sleep 1
done
[ "${ALERTS}" -gt 0 ] 2> /dev/null || fail "no alert raised for a 155C engine temperature"
pass "engine over-temperature raised an alert"

# ---------------------------------------------------------------- 7. async jobs
step "7. A report is generated asynchronously by the worker"

REPORT=$(curl -sf -X POST "${API_URL}/api/v1/aircraft/${AIRCRAFT_ID}/reports" \
  -H 'content-type: application/json' \
  -d '{"kind":"flight_summary","window_minutes":60}') || fail "report request failed"

REPORT_ID=$(echo "${REPORT}" | jq -r '.report_id')
[ "${REPORT_ID}" != "null" ] || fail "no report id returned"
echo "${REPORT}" | jq -e '.status == "pending"' > /dev/null \
  || fail "report should start pending — the API must not generate it inline"
pass "report queued and returned immediately as pending"

STATUS_VALUE="pending"
for i in $(seq 1 30); do
  STATUS_VALUE=$(curl -s "${API_URL}/api/v1/reports/${REPORT_ID}" | jq -r '.status')
  [ "${STATUS_VALUE}" = "completed" ] && break
  [ "${STATUS_VALUE}" = "failed" ] && break
  sleep 1
done
[ "${STATUS_VALUE}" = "completed" ] || fail "report ended as '${STATUS_VALUE}', expected completed"
pass "worker completed the report"

# ---------------------------------------------------------------- 8. failure
step "8. A failing job retries, then dead-letters"

FAILING=$(curl -sf -X POST "${API_URL}/api/v1/demo/scenario/worker_failure") \
  || fail "could not inject a worker failure"
FAILING_ID=$(echo "${FAILING}" | jq -r '.report_id')

FAILED_STATUS="pending"
ATTEMPTS=0
# Three attempts five seconds apart, plus slack.
for i in $(seq 1 45); do
  BODY=$(curl -s "${API_URL}/api/v1/reports/${FAILING_ID}")
  FAILED_STATUS=$(echo "${BODY}" | jq -r '.status')
  ATTEMPTS=$(echo "${BODY}" | jq -r '.attempts')
  [ "${FAILED_STATUS}" = "failed" ] && break
  sleep 1
done
[ "${FAILED_STATUS}" = "failed" ] \
  || fail "injected failure ended as '${FAILED_STATUS}' after ${ATTEMPTS} attempts, expected failed"
[ "${ATTEMPTS}" -ge 3 ] 2> /dev/null \
  || fail "expected at least 3 attempts before dead-lettering, saw ${ATTEMPTS}"
pass "job retried ${ATTEMPTS} times then dead-lettered"

# ---------------------------------------------------------------- 9. metrics
step "9. Metrics and statistics are real"

curl -sf "${API_URL}/metrics" | grep -q 'oat_telemetry_accepted_total' \
  || fail "/metrics does not expose the ingest counter"
pass "/metrics exposes counters in Prometheus format"

STATS=$(curl -s "${API_URL}/api/v1/stats")
echo "${STATS}" | jq -e '.stream.connected == true' > /dev/null || fail "stats report Kafka disconnected"
echo "${STATS}" | jq -e '.jobs.depth.dead_lettered >= 1' > /dev/null \
  || fail "dead-letter queue depth should be at least 1 after step 8"
pass "stats read consumer lag and queue depth from the brokers"

printf '\n\033[32mAll checks passed.\033[0m The full path works: ingest, Kafka, processor,\n'
printf 'PostgreSQL, alerting, RabbitMQ, worker, retry and dead-lettering.\n\n'
