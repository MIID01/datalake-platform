FROM ollama/ollama:latest

# Pre-pull the model at build time so cold-start is only instance spin-up, not model download.
# Qwen 2.5 3B Instruct Q4_K_M = ~2 GB VRAM — fast CPU inference, fits easily in 8GB RAM.
RUN bash -c 'ollama serve & sleep 10 && ollama pull qwen2.5:3b-instruct-q4_K_M && pkill ollama || true'

EXPOSE 8080

# Ollama listens on 11434 by default; Cloud Run expects 8080.
ENV OLLAMA_HOST=0.0.0.0:8080

CMD ["serve"]
