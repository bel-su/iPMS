#!/usr/bin/env bash
#
# Brings up the whole platform locally so it can be exercised by hand.
#
# This is the *development* runner, not the deployment path — Task 22's Docker
# Compose stack is the deployment path and is still being fixed. Services run
# from TypeScript source through @swc-node/register rather than compiled
# output.
#
# SWC, specifically, and not esbuild/tsx: esbuild does not implement
# `emitDecoratorMetadata` (it never has whole-program type information), so
# under tsx every reflected NestJS constructor parameter arrives as `undefined`
# and each service either fails to boot or 500s on every guarded request. SWC
# implements it. This is the same constraint that forces the container image to
# compile with `tsc`.
#
#   ./scripts/dev-stack.sh up       start infrastructure, migrate, seed, run services
#   ./scripts/dev-stack.sh down     stop services and remove containers
#   ./scripts/dev-stack.sh logs     tail all three service logs
#   ./scripts/dev-stack.sh status   show what is up and healthy
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.dev-stack"

# Colima puts its Docker socket somewhere the docker CLI does not look by
# default, so a bare `docker` call fails with a confusing "is the daemon
# running?" even though it is.
if [ -z "${DOCKER_HOST:-}" ] && [ -S "$HOME/.colima/default/docker.sock" ]; then
  export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
fi

# Non-default host ports throughout, so this never collides with a Postgres,
# NATS or Redis the developer already runs.
PG_PORT=5433
NATS_PORT=4223
REDIS_PORT=6399
GATEWAY_PORT=3000
IAM_PORT=3001
AUDIT_PORT=3003

# Local development values. Real secrets come from the environment in every
# other context; these exist so `up` needs no arguments.
export JWT_SECRET="${JWT_SECRET:-dev-only-jwt-secret-not-for-any-deployment}"
export COOKIE_SECRET="${COOKIE_SECRET:-dev-only-cookie-secret}"
export IAM_DEMO_PASSWORD="${IAM_DEMO_PASSWORD:-P@ssw0rd1234}"
export NODE_ENV=development

export IAM_DATABASE_URL="postgresql://ipms_iam:devpass@127.0.0.1:$PG_PORT/ipms_iam"
export AUDIT_DATABASE_URL="postgresql://ipms_audit:devpass@127.0.0.1:$PG_PORT/ipms_audit"
export NATS_URL="nats://127.0.0.1:$NATS_PORT"
export REDIS_URL="redis://127.0.0.1:$REDIS_PORT"
export SWC_NODE_PROJECT="$ROOT/tsconfig.base.json"

run_service() {
  local name="$1" dir="$2" port="$3"
  ( cd "$ROOT/$dir" && PORT="$port" \
      node --import @swc-node/register/esm-register src/main.ts \
      > "$RUN_DIR/$name.log" 2>&1 & echo $! > "$RUN_DIR/$name.pid" )
}

wait_for_http() {
  local url="$1" name="$2" deadline=$((SECONDS + 60))
  until curl -fsS "$url" > /dev/null 2>&1; do
    if [ $SECONDS -gt $deadline ]; then
      echo "  ✗ $name did not become ready; last 20 log lines:" >&2
      tail -20 "$RUN_DIR/$name.log" >&2
      return 1
    fi
    sleep 1
  done
  echo "  ✓ $name ready on $url"
}

cmd_up() {
  mkdir -p "$RUN_DIR"

  echo "==> infrastructure"
  docker rm -f ipms-pg ipms-nats ipms-redis > /dev/null 2>&1 || true
  docker run -d --name ipms-pg -e POSTGRES_PASSWORD=devpass -p "$PG_PORT:5432" postgres:17-alpine > /dev/null
  docker run -d --name ipms-nats -p "$NATS_PORT:4222" nats:2.10-alpine -js > /dev/null
  docker run -d --name ipms-redis -p "$REDIS_PORT:6379" redis:7-alpine > /dev/null

  # -h forces a TCP connection. `pg_isready` over the unix socket reports ready
  # while the entrypoint's socket-only temporary server is still running its
  # init scripts, so the roles below would not exist yet.
  until docker exec ipms-pg pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do sleep 1; done
  echo "  ✓ postgres, nats, redis up"

  echo "==> databases and roles"
  # One database per service, each owned by its own role, with PUBLIC's default
  # CONNECT revoked — the isolation is enforced by grants, not by convention.
  docker exec ipms-pg psql -U postgres -q \
    -c "DO \$\$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='ipms_iam') THEN
            CREATE ROLE ipms_iam LOGIN PASSWORD 'devpass'; END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='ipms_audit') THEN
            CREATE ROLE ipms_audit LOGIN PASSWORD 'devpass'; END IF;
        END \$\$;" > /dev/null
  docker exec ipms-pg psql -U postgres -q -c "CREATE DATABASE ipms_iam OWNER ipms_iam;" > /dev/null 2>&1 || true
  docker exec ipms-pg psql -U postgres -q -c "CREATE DATABASE ipms_audit OWNER ipms_audit;" > /dev/null 2>&1 || true
  docker exec ipms-pg psql -U postgres -q \
    -c "REVOKE CONNECT ON DATABASE ipms_iam FROM PUBLIC;" \
    -c "REVOKE CONNECT ON DATABASE ipms_audit FROM PUBLIC;" > /dev/null
  echo "  ✓ ipms_iam, ipms_audit created and isolated"

  echo "==> prisma clients"
  ( cd "$ROOT/apps/iam" && DATABASE_URL="$IAM_DATABASE_URL" pnpm -s prisma generate > /dev/null )
  ( cd "$ROOT/apps/audit" && DATABASE_URL="$AUDIT_DATABASE_URL" pnpm -s prisma generate > /dev/null )
  echo "  ✓ generated"

  echo "==> migrations"
  ( cd "$ROOT/apps/iam" && DATABASE_URL="$IAM_DATABASE_URL" pnpm -s prisma migrate deploy > /dev/null )
  ( cd "$ROOT/apps/audit" && DATABASE_URL="$AUDIT_DATABASE_URL" pnpm -s prisma migrate deploy > /dev/null )
  echo "  ✓ applied"

  echo "==> seed"
  ( cd "$ROOT/apps/iam" && node --import @swc-node/register/esm-register prisma/seed.main.ts > /dev/null )
  echo "  ✓ 5 system roles, 52 permissions, 4 demo users"

  echo "==> services"
  run_service iam apps/iam "$IAM_PORT"
  run_service audit apps/audit "$AUDIT_PORT"
  wait_for_http "http://127.0.0.1:$IAM_PORT/health/ready" iam
  wait_for_http "http://127.0.0.1:$AUDIT_PORT/health/ready" audit

  # Started last: it proxies to the other two, so bringing it up first would
  # only give a window where the edge answers 502.
  IAM_HOST=127.0.0.1 AUDIT_HOST=127.0.0.1 run_service gateway apps/gateway "$GATEWAY_PORT"
  wait_for_http "http://127.0.0.1:$GATEWAY_PORT/health/ready" gateway

  cat <<EOF

Stack is up. Everything goes through the gateway on :$GATEWAY_PORT.

  Log in (any of admin / manager / qc / engineer @ipms.local, password $IAM_DEMO_PASSWORD):

    curl -s localhost:$GATEWAY_PORT/api/v1/auth/login \\
      -H 'content-type: application/json' \\
      -d '{"email":"admin@ipms.local","password":"$IAM_DEMO_PASSWORD"}'

  Then, with TOKEN set to the accessToken from that response:

    curl -s localhost:$GATEWAY_PORT/api/v1/roles -H "authorization: Bearer \$TOKEN"
    curl -s localhost:$GATEWAY_PORT/api/v1/audit/events -H "authorization: Bearer \$TOKEN"
    curl -s localhost:$GATEWAY_PORT/api/v1/audit/verify -H "authorization: Bearer \$TOKEN"

  ./scripts/dev-stack.sh logs     tail the service logs
  ./scripts/dev-stack.sh down     tear it all down
EOF
}

cmd_down() {
  for name in gateway iam audit; do
    [ -f "$RUN_DIR/$name.pid" ] && kill "$(cat "$RUN_DIR/$name.pid")" 2> /dev/null || true
    rm -f "$RUN_DIR/$name.pid"
  done
  docker rm -f ipms-pg ipms-nats ipms-redis > /dev/null 2>&1 || true
  echo "stack down"
}

cmd_logs() { tail -f "$RUN_DIR"/*.log; }

cmd_status() {
  docker ps --filter name=ipms --format '  {{.Names}}  {{.Status}}'
  for pair in "gateway $GATEWAY_PORT" "iam $IAM_PORT" "audit $AUDIT_PORT"; do
    set -- $pair
    printf '  %-8s http://127.0.0.1:%s  ready=%s\n' "$1" "$2" \
      "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$2/health/ready" || echo down)"
  done
}

case "${1:-up}" in
  up) cmd_up ;;
  down) cmd_down ;;
  logs) cmd_logs ;;
  status) cmd_status ;;
  *) echo "usage: $0 {up|down|logs|status}" >&2; exit 1 ;;
esac
