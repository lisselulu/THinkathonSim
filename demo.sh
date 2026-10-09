#!/usr/bin/env bash
# =====================================================================
# MERIDIAN — demo starter
#   bash demo.sh          start everything and warm the caches
#   bash demo.sh check    just say what is up
#   bash demo.sh kill     free the ports (pkill does not work here)
#
# Safe to run twice. It never starts a second copy of anything.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")"

FEED_PORT=7823
AGENT_PORT=8765
LLM=http://localhost:1234/v1/models

say() { printf '%-34s %s\n' "$1" "$2"; }

up() { curl -s --max-time 5 -o /dev/null "$1" 2>/dev/null; }

# Killing by name does not work on this machine — pkill leaves the
# process holding the port, which then serves stale code and produces
# the most confusing class of bug there is. Kill by port instead.
kill_port() {
  powershell -NoProfile -Command "
    Get-NetTCPConnection -LocalPort $1 -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
}

# The health probe calls the model, so a cold or busy model answers
# slowly. At 8s this reported "CANNOT decide" for a sidecar that was
# perfectly healthy -- the worst possible false alarm to see in a demo.
check() {
  up "http://127.0.0.1:$FEED_PORT/feed" && say "feed server :$FEED_PORT" "up" || say "feed server :$FEED_PORT" "DOWN"
  if curl -s --max-time 30 "http://127.0.0.1:$AGENT_PORT/health" 2>/dev/null | grep -q '"can_decide": true'; then
    say "agents sidecar :$AGENT_PORT" "up, can decide"
  elif up "http://127.0.0.1:$AGENT_PORT/health"; then
    say "agents sidecar :$AGENT_PORT" "up but CANNOT decide (check LM Studio)"
  else
    say "agents sidecar :$AGENT_PORT" "DOWN"
  fi
  up "$LLM" && say "LM Studio :1234" "up" || say "LM Studio :1234" "DOWN - start it from the Developer tab"
}

case "${1:-start}" in
  check) check; exit 0 ;;
  kill)  kill_port $FEED_PORT; kill_port $AGENT_PORT; echo "ports freed"; exit 0 ;;
esac

# ---- LM Studio is the one thing this script cannot start ------------
if ! up "$LLM"; then
  echo "LM Studio is not listening on :1234."
  echo "Start it (Developer tab, load qwen2.5-7b-instruct, start server),"
  echo "then run this again. Everything still works without it — the"
  echo "agents fall back to arithmetic and say so."
  echo
fi

# ---- the agents sidecar ---------------------------------------------
if ! up "http://127.0.0.1:$AGENT_PORT/health"; then
  echo "starting agents sidecar..."
  (python -u society/server.py --port $AGENT_PORT > society-sidecar.log 2>&1 &)
  sleep 8
fi

# ---- the feed server -------------------------------------------------
if ! up "http://127.0.0.1:$FEED_PORT/feed"; then
  echo "starting feed server..."
  (node lab/serve-console.js --port $FEED_PORT > feed-server.log 2>&1 &)
  sleep 4
fi

check

# ---- warm the caches -------------------------------------------------
# The first agents click runs ~11 rounds x 12 agents. Warmed here so it
# does not happen in front of an audience.
warm() {
  printf '%-34s ' "warming $1 (agents)"
  curl -s --max-time 600 -X POST \
    "http://127.0.0.1:$FEED_PORT/api/feed?scenario=$1&week=$2&decider=concordia&all=1" \
    -H "content-type: application/json" \
    -d '{"decider":"concordia","all":true,"shocks":{}}' \
    | python -c "import json,sys;d=json.load(sys.stdin);print(d.get('decidedBy'),len(d.get('rounds') or {}),'rounds')" \
    2>/dev/null || echo "failed"
}

if curl -s --max-time 30 "http://127.0.0.1:$AGENT_PORT/health" 2>/dev/null | grep -q '"can_decide": true'; then
  echo
  warm doom_loop_2068 5
  warm resilient_2074 4
fi

cat <<'EOF'

READY

  the feed     http://localhost:7823/feed?scenario=doom_loop_2068&week=5
  the studio   http://localhost:7823/

  press  ⚯ agents  in the header to switch from arithmetic to Concordia

EOF
