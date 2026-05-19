"""
OCR Server — Datalake AI Capability
Service: datalake-ocr (Cloud Run, CPU-only, no GPU)
Handles: Arabic + English document extraction for CV parsing,
         contract review, timesheet reading, passport/document extraction.
License: Apache 2.0 (PaddleOCR)
DTLK-PROMPT-AI-001
"""

import base64
import os
import tempfile
import logging
from flask import Flask, request, jsonify
from paddleocr import PaddleOCR

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Initialise both language engines at startup (avoids per-request init overhead)
# These are lazy-loaded by PaddleOCR on first call
logger.info("Initialising PaddleOCR English engine...")
ocr_en = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)

logger.info("Initialising PaddleOCR Arabic engine...")
ocr_ar = PaddleOCR(use_angle_cls=True, lang="ar", show_log=False)

logger.info("OCR server ready.")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "datalake-ocr"})


@app.route("/extract", methods=["POST"])
def extract():
    """
    Accepts JSON body:
    {
      "file_base64": "<base64-encoded PDF or image>",
      "lang": "en" | "ar"   (default: "en")
    }

    Returns:
    {
      "lines": [{"text": "...", "confidence": 0.99, "bbox": [[x,y],...]}],
      "page_count": N
    }
    """
    try:
        data = request.get_json(force=True)
        if not data or "file_base64" not in data:
            return jsonify({"error": "Missing file_base64 in request body"}), 400

        file_bytes = base64.b64decode(data["file_base64"])
        lang = data.get("lang", "en").lower()

        # Write to temp file — PaddleOCR requires a file path
        suffix = ".pdf" if file_bytes[:4] == b"%PDF" else ".png"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(file_bytes)
            tmp_path = f.name

        try:
            engine = ocr_ar if lang == "ar" else ocr_en
            result = engine.ocr(tmp_path, cls=True)
        finally:
            os.unlink(tmp_path)

        if result is None:
            return jsonify({"lines": [], "page_count": 0})

        extracted = []
        for page in result:
            if page is None:
                continue
            for line in page:
                # line format: [[bbox_points], [text, confidence]]
                extracted.append({
                    "text": line[1][0],
                    "confidence": float(line[1][1]),
                    "bbox": line[0],
                })

        logger.info(f"OCR complete: {len(extracted)} lines from {len(result)} page(s), lang={lang}")

        return jsonify({
            "lines": extracted,
            "page_count": len(result),
        })

    except base64.binascii.Error:
        return jsonify({"error": "Invalid base64 encoding"}), 400
    except Exception as e:
        logger.error(f"OCR extraction failed: {e}", exc_info=True)
        return jsonify({"error": "OCR extraction failed", "detail": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
