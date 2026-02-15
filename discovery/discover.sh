#!/bin/bash
# Raise open-files limit as high as possible so tsx + Stagehand don't hit EMFILE
ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || ulimit -n 4096 2>/dev/null || true
echo "Open files limit: $(ulimit -n)"
exec npx tsx src/run-discovery.ts "$@"
