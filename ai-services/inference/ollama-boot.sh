#!/bin/bash
# Persisted boot config for the Gemma inference VM (set as instance
# startup-script metadata). override.conf lives on the boot disk, so systemd
# already starts Ollama with the right env (incl. the 16384 context) at boot.
#
# We DO NOT restart Ollama here: a restart races the Cloud Function's
# wake-and-connect — the function polls /api/version, sees Ollama up, sends the
# request, and a restart at that moment drops it as a "socket hang up". We only
# re-assert the file (idempotent) and make sure the idle watchdog is enabled.
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<'CONF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=5m"
Environment="OLLAMA_CONTEXT_LENGTH=16384"
CONF
systemctl daemon-reload
systemctl enable --now idle-watchdog.timer 2>/dev/null || true
