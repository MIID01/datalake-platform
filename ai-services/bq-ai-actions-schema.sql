-- ============================================================
-- BigQuery Table: datalake_audit.ai_actions
-- Immutable audit log of all AI agent actions.
-- NCA ECC-1:2018 compliance — no UPDATE or DELETE permitted.
-- DTLK-PROMPT-AI-001
-- Run once: bq query --use_legacy_sql=false < bq-ai-actions-schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS `datalake-production-sa.datalake_audit.ai_actions` (
  action_id         STRING    NOT NULL OPTIONS (description = 'UUID for this audit record'),
  timestamp         TIMESTAMP NOT NULL OPTIONS (description = 'When the AI action was triggered'),
  agent_name        STRING    NOT NULL OPTIONS (description = 'gatekeeper | auditor | controller'),
  action_type       STRING    NOT NULL OPTIONS (description = 'cv_parse | contract_review | timesheet_validate | compliance_check | ocr_extract | etc.'),
  triggered_by      STRING             OPTIONS (description = 'Firebase UID of the user, or scheduler'),
  input_hash        STRING    NOT NULL OPTIONS (description = 'SHA-256 of the input — raw input is NEVER stored'),
  input_type        STRING             OPTIONS (description = 'text | document | cv_pdf | contract_pdf | timesheet_json'),
  output_summary    STRING             OPTIONS (description = 'First 500 chars of AI output — sanitised, no PII'),
  output_action     STRING             OPTIONS (description = 'draft_created | risk_flagged | ocr_complete | error | auth_error'),
  model_name        STRING    NOT NULL OPTIONS (description = 'Self-hosted model identifier, e.g. qwen2.5:7b-instruct-q4_K_M'),
  model_version     STRING             OPTIONS (description = 'Model version string'),
  prompt_template_id STRING            OPTIONS (description = 'Versioned Firestore prompt template ID used for this call'),
  inference_time_ms INT64              OPTIONS (description = 'Wall-clock time in ms from request to response'),
  token_count_input INT64              OPTIONS (description = 'Input tokens consumed (from Ollama usage field)'),
  token_count_output INT64             OPTIONS (description = 'Output tokens generated'),
  confidence_score  FLOAT64            OPTIONS (description = 'Confidence score if applicable'),
  error             STRING             OPTIONS (description = 'NULL if success; error message if failed')
)
PARTITION BY DATE(timestamp)
OPTIONS (
  description = 'Immutable audit log of all Datalake AI agent actions. NCA ECC-1:2018 compliance. No UPDATE or DELETE permitted by policy.',
  require_partition_filter = false
);
