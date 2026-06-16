import json, urllib.request

SYS = ("Extract employment data from a Saudi employment contract (bilingual Arabic/English). "
       "GROUNDING: Extract ONLY values present in the text; null if absent; never invent. "
       "Currency: record amounts as printed, put the code in 'currency', do NOT convert. "
       "Return ONLY raw JSON with keys: employee_name, nationality, date_of_birth, passport_number, "
       "iqama_national_id, contract_number, contract_type, job_title, contract_start_date, "
       "contract_end_date, salary_monthly_sar, currency, annual_leave_days, bank_name, iban, "
       "work_location. No markdown.")

FULL = open("/tmp/realtext.txt", encoding="utf-8").read()

def call(label, text, max_tokens, num_ctx):
    body = {"model": "gemma3:12b",
            "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": text}],
            "temperature": 0.1, "max_tokens": max_tokens, "stream": False,
            "response_format": {"type": "json_object"},
            "options": {"num_ctx": num_ctx}}
    req = urllib.request.Request("http://localhost:11434/v1/chat/completions",
                                data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=300))
    u = r.get("usage", {})
    out = r["choices"][0]["message"]["content"]
    print("=== %s | chars_in=%d | finish=%s | ptok=%s ctok=%s | out_len=%d ===" % (
        label, len(text), r["choices"][0].get("finish_reason"),
        u.get("prompt_tokens"), u.get("completion_tokens"), len(out)))
    print(out[:800]); print()

call("first 4000 chars, num_ctx 8192", FULL[:4000], 2000, 8192)
call("first 8000 chars, num_ctx 16384", FULL[:8000], 2000, 16384)
call("full 15000 chars, num_ctx 16384", FULL, 2000, 16384)
