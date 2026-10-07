#!/usr/bin/env bash
# OL-034 full demo rehearsal, driven entirely through the API + scripts so it is repeatable.
# Mirrors docs/implementation/DEMO_SCRIPT.md steps 1-10:
#   1 login  2 procure  3 match + re-run  4 offer/decline/advance/accept
#   5 transport  6 transplant  7 organs + discard  8 reports  9 rule script  10 concurrency
#
# It resets the DB first (destructive, local only), runs the server on a private port, and
# prints one PASS line per step. Exits non-zero on the first mismatch. Needs curl + jq.
#
# Usage: npm run demo:rehearsal   (or: bash scripts/demo-rehearsal.sh)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3097}"
JAR="$(mktemp)"
SERVER_PID=""
STATUS=""; BODY=""

cleanup() {
  rm -f "$JAR"
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

fail() {
  echo "FAIL $1" >&2
  [[ -n "${2:-}" ]] && echo "  $2" >&2
  [[ -n "$BODY" ]] && echo "  last response ($STATUS): $BODY" >&2
  exit 1
}

command -v jq >/dev/null || { echo "demo-rehearsal: jq is required" >&2; exit 2; }
command -v curl >/dev/null || { echo "demo-rehearsal: curl is required" >&2; exit 2; }
command -v psql >/dev/null || { echo "demo-rehearsal: psql is required" >&2; exit 2; }

call() {
  local method="$1" path="$2" data="${3:-}" out
  local args=(-s -m 20 -b "$JAR" -c "$JAR" -X "$method" -w $'\n%{http_code}' "$BASE_URL$path")
  [[ -n "$data" ]] && args+=(-H 'content-type: application/json' -d "$data")
  out="$(curl "${args[@]}")" || fail "$method $path" "curl failed (is the server up at $BASE_URL?)"
  STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

expect() {
  local name="$1" want="$2"; shift 2
  [[ "$STATUS" == "$want" ]] || fail "$name" "expected HTTP $want, got $STATUS"
  while [[ $# -gt 0 ]]; do
    local got
    got="$(jq -r "$1" <<<"$BODY" 2>/dev/null)" || fail "$name" "response is not JSON"
    [[ "$got" == "$2" ]] || fail "$name" "expected $1 == $2, got $got"
    shift 2
  done
  echo "PASS $name"
}

START_TS="$(date +%s)"

echo "== fresh reset =="
bash "$ROOT/scripts/db-reset.sh" --yes >/dev/null

echo "== starting server on $BASE_URL =="
port="${BASE_URL##*:}"
PORT="$port" node "$ROOT/server/index.js" >/dev/null 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do curl -s -m 1 -o /dev/null "$BASE_URL/api/health" && break; sleep 0.25; done

# --- 1. login ---------------------------------------------------------------
call GET /api/health
expect health 200 .status ok
call POST /api/auth/login '{"username":"admin","password":"admin"}'
expect demo-step-1-login 200 .user.username admin

call GET /api/lookups
DECLINE_REASON="$(jq -r '.declineReasons[0].id' <<<"$BODY")"
DISCARD_REASON="$(jq -r '.discardReasons[0].id' <<<"$BODY")"
call GET /api/donors
DONORS="$(jq -c '[.[] | select(.status=="ACTIVE") | {id, hospitalId}]' <<<"$BODY")"

# --- 2+3. procure, match, re-run -------------------------------------------
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ORGAN=""; RUN=""
for pair in $(jq -r '.[] | .id' <<<"$DONORS" | head -8); do
  for type in 4 3 1 2; do
    hosp="$(jq -r --argjson d "$pair" '.[] | select(.id==$d) | .hospitalId' <<<"$DONORS")"
    call POST "/api/donors/$pair/organs" "{\"organTypeId\":$type,\"recoveringHospitalId\":$hosp,\"recoveredAt\":\"$NOW\"}"
    [[ "$STATUS" == 201 ]] || continue
    organ_id="$(jq -r .id <<<"$BODY")"; origin="$(jq -r .recoveringHospitalName <<<"$BODY")"
    call POST /api/matching/runs "{\"organId\":$organ_id}"
    [[ "$STATUS" == 201 ]] || continue
    ok="$(jq -r --arg o "$origin" '(.qualified | length) >= 2 and (.qualified[0:2] | all(.hospitalName != $o))' <<<"$BODY")"
    if [[ "$ok" == true ]]; then ORGAN="$organ_id"; RUN="$BODY"; break 2; fi
  done
done
[[ -n "$ORGAN" ]] || fail "demo-step-2-procure" "no donor/organ-type pair gave 2 qualified out-of-hospital candidates"
echo "PASS demo-step-2-procure (organ $ORGAN AVAILABLE)"
call GET "/api/organs/$ORGAN"
expect demo-step-2-procure-status 200 .status AVAILABLE

RUN_ID="$(jq -r .id <<<"$RUN")"
echo "PASS demo-step-3-match (run $RUN_ID)"
call POST /api/matching/runs "{\"organId\":$ORGAN}"
expect demo-step-3-rerun 201 .organId "$ORGAN"
RUN2_ID="$(jq -r .id <<<"$BODY")"
[[ "$RUN2_ID" != "$RUN_ID" ]] || fail "demo-step-3-rerun-new-id" "re-run reused run id $RUN_ID"
call GET "/api/matching/runs/$RUN_ID"
expect demo-step-3-old-run-retrievable 200 .id "$RUN_ID"
call GET "/api/matching/runs/$RUN2_ID"
RUN="$BODY"
echo "PASS demo-step-3-rerun-new-run (run $RUN_ID then $RUN2_ID)"

R1="$(jq -r '.qualified[0].recipientId' <<<"$RUN")"
R2="$(jq -r '.qualified[1].recipientId' <<<"$RUN")"

# --- 4. offer, decline, advance, accept ------------------------------------
call POST /api/offers "{\"organId\":$ORGAN,\"recipientId\":$R1,\"matchRunId\":$RUN2_ID}"
expect demo-step-4-offer-create 201 .status CREATED .recipientId "$R1"
OFFER1="$(jq -r .id <<<"$BODY")"
call POST /api/offers "{\"organId\":$ORGAN,\"recipientId\":$R2,\"matchRunId\":$RUN2_ID}"
expect demo-step-4-negative-second-active 409 .error.code ACTIVE_OFFER_EXISTS
call POST "/api/offers/$OFFER1/send"
expect demo-step-4-offer-send 200 .status SENT
call POST "/api/offers/$OFFER1/decline" "{\"declineReasonId\":$DECLINE_REASON,\"notes\":\"rehearsal\"}"
expect demo-step-4-offer-decline 200 .status DECLINED
call POST "/api/offers/$OFFER1/advance"
expect demo-step-4-offer-advance 201 .offer.status CREATED .offer.recipientId "$R2"
OFFER2="$(jq -r .offer.id <<<"$BODY")"
call POST "/api/offers/$OFFER2/send"
expect demo-step-4-offer-send-2 200 .status SENT
call POST "/api/offers/$OFFER2/accept" '{"notes":"rehearsal"}'
expect demo-step-4-offer-accept 200 .status ACCEPTED .transport.status PENDING
TRANSPORT="$(jq -r .transport.id <<<"$BODY")"

# --- 5. transport -----------------------------------------------------------
call POST "/api/transport/$TRANSPORT/depart"
expect demo-step-5-depart 200 .status IN_TRANSIT
call POST "/api/transport/$TRANSPORT/deliver"
expect demo-step-5-deliver 200 .status DELIVERED

# --- 6. transplant ----------------------------------------------------------
call POST /api/transplants "{\"offerId\":$OFFER2,\"outcome\":\"SUCCESS\",\"notes\":\"rehearsal\"}"
expect demo-step-6-transplant 201 .outcome SUCCESS .offerId "$OFFER2"
call GET "/api/organs/$ORGAN"
expect demo-step-6-organ-transplanted 200 .status TRANSPLANTED

# --- 7. Organs page and discard --------------------------------------------
call GET "/api/organs?available=true"
AVAIL_ID="$(jq -r '.[0].id // empty' <<<"$BODY")"
[[ -n "$AVAIL_ID" ]] || fail "demo-step-7-discard" "no AVAILABLE organ to discard"
call POST "/api/organs/$AVAIL_ID/discard" "{\"discardReasonId\":$DISCARD_REASON}"
expect demo-step-7-discard 200 .status DISCARDED .discardReasonId "$DISCARD_REASON"

# --- 8. reports -------------------------------------------------------------
for ep in waiting-times utilization decline-reasons fairness compliance; do
  call GET "/api/reports/$ep"
  [[ "$STATUS" == "200" ]] || fail "demo-step-8-reports-$ep" "expected 200, got $STATUS"
done
echo "PASS demo-step-8-reports (5 endpoints 200)"

# --- stop server before the script-level steps ------------------------------
kill "$SERVER_PID" 2>/dev/null; SERVER_PID=""

# --- 9. rule script ---------------------------------------------------------
if npm --prefix "$ROOT" run db:rules >/tmp/ol034-rules.out 2>&1; then
  pass_count="$(grep -c 'PASS' /tmp/ol034-rules.out || true)"
  fail_count="$(grep -c 'FAIL' /tmp/ol034-rules.out || true)"
  [[ "$fail_count" == "0" && "$pass_count" -ge 14 ]] || fail "demo-step-9-rules" "rules produced $pass_count PASS / $fail_count FAIL"
  echo "PASS demo-step-9-rules ($pass_count rules)"
else
  cat /tmp/ol034-rules.out >&2 || true
  fail "demo-step-9-rules" "npm run db:rules exited non-zero"
fi

# --- 10. concurrency script -------------------------------------------------
if npm --prefix "$ROOT" run concurrency >/tmp/ol034-concurrency.out 2>&1; then
  echo "PASS demo-step-10-concurrency"
else
  cat /tmp/ol034-concurrency.out >&2 || true
  fail "demo-step-10-concurrency" "npm run concurrency exited non-zero"
fi

ELAPSED="$(( $(date +%s) - START_TS ))"
echo "DEMO REHEARSAL OK (steps 1-10, ${ELAPSED}s)"
echo "(reset the DB before an actual demo: npm run db:reset -- --yes)"