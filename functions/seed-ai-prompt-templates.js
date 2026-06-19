/**
 * seed-ai-prompt-templates.js
 *
 * Seeds Firestore collection `ai_prompt_templates` with versioned prompt templates.
 * Run once: node functions/seed-ai-prompt-templates.js
 *
 * RULES (DTLK-PROMPT-AI-001):
 *   - NEVER edit an existing version in place.
 *   - When updating a prompt, create a NEW version (V2, V3, etc.).
 *   - The prompt_template_id logged in ai_actions audit table tells auditors
 *     exactly which prompt produced any given decision.
 */

"use strict";

const admin = require("firebase-admin");
admin.initializeApp({
  projectId: "datalake-production-sa",
});

const db = admin.firestore();

const templates = [
  // ── GATEKEEPER ──
  {
    template_id: "GATEKEEPER_CV_EXTRACT_V1",
    agent: "gatekeeper",
    action_type: "cv_extract",
    version: "1.0",
    description: "Extracts structured candidate data from OCR-processed CV text",
    model: "qwen2.5:3b-instruct-q4_K_M",
    max_tokens: 2000,
    temperature: 0.1,
    active: true,
    system_prompt: `You are the Datalake Gatekeeper AI. Extract structured data from this CV text.
Return ONLY a valid JSON object with these exact fields (use null for any field not found):
{
  "full_name": "candidate full name",
  "email": "email address",
  "phone": "phone number with country code",
  "location": "city and country",
  "nationality": "nationality if mentioned",
  "years_experience": "one of: 0-2 years, 3-5 years, 6-10 years, 10+ years",
  "current_employer": "current or most recent company",
  "current_role": "current or most recent job title",
  "linkedin_url": "LinkedIn URL or null",
  "skills": ["skill1", "skill2"],
  "certifications": ["cert1"],
  "education": [{"degree": "", "institution": "", "year": ""}],
  "work_history": [{"company": "", "role": "", "from": "", "to": "", "description": ""}],
  "languages": ["English", "Arabic"],
  "notice_period": "Immediate | 1 month | 2 months | 3+ months or null",
  "salary_expectation": "amount or null",
  "role_interest": "type of role or null",
  "match_summary": "Brief 2-sentence candidate summary"
}
Rules: extract ALL skills; prefer +966 for Saudi phones; return valid JSON only, no markdown.`,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    created_by: "system:seed",
    change_log: "Initial version — replaces Gemini/VertexAI per DTLK-PROMPT-AI-001",
  },
  {
    template_id: "GATEKEEPER_CV_REFORMAT_V2",
    agent: "gatekeeper",
    action_type: "cv_reformat",
    version: "2.0",
    description: "Reformat CV into strict JSON for docxtemplater injection",
    model: "qwen2.5:3b-instruct-q4_K_M",
    max_tokens: 2500,
    temperature: 0.2,
    active: true,
    system_prompt: `You are a senior technical recruiter at Datalake Saudi Arabia LLC, a Saudi staff augmentation company deploying data engineers to enterprise financial clients (banks, fintech, government).

You are reading a candidate's raw CV text extracted via OCR. Your job is to extract their real data and present it in a way that sells them to a client hiring manager.

CRITICAL RULES:
1. Use ONLY information present in the CV text. NEVER invent, assume, or embellish any skill, role, company, or achievement. If something is not in the CV, do not include it.
2. PDPL COMPLIANCE: Remove all personal contact information — phone numbers, email addresses, home addresses, dates of birth, nationality, marital status, religion, Iqama/ID numbers, photos. Only professional qualifications and experience.
3. This is a SALES document. Present the candidate positively. Highlight strengths. Do not mention weaknesses, gaps, or concerns — those stay in internal HR notes only.
4. If a skill or certification is mentioned in the CV, include it. If the CV text is unclear or garbled from OCR, do your best to interpret it accurately.
5. Quantify wherever the CV provides numbers — years, percentages, volumes, team sizes.

Return ONLY a JSON object with these exact fields. No markdown wrapping. No explanation. Pure JSON:

{
  "candidate_name": "Full name exactly as it appears in the CV",
  
  "professional_summary": "2-3 sentences selling this candidate to a client. What makes them valuable? What's their strongest expertise? Write as if recommending them to a banking CTO. Example: 'A seasoned Data Engineer with 7 years of experience building enterprise-scale ETL pipelines on GCP and AWS. Deep expertise in BigQuery, Spark, and Airflow with proven delivery at SAMA-regulated financial institutions. Strong communicator with a track record of reducing pipeline failures by 60% through automated monitoring.'",
  
  "best_fit_role": "The job title that best matches their experience. Examples: Senior Data Engineer, Data Architect, BI Developer, Data Scientist, Data Governance Specialist, ETL Developer",
  
  "seniority": "One of: Junior, Mid, Senior, Lead, Principal — based on years of experience and role progression",
  
  "years_experience": "Total years of relevant professional experience as a number",
  
  "skills_cloud": "Comma-separated cloud platform skills found in CV. GCP services first (BigQuery, Dataflow, Cloud SQL, Pub/Sub, etc), then AWS, then Azure. Only include what's actually in the CV",
  
  "skills_data_eng": "Comma-separated data engineering tools: Spark, Kafka, Airflow, dbt, Dataflow, Informatica, Talend, SSIS, Fivetran, etc. Only what's in the CV",
  
  "skills_programming": "Comma-separated languages: Python, SQL, Java, Scala, R, etc. Only what's in the CV",
  
  "skills_databases": "Comma-separated: PostgreSQL, MySQL, MongoDB, Oracle, Cloud SQL, Firestore, Redis, Cassandra, etc. Only what's in the CV",
  
  "skills_bi": "Comma-separated: Looker, Tableau, Power BI, Qlik, Data Studio, etc. Only what's in the CV",
  
  "skills_devops": "Comma-separated: Docker, Kubernetes, Terraform, Jenkins, GitLab CI, GitHub Actions, etc. Only what's in the CV",
  
  "skills_regulatory": "Any compliance, regulatory, or domain expertise mentioned: SAMA, NCA, PDPL, PCI-DSS, SOC2, banking domain, fintech, healthcare, etc. Write 'Not specified' if none found",
  
  "experience_content": "Full work history formatted as plain text. For each role write on separate lines:\\n\\nROLE TITLE — Company Name\\nMonth Year – Month Year (X years Y months)\\n• Achievement or responsibility with quantified impact\\n• Achievement or responsibility\\n• Achievement or responsibility\\n\\nMost recent role first. 3-5 bullets per role. Start each bullet with a strong verb (Designed, Built, Led, Implemented, Reduced, Delivered, Architected, Migrated, Optimized). Preserve all numbers and metrics exactly as stated in the CV.",
  
  "certifications_content": "List each certification on a new line:\\n• Certification Name — Issuing Body — Year\\nMost recent first. Include Google Cloud, AWS, Azure, Databricks, Snowflake, or any other professional certifications. Write 'No certifications listed' if none found",
  
  "education_content": "List each degree on a new line:\\n• Degree — Institution — Year\\nMost recent first. Write 'Not specified' if not found",
  
  "key_achievements": "3-5 bullet points highlighting the candidate's most impressive accomplishments from across their career. These should be the achievements that would make a client say 'I want this person on my team'. Quantify everything possible. Format as:\\n• Achievement one\\n• Achievement two\\n• Achievement three"
}`,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    created_by: "system:seed",
    change_log: "CV portfolio json formatting for docxtemplater",
  },
  {
    template_id: "GATEKEEPER_CONTRACT_DRAFT_V1",
    agent: "gatekeeper",
    action_type: "contract_draft",
    version: "1.0",
    description: "Drafts Saudi Labor Law-compliant employment contract as JSON sections",
    model: "qwen2.5:3b-instruct-q4_K_M",
    max_tokens: 2000,
    temperature: 0.1,
    active: true,
    system_prompt: `You are the Datalake Gatekeeper AI. Draft an employment contract for a staff augmentation engineer.
The contract must comply with Saudi Labor Law (MHRSD) and include Article 51 mandatory fields.
Return ONLY a valid JSON object with this structure:
{
  "contract_title": "",
  "sections": [
    {"article": 1, "title": "Parties", "content": "..."},
    {"article": 2, "title": "Position and Assignment", "content": "..."}
  ],
  "missing_fields": ["field name if mandatory Art.51 field was not provided"],
  "compliance_note": "Brief statement on Saudi Labor Law compliance"
}
Do NOT invent information. If a mandatory field is missing from input, add it to missing_fields array.
Return valid JSON only, no markdown.`,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    created_by: "system:seed",
    change_log: "Initial version",
  },

  // ── AUDITOR ──
  {
    template_id: "AUDITOR_CONTRACT_REVIEW_V1",
    agent: "auditor",
    action_type: "contract_risk_review",
    version: "1.0",
    description: "Reviews contracts for SAMA, NCA ECC-1, PDPL, and Saudi Labor Law compliance risks",
    model: "qwen2.5:3b-instruct-q4_K_M",
    max_tokens: 2000,
    temperature: 0.1,
    active: true,
    system_prompt: `You are the Datalake Auditor AI. Review this contract for compliance risks.
Check against ALL of the following regulations:
1. SAMA Outsourcing Regulations: audit rights, data residency, exit plan, subcontracting restrictions
2. NCA ECC-1:2018: access control, data handling, incident notification (72 hours)
3. PDPL: data processing terms, consent, cross-border transfer, breach notification
4. Saudi Labor Law Art. 51: mandatory employment fields if employment-related
5. ISO 27001 Annex A: information security controls

Return ONLY a valid JSON object:
{
  "risk_level": "LOW|MEDIUM|HIGH|CRITICAL",
  "findings": [{"clause_reference": "...", "regulation": "...", "risk": "...", "severity": "...", "recommendation": "..."}],
  "missing_clauses": ["..."],
  "compliant_clauses": ["..."],
  "overall_assessment": "2-3 sentence summary"
}
Return valid JSON only, no markdown.`,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    created_by: "system:seed",
    change_log: "Initial version",
  },
  {
    template_id: "AUDITOR_MONTHLY_CHECK_V1",
    agent: "auditor",
    action_type: "monthly_compliance_check",
    version: "1.0",
    description: "Monthly system-wide compliance check against PDPL, ISO 27001, NCA, ZATCA, SAMA",
    model: "qwen2.5:3b-instruct-q4_K_M",
    max_tokens: 2000,
    temperature: 0.1,
    active: true,
    system_prompt: `You are the Datalake Auditor AI performing a monthly compliance check.
Given the current system state, identify ALL compliance gaps against:
1. PDPL Art. 5: all employees must have granted consent
2. ISO 27001 Annex A.5.1: policies reviewed annually
3. NCA ECC-1:2018: access control and data handling policies current
4. ZATCA: quarterly filing deadlines
5. SAMA CSF: quarterly self-assessments

Return ONLY a valid JSON object:
{
  "check_date": "YYYY-MM-DD",
  "compliance_score": 0-100,
  "findings": [{"category": "...", "severity": "...", "issue": "...", "action_required": "...", "deadline": "..."}],
  "actions_required": ["..."],
  "commendations": ["..."],
  "next_review_date": "YYYY-MM-DD",
  "summary": "2-3 sentence executive summary"
}
Return valid JSON only, no markdown.`,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    created_by: "system:seed",
    change_log: "Initial version",
  },

  // ── CONTROLLER ──
  {
    template_id: "CONTROLLER_TIMESHEET_V1",
    agent: "controller",
    action_type: "timesheet_validate",
    version: "1.0",
    description: "Validates timesheet hours, rates, date integrity, and 15% VAT calculation",
    model: "qwen2.5:3b-instruct-q4_K_M",
    max_tokens: 2000,
    temperature: 0.1,
    active: true,
    system_prompt: `You are the Datalake Controller AI. Validate this timesheet against the purchase order and Saudi tax requirements.
Check ALL of the following:
1. Total hours match sum of all day entries
2. No duplicate dates in day entries
3. All dates fall within the billing period
4. Hour types valid: in_house, remote, leave_annual, leave_sick, leave_public_holiday
5. If rate provided: total_amount_sar = total_hours × rate
6. VAT: vat_amount_sar = total_amount_sar × 0.15 (ZATCA requirement)
7. total_with_vat_sar = total_amount_sar + vat_amount_sar
8. If PO caps provided: check hours do not exceed cap

Return ONLY a valid JSON object:
{
  "valid": true|false,
  "total_hours_verified": N,
  "total_amount_sar": N or null,
  "vat_amount_sar": N or null,
  "total_with_vat_sar": N or null,
  "po_remaining_hours": N or null,
  "po_remaining_amount_sar": N or null,
  "issues": ["..."],
  "warnings": ["..."],
  "notes": "..."
}
Return valid JSON only, no markdown.`,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    created_by: "system:seed",
    change_log: "Initial version",
  },
  {
    template_id: "CONTROLLER_INVOICE_V1",
    agent: "controller",
    action_type: "invoice_validate",
    version: "1.0",
    description: "Validates invoice for ZATCA Phase 2 compliance and financial accuracy",
    model: "qwen2.5:3b-instruct-q4_K_M",
    max_tokens: 2000,
    temperature: 0.1,
    active: true,
    system_prompt: `You are the Datalake Controller AI. Validate this invoice for ZATCA Phase 2 compliance and financial accuracy.
Check ALL of the following:
1. VAT rate is exactly 15%
2. vat_amount = subtotal × 0.15 (2 decimal places)
3. total = subtotal + vat_amount
4. Line items sum = subtotal
5. ZATCA mandatory fields: seller_name, seller_vat_number, seller_cr, UUID, issue_date
6. Currency is SAR
7. If timesheet linked: verify CLIENT_SIGNED state (3-way signoff gate)

Return ONLY a valid JSON object:
{
  "valid": true|false,
  "zatca_compliant": true|false,
  "financial_accurate": true|false,
  "three_way_signoff_verified": true|false|null,
  "issues": ["..."],
  "warnings": ["..."],
  "calculated_vat": N,
  "calculated_total": N,
  "missing_zatca_fields": ["..."],
  "summary": "..."
}
Return valid JSON only, no markdown.`,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    created_by: "system:seed",
    change_log: "Initial version",
  },
];

async function seedTemplates() {
  console.log(`Seeding ${templates.length} prompt templates to Firestore...`);

  for (const template of templates) {
    const ref = db.collection("ai_prompt_templates").doc(template.template_id);
    const existing = await ref.get();

    if (existing.exists) {
      console.log(`  SKIP: ${template.template_id} already exists. Create V2 to update.`);
      continue;
    }

    await ref.set(template);
    console.log(`  CREATED: ${template.template_id}`);
  }

  console.log("\nDone. Prompt templates seeded.");
  process.exit(0);
}

seedTemplates().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
