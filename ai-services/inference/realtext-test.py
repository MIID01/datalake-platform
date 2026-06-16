import json, urllib.request

SYS = ("Extract employment data from a Saudi employment contract. The text is the raw output of "
       "pdf-parse (bilingual Arabic/English).\n\nCRITICAL - GROUNDING: Extract ONLY values that "
       "appear in the contract text. If a field is not present, output null. Never invent values. "
       "Currency: record amounts as printed and put the currency code in 'currency'; do NOT convert.\n\n"
       "Return ONLY raw JSON with these keys: employee_name, employee_name_ar, nationality, "
       "date_of_birth, passport_number, iqama_national_id, contract_number, contract_type, job_title, "
       "contract_start_date, contract_end_date, salary_monthly_sar, housing_allowance_sar, "
       "transport_allowance_sar, currency, annual_leave_days, bank_name, iban, work_location. "
       "No markdown.")

TEXT = open("/tmp/realtext.txt", encoding="utf-8").read()

PROPS = {k: {"type": ["string", "null"]} for k in [
 "employee_name","employee_name_ar","nationality","date_of_birth","passport_number",
 "iqama_national_id","contract_number","contract_type","job_title","contract_start_date",
 "contract_end_date","currency","bank_name","iban","work_location"]}
for k in ["salary_monthly_sar","housing_allowance_sar","transport_allowance_sar","annual_leave_days"]:
    PROPS[k] = {"type": ["number", "null"]}
SCHEMA = {"type": "object", "properties": PROPS, "additionalProperties": False}

def call(label, rf):
    body = {"model": "gemma3:12b",
            "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": TEXT}],
            "temperature": 0.1, "max_tokens": 2000, "stream": False}
    if rf:
        body["response_format"] = rf
    req = urllib.request.Request("http://localhost:11434/v1/chat/completions",
                                data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=300))
    out = r["choices"][0]["message"]["content"]
    print("=== %s | finish=%s | len=%d ===" % (label, r["choices"][0].get("finish_reason"), len(out)))
    print(out[:900]); print()

print("input chars:", len(TEXT))
call("A: json_schema (current function behavior)", {"type": "json_schema", "json_schema": {"name": "x", "schema": SCHEMA}})
call("B: json_object (proposed fix)", {"type": "json_object"})
