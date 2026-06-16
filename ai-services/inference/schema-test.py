import json, urllib.request

SYS = ("Extract employment data from a Saudi employment contract. The text is the raw output of "
       "pdf-parse.\n\nCRITICAL - GROUNDING: Extract ONLY values that appear in the contract text. "
       "If a field is not present, output null. Never invent values.\n\n"
       "Return ONLY raw JSON. No markdown.")

CONTRACT = """EMPLOYMENT CONTRACT
This Employment Contract is entered into under the Saudi Labor Law.
Employee Name: Mohamed Dahas
Nationality: Egyptian
Passport Number: A12345678
Job Title: Senior Data Engineer
Contract Type: Fixed Term
Contract Start Date: 2024-03-01
Contract End Date: 2026-02-28
Monthly Basic Salary: SAR 18,000
Housing Allowance: SAR 4,500
Transport Allowance: SAR 1,200
Annual Leave: 30 days
Probation Period: 90 days
Notice Period: 60 days
Bank Name: Al Rajhi Bank
IBAN: SA0380000000608010167519
Work Location: Riyadh, Kingdom of Saudi Arabia
"""

PROPS = {k: {"type": t} for k, t in {
 "employee_name": ["string","null"], "employee_name_ar": ["string","null"], "nationality": ["string","null"],
 "date_of_birth": ["string","null"], "marital_status": ["string","null"], "education_level": ["string","null"],
 "passport_number": ["string","null"], "iqama_national_id": ["string","null"], "contract_number": ["string","null"],
 "contract_type": ["string","null"], "auto_renewal": ["boolean","null"], "auto_renewal_notice_days": ["number","null"],
 "job_title": ["string","null"], "client_name": ["string","null"], "po_number": ["string","null"],
 "po_value_sar": ["number","null"], "contract_start_date": ["string","null"], "contract_end_date": ["string","null"],
 "salary_monthly_sar": ["number","null"], "housing_allowance_sar": ["number","null"],
 "transport_allowance_sar": ["number","null"], "currency": ["string","null"], "probation_period_months": ["number","null"],
 "notice_period_days": ["number","null"], "annual_leave_days": ["number","null"], "working_hours_per_day": ["number","null"],
 "working_days_per_week": ["number","null"], "weekly_rest_day": ["string","null"], "non_compete_years": ["number","null"],
 "confidentiality_years": ["number","null"], "bank_name": ["string","null"], "iban": ["string","null"],
 "work_location": ["string","null"],
}.items()}
SCHEMA = {"type": "object", "properties": PROPS,
          "required": ["employee_name","employee_name_ar","job_title","contract_start_date","contract_end_date",
                       "salary_monthly_sar","housing_allowance_sar","transport_allowance_sar","nationality",
                       "iban","bank_name","annual_leave_days","contract_type","iqama_national_id",
                       "passport_number","date_of_birth"],
          "additionalProperties": False}

def call(label, response_format):
    body = {"model": "gemma3:12b",
            "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": CONTRACT}],
            "temperature": 0.1, "max_tokens": 2000, "stream": False}
    if response_format:
        body["response_format"] = response_format
    req = urllib.request.Request("http://localhost:11434/v1/chat/completions",
                                data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=300))
    out = r["choices"][0]["message"]["content"]
    fr = r["choices"][0].get("finish_reason")
    print("=== %s (finish=%s, len=%d) ===" % (label, fr, len(out)))
    print(out[:700])
    print()

call("A: full json_schema (what the function sends)",
     {"type": "json_schema", "json_schema": {"name": "extraction", "schema": SCHEMA}})
call("B: json_object only (no schema)", {"type": "json_object"})
