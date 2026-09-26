#!/usr/bin/env bash
# End-to-end verification of the scope-enforcement branch against the live stack.
# Exercises the path no unit test can: a real grant, over a real NATS broker,
# into the real projection table, changing what a real HTTP request returns.
set -uo pipefail

CD="docker compose -f docker/docker-compose.yml"
GW=http://localhost:3000
PW='P@ssw0rd1234'
pass=0; fail=0

ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }
step() { printf '\n== %s\n' "$1"; }

jqp() { python3 -c "import sys,json;d=json.load(sys.stdin);$1" 2>/dev/null; }

login() {
  curl -s -X POST "$GW/api/v1/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$1@ipms.local\",\"password\":\"$PW\"}" --max-time 10 \
    | jqp 'print(d.get("accessToken",""))'
}

nprojects() {
  curl -s -H "authorization: Bearer $1" "$GW/api/v1/projects" --max-time 10 \
    | jqp 'print(len(d) if isinstance(d,list) else -1)'
}

psqlq() { $CD exec -T "postgres-$1" psql -U "ipms_$1" -d "ipms_$1" -tAc "$2" 2>/dev/null | tr -d '[:space:]'; }

step "1. Migrations applied"
[ "$(psqlq iam "select count(*) from information_schema.tables where table_name='user_global_scope';")" = "1" ] \
  && ok "iam.user_global_scope exists" || bad "iam.user_global_scope missing"
for t in user_scope projection_watermark; do
  [ "$(psqlq project "select count(*) from information_schema.tables where table_name='$t';")" = "1" ] \
    && ok "project.$t exists" || bad "project.$t missing"
done
# The three partial unique indexes, not one composite -- the NULL-distinctness fix.
idx=$(psqlq project "select count(*) from pg_indexes where tablename='user_scope' and indexname like 'user_scope_%_uniq';")
[ "$idx" = "3" ] && ok "3 partial unique indexes on user_scope" || bad "expected 3 partial unique indexes, found $idx"

step "2. Seed granted admin global scope"
[ "$(psqlq iam "select count(*) from user_global_scope ugs join \"user\" u on u.id=ugs.\"userId\" where u.email='admin@ipms.local';")" = "1" ] \
  && ok "admin holds a global grant" || bad "admin has no global grant"

# Revoke any leftover grant before asserting the fail-closed baseline. Without
# this the suite is not idempotent: a previous run's grant makes step 4 fail for
# a reason that has nothing to do with the code.
reset_engineer() {
  local t="$1" eid="$2" proj="$3"
  curl -s -o /dev/null -X DELETE "$GW/api/v1/users/$eid/projects" \
    -H "authorization: Bearer $t" -H 'content-type: application/json' \
    -d "{\"level\":\"PROJECT\",\"projectId\":\"$proj\"}" --max-time 10
  sleep 4
}

step "3. Tokens"
ADMIN=$(login admin); ENG=$(login engineer)
[ -n "$ADMIN" ] && ok "admin logged in" || { bad "admin login failed"; exit 1; }
[ -n "$ENG" ] && ok "engineer logged in" || { bad "engineer login failed"; exit 1; }

step "4. Global scope reads, unscoped user does not (fail-closed)"
PROJ0=$(psqlq project "select id from project limit 1;")
EID0=$(psqlq iam "select id from \"user\" where email='engineer@ipms.local';")
reset_engineer "$ADMIN" "$EID0" "$PROJ0"
A=$(nprojects "$ADMIN"); E=$(nprojects "$ENG")
[ "$A" -gt 0 ] 2>/dev/null && ok "admin sees $A project(s) via global grant" || bad "admin sees $A -- global grant not reaching project"
[ "$E" = "0" ] && ok "engineer with no scope sees 0 (was $A before this branch)" || bad "engineer sees $E -- NOT fail-closed"

PROJ=$(curl -s -H "authorization: Bearer $ADMIN" "$GW/api/v1/projects" --max-time 10 | jqp 'print(d[0]["id"])')
EID=$(psqlq iam "select id from \"user\" where email='engineer@ipms.local';")
printf '  (project=%s engineer=%s)\n' "${PROJ:0:8}" "${EID:0:8}"

step "5. Grant replicates over NATS into the projection"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/v1/users/$EID/projects" \
  -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d "{\"level\":\"PROJECT\",\"projectId\":\"$PROJ\"}" --max-time 10)
[ "$code" = "201" ] || [ "$code" = "200" ] && ok "grant accepted ($code)" || bad "grant returned $code"

rows=0
for _ in $(seq 1 30); do
  rows=$(psqlq project "select count(*) from user_scope where \"userId\"='$EID' and level='PROJECT';")
  [ "$rows" = "1" ] && break
  sleep 1
done
[ "$rows" = "1" ] && ok "user_scope row appeared in project's own database" \
  || bad "no user_scope row after 30s -- replication did not arrive"

step "6. The replicated grant changes what the API returns"
ENG=$(login engineer)   # re-login: the grant bumped nothing, but keep the token fresh
E2=$(nprojects "$ENG")
[ "$E2" = "1" ] && ok "engineer now sees 1 project" || bad "engineer sees $E2 after grant"

step "7. Revocation replicates too"
curl -s -o /dev/null -X DELETE "$GW/api/v1/users/$EID/projects" \
  -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d "{\"level\":\"PROJECT\",\"projectId\":\"$PROJ\"}" --max-time 10
rows=1
for _ in $(seq 1 30); do
  rows=$(psqlq project "select count(*) from user_scope where \"userId\"='$EID' and level='PROJECT';")
  [ "$rows" = "0" ] && break
  sleep 1
done
[ "$rows" = "0" ] && ok "user_scope row removed" || bad "row still present after 30s"
ENG=$(login engineer); E3=$(nprojects "$ENG")
[ "$E3" = "0" ] && ok "engineer sees 0 again" || bad "engineer still sees $E3 after revoke"

printf '\n===== %d passed, %d failed =====\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
