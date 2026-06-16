FROM ollama/ollama:latest

# Self-hosted OPEN-WEIGHT model (no external AI; stays in me-central2). Qwen 2.5 3B
# is retired — it confabulated on extraction. Default Gemma 3 12B (run on a GPU for
# usable speed); for a CPU-only deploy build with --build-arg MODEL=gemma3:4b.
# Pre-pulled at build time so cold-start is instance spin-up, not a model download.
ARG MODEL=gemma3:12b
ENV LLM_MODEL=${MODEL}
RUN bash -c "ollama serve & sleep 10 && ollama pull ${MODEL} && pkill ollama || true"

EXPOSE 8080

# Ollama listens on 11434 by default; Cloud Run expects 8080.
ENV OLLAMA_HOST=0.0.0.0:8080

CMD ["serve"]
