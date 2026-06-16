#!/bin/bash
# idle-watchdog.sh — stop the GPU VM (datalake-ai-gpu) when Gemma is idle, so we
# only pay for the L4 while it's actually processing. Driven by a systemd timer
# every 3 min. "Idle" = no model loaded in Ollama (the OLLAMA_KEEP_ALIVE window
# has expired) AND GPU utilisation ~0, for several consecutive checks.
#
# A guest-initiated ACPI shutdown transitions a GCE instance to TERMINATED, which
# stops compute billing (you keep paying only for the boot disk). The Cloud
# Function wakes it again on the next request (compute.instances.start).
set -u
STATE=/var/run/gemma-idle-count
MIN_UPTIME=360   # don't kill a VM that just booted (give the first request time to land)
NEEDED=3         # consecutive idle checks before stopping (~3 timer ticks)

# Busy if a model is resident in Ollama (keep-alive not yet expired)…
if ollama ps 2>/dev/null | grep -qi gemma; then
  echo 0 > "$STATE"; exit 0
fi
# …or if the GPU is doing work (request in flight even if ps hasn't updated).
UTIL=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1)
if [ "${UTIL:-0}" -gt 5 ]; then
  echo 0 > "$STATE"; exit 0
fi

N=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
echo "$N" > "$STATE"

UP=$(awk '{print int($1)}' /proc/uptime)
if [ "$N" -ge "$NEEDED" ] && [ "$UP" -gt "$MIN_UPTIME" ]; then
  logger -t idle-watchdog "Gemma idle for $N checks (uptime ${UP}s) — stopping instance"
  /sbin/shutdown -h now
fi
