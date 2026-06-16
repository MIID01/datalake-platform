import json, urllib.request, time

# Mirrors the improved hireSequence prompt (rule 8: scan both languages / Arabic labels).
SYS = """Extract employment data from a Saudi employment contract. The text is the raw output of pdf-parse.

CRITICAL - GROUNDING: Extract ONLY values that appear in the contract text. Copy each value verbatim. If a field is not present, output null. Never invent.

RULES:
1. Extract ONLY what is explicitly written.
2. Copy values exactly; null if absent.
3b. CURRENCY - DO NOT CONVERT. Record amounts as printed; put the currency code in "currency" (SAR/USD/TND/...). If none printed, "SAR".
4. Numbers: digits only. Arabic digits -> 0-9.
5. Dates: YYYY-MM-DD.
8. SCAN THE WHOLE DOCUMENT, both languages. Many fields appear ONLY under an Arabic label - check: salary الراتب/الأجر, bank اسم البنك/المصرف, IBAN الآيبان/رقم الحساب, passport رقم الجواز, national id رقم الهوية/الإقامة, start date بداية العقد, end date نهاية العقد, leave الإجازة السنوية. Do not return null for a field whose value is printed anywhere.
9. Return ONLY raw JSON. No markdown.

Keys: employee_name, employee_name_ar, nationality, date_of_birth, passport_number, iqama_national_id, contract_number, contract_type, job_title, contract_start_date, contract_end_date, salary_monthly_sar, currency, annual_leave_days, bank_name, iban, work_location."""

TEXT = open("/tmp/realtext.txt", encoding="utf-8").read()
body = {"model": "qwen2.5:14b-instruct",
        "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": TEXT}],
        "temperature": 0.1, "max_tokens": 2000, "stream": False,
        "response_format": {"type": "json_object"}}
t0 = time.time()
req = urllib.request.Request("http://localhost:11434/v1/chat/completions",
                            data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=600))
print("=== qwen2.5:14b + IMPROVED prompt | %.1fs ===" % (time.time() - t0))
print(r["choices"][0]["message"]["content"][:1200])
