FROM python:3.11-slim

# Install system dependency for PaddlePaddle (OpenMP)
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# Install PaddleOCR and Flask dependencies
# PaddlePaddle CPU-only (no GPU needed — keeps cost minimal)
RUN pip install --no-cache-dir \
    paddlepaddle==3.0.0 \
    paddleocr==2.9.1 \
    PyMuPDF==1.25.1 \
    flask==3.0.3 \
    gunicorn==22.0.0

# Pre-download models so cold start doesn't timeout
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(lang='en'); PaddleOCR(lang='ar')"

COPY ocr_server.py /app/ocr_server.py
WORKDIR /app

EXPOSE 8080

# Use gunicorn for production — 1 worker is enough for this volume
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--timeout", "120", "ocr_server:app"]
