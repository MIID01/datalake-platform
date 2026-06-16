import json, urllib.request

sys_prompt = (
 "Extract employment data from a Saudi employment contract. "
 "The text is the raw output of pdf-parse.\n\n"
 "CRITICAL - GROUNDING: Extract ONLY values that appear in the contract text. "
 "Copy each value verbatim. If a field is not present in the text, output null. "
 "Never invent, guess, or substitute sample/placeholder values - no John Doe, "
 "no example passport numbers, no made-up banks or IBANs.\n\n"
 "RULES:\n"
 "1. Extract ONLY what is explicitly written. If not present, use null.\n"
 "2. Numbers: digits only. Dates: YYYY-MM-DD. Return ONLY raw JSON."
)
# Contract text with NO name, NO passport, NO IBAN, NO nationality - only numbers.
contract = (
 "EMPLOYMENT CONTRACT\n"
 "This agreement is made under the Saudi Labor Law.\n"
 "The monthly basic salary is SAR 12000. Housing allowance: SAR 3000.\n"
 "The annual leave entitlement is 30 days. Probation period is 90 days.\n"
 "Work location: Riyadh."
)
schema = {"type": "object", "properties": {
 "employee_name": {"type": ["string", "null"]},
 "nationality": {"type": ["string", "null"]},
 "passport_number": {"type": ["string", "null"]},
 "iban": {"type": ["string", "null"]},
 "bank_name": {"type": ["string", "null"]},
 "salary_monthly_sar": {"type": ["number", "null"]},
 "housing_allowance_sar": {"type": ["number", "null"]},
 "annual_leave_days": {"type": ["number", "null"]},
 "work_location": {"type": ["string", "null"]}},
 "required": ["employee_name", "nationality", "passport_number", "iban",
              "salary_monthly_sar", "housing_allowance_sar", "annual_leave_days", "work_location"],
 "additionalProperties": False}
body = {"model": "gemma3:12b",
        "messages": [{"role": "system", "content": sys_prompt},
                     {"role": "user", "content": contract}],
        "temperature": 0.1, "max_tokens": 2000, "stream": False,
        "response_format": {"type": "json_schema",
                            "json_schema": {"name": "extraction", "schema": schema}}}
req = urllib.request.Request("http://localhost:11434/v1/chat/completions",
                            data=json.dumps(body).encode(),
                            headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=300))
print("=== MODEL OUTPUT ===")
print(r["choices"][0]["message"]["content"])
