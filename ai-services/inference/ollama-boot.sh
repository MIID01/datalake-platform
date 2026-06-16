#!/bin/bash
# Persisted boot config for the Gemma inference VM. Ollama, the model, and the
# idle-watchdog timer already live on the boot disk; this just guarantees the
# systemd env (incl. the 16384 context for long bilingual contracts) every boot.
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<'CONF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=5m"
Environment="OLLAMA_CONTEXT_LENGTH=16384"
CONF
systemctl daemon-reload
systemctl restart ollama
systemctl enable --now idle-watchdog.timer 2>/dev/null || true
