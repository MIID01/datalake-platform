#!/usr/bin/env bash
# Apply a GCS RETENTION POLICY to the WORM buckets so "WORM" is real, not name-only.
# Without this, the datalake-worm-* buckets are ordinary buckets and objects can be
# deleted — the compliance map flags this as a P1 gap.
#
#   ── RETENTION PERIOD IS A LEGAL/COMPLIANCE DECISION (CEO/counsel) ──
# Set DURATION below to the agreed period BEFORE running. Common KSA references:
#   - ZATCA e-invoicing / tax records: 6 years
#   - Labor/GOSI/HR records: commonly 7–10 years
# Leaver-record retention already referenced in code as 10y (functions/backfill.js).
#
# STEP 1 (this script, REVERSIBLE): set the retention policy.
# STEP 2 (SEPARATE, IRREVERSIBLE — run manually only when you are certain):
#   gcloud storage buckets update gs://<bucket> --lock-retention-period
#   Locking can NEVER be undone and the period can never be shortened. Do NOT
#   automate this. It is the step that makes the bucket audit-grade immutable.
#
# Prereq: gcloud auth (you are authed). Verify after with:
#   gcloud storage buckets describe gs://datalake-worm-hr --format="value(retention_policy)"

set -euo pipefail
PROJECT="datalake-production-sa"
DURATION="${WORM_RETENTION:-}"   # e.g. 10y, 7y, 6y — REQUIRED, set before running

if [ -z "$DURATION" ]; then
  echo "Refusing to run: set the retention period first, e.g.  WORM_RETENTION=10y $0" >&2
  echo "(Period is a compliance decision — confirm with CEO/counsel.)" >&2
  exit 1
fi

BUCKETS=(
  datalake-worm-hr
  datalake-worm-finance
  datalake-worm-compliance
  datalake-worm-archive
)

for b in "${BUCKETS[@]}"; do
  echo "== gs://$b =="
  gcloud storage buckets update "gs://$b" --retention-period="$DURATION" --project="$PROJECT" \
    && echo "  retention set to $DURATION (UNLOCKED — reversible)" \
    || echo "  FAILED (bucket may not exist or no permission) — check manually"
  gcloud storage buckets describe "gs://$b" --format="value(retention_policy)" --project="$PROJECT" || true
done

echo
echo "Retention SET (not locked). Review, then LOCK each bucket manually & irreversibly:"
for b in "${BUCKETS[@]}"; do echo "  gcloud storage buckets update gs://$b --lock-retention-period --project=$PROJECT"; done
