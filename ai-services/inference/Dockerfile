FROM ollama/ollama:latest

# Self-hosted OPEN-WEIGHT model (no external AI; stays in me-central2). Qwen 2.5 3B
# is retired — it confabulated on extraction. Default Gemma 3 4B (multimodal) — runs
# cheap on Cloud Run CPU (scale-to-zero). For an in-KSA GPU later, build with
# --build-arg MODEL=gemma3:12b. Pre-pulled at build so cold-start is spin-up only.
ARG MODEL=gemma3:4b
ENV LLM_MODEL=${MODEL}
RUN bash -c "ollama serve & sleep 10 && ollama pull ${MODEL} && pkill ollama || true"

EXPOSE 8080

# Ollama listens on 11434 by default; Cloud Run expects 8080.
ENV OLLAMA_HOST=0.0.0.0:8080

CMD ["serve"]
