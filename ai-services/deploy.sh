#!/usr/bin/env bash
# =============================================================================
# Datalake AI Capability Deployment Script
# DTLK-PROMPT-AI-001 | Version 1.0 | 7 May 2026
# Classification: Internal — Confidential
#
# Run in order. Check Cloud Run logs after each step before proceeding.
# =============================================================================

set -e
PROJECT_ID="datalake-production-sa"
REGION="me-central2"
SA="808056940626-compute@developer.gserviceaccount.com"

echo "================================================="
echo "  Datalake AI Capability Deployment"
echo "  Project: $PROJECT_ID | Region: $REGION"
echo "================================================="

# =============================================================================
# STEP 1: Build & deploy OCR service (no GPU — CPU-only Cloud Run)
# =============================================================================
echo ""
echo "[STEP 1] Building datalake-ocr Docker image..."
gcloud builds submit ./ai-services/ocr \
  --tag "gcr.io/$PROJECT_ID/ocr:latest" \
  --project="$PROJECT_ID"

echo "[STEP 1] Deploying datalake-ocr Cloud Run service..."
gcloud run deploy datalake-ocr \
  --image="gcr.io/$PROJECT_ID/ocr:latest" \
  --region="$REGION" \
  --cpu=2 \
  --memory=4Gi \
  --min-instances=0 \
  --max-instances=2 \
  --no-allow-unauthenticated \
  --service-account="$SA" \
  --project="$PROJECT_ID"

echo "[STEP 1] Setting IAM for datalake-ocr..."
gcloud run services add-iam-policy-binding datalake-ocr \
  --region="$REGION" \
  --member="domain:datalake.sa" \
  --role="roles/run.invoker" \
  --project="$PROJECT_ID"

gcloud run services add-iam-policy-binding datalake-ocr \
  --region="$REGION" \
  --member="serviceAccount:$SA" \
  --role="roles/run.invoker" \
  --project="$PROJECT_ID"

echo "[STEP 1] DONE: datalake-ocr deployed."

# =============================================================================
# STEP 2: Build & deploy AI inference service (GPU: NVIDIA L4)
# NOTE: GPU quota must be confirmed in me-central2 before this step.
#       Check: gcloud compute regions describe me-central2 --project=$PROJECT_ID
# =============================================================================
echo ""
echo "[STEP 2] Building datalake-ai-inference Docker image..."
echo "         WARNING: This image pre-pulls Qwen 2.5 7B (~4.5GB). Build will take ~10 minutes."
gcloud builds submit ./ai-services/inference \
  --tag "gcr.io/$PROJECT_ID/ai-inference:latest" \
  --project="$PROJECT_ID" \
  --machine-type=E2_HIGHCPU_8

echo "[STEP 2] Deploying datalake-ai-inference Cloud Run service (GPU)..."
gcloud run deploy datalake-ai-inference \
  --image="gcr.io/$PROJECT_ID/ai-inference:latest" \
  --region="$REGION" \
  --gpu=1 \
  --gpu-type=nvidia-l4 \
  --cpu=4 \
  --memory=16Gi \
  --min-instances=0 \
  --max-instances=1 \
  --no-allow-unauthenticated \
  --service-account="$SA" \
  --project="$PROJECT_ID"

echo "[STEP 2] Setting IAM for datalake-ai-inference..."
gcloud run services add-iam-policy-binding datalake-ai-inference \
  --region="$REGION" \
  --member="domain:datalake.sa" \
  --role="roles/run.invoker" \
  --project="$PROJECT_ID"

gcloud run services add-iam-policy-binding datalake-ai-inference \
  --region="$REGION" \
  --member="serviceAccount:$SA" \
  --role="roles/run.invoker" \
  --project="$PROJECT_ID"

echo "[STEP 2] DONE: datalake-ai-inference deployed (GPU, min-instances=0)."

# =============================================================================
# STEP 3: Fetch the deployed service URLs and set as environment variables
#         on the Cloud Functions (via Secret Manager or direct env vars)
# =============================================================================
echo ""
echo "[STEP 3] Fetching deployed service URLs..."

AI_INFERENCE_URL=$(gcloud run services describe datalake-ai-inference \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")

OCR_URL=$(gcloud run services describe datalake-ocr \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")

echo "         AI_INFERENCE_URL: $AI_INFERENCE_URL"
echo "         OCR_URL:          $OCR_URL"

# Store URLs as secrets in Secret Manager for Cloud Functions to consume
echo "[STEP 3] Storing service URLs in Secret Manager..."

echo -n "$AI_INFERENCE_URL" | gcloud secrets create ai_inference_url \
  --data-file=- \
  --project="$PROJECT_ID" 2>/dev/null || \
echo -n "$AI_INFERENCE_URL" | gcloud secrets versions add ai_inference_url \
  --data-file=- \
  --project="$PROJECT_ID"

echo -n "$OCR_URL" | gcloud secrets create ocr_url \
  --data-file=- \
  --project="$PROJECT_ID" 2>/dev/null || \
echo -n "$OCR_URL" | gcloud secrets versions add ocr_url \
  --data-file=- \
  --project="$PROJECT_ID"

echo "[STEP 3] DONE: Service URLs stored in Secret Manager."

# =============================================================================
# STEP 4: Create BigQuery audit table
# =============================================================================
echo ""
echo "[STEP 4] Creating BigQuery datalake_audit.ai_actions table..."
bq query --use_legacy_sql=false \
  --project_id="$PROJECT_ID" \
  < ./ai-services/bq-ai-actions-schema.sql

echo "[STEP 4] DONE: BigQuery ai_actions table created."

# =============================================================================
# STEP 5: Deploy Cloud Functions (with AI env vars)
# =============================================================================
echo ""
echo "[STEP 5] Deploying Cloud Functions..."
cd functions && npm install && cd ..

firebase deploy --only functions \
  --project="$PROJECT_ID"

echo "[STEP 5] DONE: Cloud Functions deployed."

# =============================================================================
# STEP 6: Seed Firestore prompt templates
# =============================================================================
echo ""
echo "[STEP 6] Seeding AI prompt templates to Firestore..."
node functions/seed-ai-prompt-templates.js

echo "[STEP 6] DONE: Prompt templates seeded."

# =============================================================================
# STEP 7: Set Cloud Billing budget alerts ($100 and $150)
# NOTE: This must be done manually in the GCP Console:
#   Billing > Budgets & Alerts > Create Budget
#   Name: "Datalake AI Cost Ceiling"
#   Amount: $150/month
#   Alerts: 67% ($100) and 100% ($150)
#   Email: m.alqumri@datalake.sa
# =============================================================================
echo ""
echo "======================================================="
echo "  MANUAL ACTION REQUIRED: Set Billing Budget Alerts"
echo "  GCP Console > Billing > Budgets & Alerts"
echo "  Budget: \$150/month | Alerts at: \$100 and \$150"
echo "  Email CEO: m.alqumri@datalake.sa"
echo "======================================================="

# =============================================================================
# STEP 8: Verification
# =============================================================================
echo ""
echo "[STEP 8] Verification checklist:"
echo "  1. OCR service: curl -H 'Authorization: Bearer \$(gcloud auth print-identity-token)' $OCR_URL/health"
echo "  2. Inference service: Check Cloud Run logs for datalake-ai-inference"
echo "  3. BigQuery: bq show datalake-production-sa:datalake_audit.ai_actions"
echo "  4. Upload a CV through /careers and check BigQuery ai_actions for the audit entry"
echo "  5. Verify min-instances=0 on both Cloud Run services (cost control)"
echo ""
echo "==============================================================================" 
echo "  DEPLOYMENT COMPLETE — DTLK-PROMPT-AI-001"
echo "  Expected monthly cost: ~\$40-75 (well under \$150 ceiling)"
echo "  All AI inference: me-central2 (Dammam, KSA). Zero external API calls."
echo "=============================================================================="
