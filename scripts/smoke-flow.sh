#!/usr/bin/env bash
# Core-slice smoke test (OL-019): login -> procure -> match -> offers -> transport -> transplant.
# Run against a freshly reset DB:  npm run db:reset -- --yes && npm run smoke
# Env: BASE_URL (default http://localhost:3001). If nothing answers at BASE_URL, the script
# starts server/index.js itself (on BASE_URL's port) and stops it on exit.
# Prints `PASS step`, exits 1 on the first mismatch. Needs curl and jq.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3001}"
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

command -v jq >/dev/null || { echo "smoke: jq is required" >&2; exit 2; }
command -v curl >/dev/null || { echo "smoke: curl is required" >&2; exit 2; }

# call METHOD PATH [JSON]  -> sets STATUS and BODY
call() {
  local method="$1" path="$2" data="${3:-}" out
  local args=(-s -m 20 -b "$JAR" -c "$JAR" -X "$method" -w $'\n%{http_code}' "$BASE_URL$path")
  [[ -n "$data" ]] && args+=(-H 'content-type: application/json' -d "$data")
  out="$(curl "${args[@]}")" || fail "$method $path" "curl failed (is the server up at $BASE_URL?)"
  STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

# expect NAME EXPECTED_STATUS [JQ_FIELD EXPECTED_VALUE]...  (checks the last call)
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

# --- server -----------------------------------------------------------------
if ! curl -s -m 3 -o /dev/null "$BASE_URL/api/health"; then
  port="${BASE_URL##*:}"
  PORT="$port" node "$ROOT/server/index.js" >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 40); do curl -s -m 1 -o /dev/null "$BASE_URL/api/health" && break; sleep 0.25; done
fi
call GET /api/health
expect health 200 .status ok

# --- 1. login ---------------------------------------------------------------
call POST /api/auth/login '{"username":"admin","password":"admin"}'
expect login 200 .user.username admin

call GET /api/lookups
DECLINE_REASON="$(jq -r '.declineReasons[0].id' <<<"$BODY")"
call GET /api/donors
DONORS="$(jq -c '[.[] | select(.status=="ACTIVE") | {id, hospitalId}]' <<<"$BODY")"

# --- 2+3. procure + match ---------------------------------------------------
# Try donor/organ-type pairs until the run's top two candidates are at hospitals other than
# the recovering one, so the accepted offer yields a PENDING transport (same-hospital
# accepts are delivered immediately and cannot be departed).
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
[[ -n "$ORGAN" ]] || fail "procure" "no donor/organ-type pair gave a run with 2 qualified out-of-hospital candidates"
echo "PASS procure (organ $ORGAN AVAILABLE)"
call GET "/api/organs/$ORGAN"
expect procure-status 200 .status AVAILABLE

RUN_ID="$(jq -r .id <<<"$RUN")"
R1="$(jq -r '.qualified[0].recipientId' <<<"$RUN")"
R2="$(jq -r '.qualified[1].recipientId' <<<"$RUN")"
[[ "$(jq -r '.qualified[0].rank' <<<"$RUN")" == 1 ]] || fail "match" "top candidate is not rank 1"
echo "PASS match (run $RUN_ID, ${R1} then ${R2})"

# --- 4. first offer: create, 409 on a second active offer, send, decline ----
call POST /api/offers "{\"organId\":$ORGAN,\"recipientId\":$R1,\"matchRunId\":$RUN_ID}"
expect offer-create 201 .status CREATED .recipientId "$R1"
OFFER1="$(jq -r .id <<<"$BODY")"

call POST /api/offers "{\"organId\":$ORGAN,\"recipientId\":$R2,\"matchRunId\":$RUN_ID}"
expect negative-second-active-offer 409 .error.code ACTIVE_OFFER_EXISTS

call POST "/api/offers/$OFFER1/send"
expect offer-send 200 .status SENT
call POST "/api/offers/$OFFER1/decline" "{\"declineReasonId\":$DECLINE_REASON,\"notes\":\"smoke\"}"
expect offer-decline 200 .status DECLINED
call GET "/api/organs/$ORGAN"
expect organ-after-decline 200 .status AVAILABLE

# --- 5. advance, send, accept -----------------------------------------------
call POST "/api/offers/$OFFER1/advance"
expect offer-advance 201 .offer.status CREATED .offer.recipientId "$R2"
OFFER2="$(jq -r .offer.id <<<"$BODY")"
call POST "/api/offers/$OFFER2/send"
expect offer-send-2 200 .status SENT
call POST "/api/offers/$OFFER2/accept" '{"notes":"smoke"}'
expect offer-accept 200 .status ACCEPTED .transport.status PENDING
TRANSPORT="$(jq -r .transport.id <<<"$BODY")"
call GET "/api/organs/$ORGAN"
expect organ-after-accept 200 .status ALLOCATED

# --- negative: transplant before delivery -----------------------------------
call POST /api/transplants "{\"offerId\":$OFFER2,\"outcome\":\"SUCCESS\"}"
expect negative-transplant-before-delivery 422 .error.code RULE_VIOLATION

# --- 6. depart, deliver -----------------------------------------------------
call POST "/api/transport/$TRANSPORT/depart"
expect transport-depart 200 .status IN_TRANSIT
call POST "/api/transport/$TRANSPORT/deliver"
expect transport-deliver 200 .status DELIVERED

# --- 7. transplant ----------------------------------------------------------
call POST /api/transplants "{\"offerId\":$OFFER2,\"outcome\":\"SUCCESS\",\"notes\":\"smoke\"}"
expect transplant-record 201 .outcome SUCCESS .offerId "$OFFER2"
call GET "/api/organs/$ORGAN"
expect organ-transplanted 200 .status TRANSPLANTED
call GET "/api/offers/$OFFER2"
expect offer-has-transplant 200 .transplant.outcome SUCCESS

echo "SMOKE OK"
