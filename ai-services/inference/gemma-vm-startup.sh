#!/bin/bash
# Startup for the in-KSA GPU inference VM (datalake-ai-gpu, me-central2-c).
# Deep Learning image installs the NVIDIA L4 driver; we add Ollama + Gemma 3 12B
# (multimodal: OCR + extraction + mapping in one model) and an idle watchdog that
# stops the instance when nobody is processing, so we only pay for the GPU in use.
# Ollama listens on the INTERNAL interface only; reachable from the Cloud Functions
# via Direct VPC egress (no public 11434 ingress rule).
set -e
exec > /var/log/gemma-startup.log 2>&1

echo "[startup] installing Ollama…"
curl -fsSL https://ollama.com/install.sh | sh

mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=5m"
EOF

# Idle watchdog — stop the VM when Gemma has been idle (cost control).
cp "$(dirname "$0")/idle-watchdog.sh" /usr/local/bin/idle-watchdog.sh 2>/dev/null || \
  curl -fsSL "https://raw.githubusercontent.com/REPLACE/idle-watchdog.sh" -o /usr/local/bin/idle-watchdog.sh
chmod +x /usr/local/bin/idle-watchdog.sh
# (idle-watchdog.service / .timer are installed alongside; see this directory.)

systemctl daemon-reload
systemctl enable ollama
systemctl restart ollama
sleep 10

echo "[startup] pulling gemma3:12b (multimodal — OCR + extraction + mapping)…"
# Run as the login user so $HOME resolves (a bare root pull panics in envconfig).
HOME=/root ollama pull gemma3:12b

systemctl enable --now idle-watchdog.timer 2>/dev/null || true

echo "[startup] done. nvidia-smi:"
nvidia-smi || echo "(driver still installing; reboot may be needed)"
