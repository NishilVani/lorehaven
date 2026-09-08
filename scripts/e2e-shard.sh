#!/usr/bin/env bash
# Phase 12 shard driver.
#
# Why this exists: on Windows the webkit worker wedges once ONE worker process
# accumulates enough browser contexts (playwright.config.ts:55-60, phase7 A5).
# A `test.skip` inside the spec is too late — the `page` fixture has already
# built the context. `--shard=i/N` partitions at COLLECTION time and each shard
# is its own process, so the context count per process stays under the wedge
# threshold.
#
# Measured thresholds (phase 12):
#   desktop webkit  — wedges on test 38, i.e. after 37 contexts in one process
#   Mobile Safari   — wedges after ~5 contexts (phase 7 A5)
#
# The `timeout` guard matters: when the worker wedges MID-RUN, Playwright's own
# test timeout never fires (phase 7 A5 left it 8+ minutes). Only an external
# clock turns a hang into a data point instead of a stalled run.
#
# Usage: e2e-shard.sh <specfile> <project> <nshards> <tag> [per-shard-seconds]
set -u
SPEC="$1"; PROJ="$2"; N="$3"; TAG="$4"; CAP="${5:-240}"
RUN="qa/e2e-logs"
mkdir -p "$RUN"
OUT="$RUN/$TAG.txt"
: > "$OUT"
for i in $(seq 1 "$N"); do
  s=$(date +%s)
  timeout -k 10 "$CAP" npx playwright test "$SPEC" --project="$PROJ" \
    --shard="$i/$N" --reporter=list > "$RUN/$TAG-s$i.log" 2>&1
  e=$?
  el=$(( $(date +%s) - s ))
  # The 300s force-kill signature phase 1 named. Recorded per shard, never hidden.
  kill=$(grep -c "did not exit within 300000ms" "$RUN/$TAG-s$i.log")
  res=$(grep -aE "[0-9]+ (passed|failed|skipped)" "$RUN/$TAG-s$i.log" | tail -1 | tr -d '\r')
  note=""
  [ "$e" = "124" ] && note=" WEDGED(timeout ${CAP}s)"
  echo "shard $i/$N EXIT=$e ${el}s forcekill=$kill$note :: $res" >> "$OUT"
done
echo "DONE $TAG" >> "$OUT"
