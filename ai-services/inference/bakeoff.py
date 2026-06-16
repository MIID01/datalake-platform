import json, urllib.request, time

SYS = ("Extract employment data from a Saudi employment contract (bilingual Arabic/English). "
       "GROUNDING: Extract ONLY values present in the text; null if absent; never invent. "
       "Currency: record amounts as printed, put the code in 'currency', do NOT convert. "
       "Return ONLY raw JSON with keys: employee_name, employee_name_ar, nationality, "
       "date_of_birth, passport_number, contract_number, contract_type, job_title, "
       "contract_start_date, contract_end_date, salary_monthly_sar, currency, annual_leave_days, "
       "bank_name, iban, work_location. No markdown.")

TEXT = open("/tmp/realtext.txt", encoding="utf-8").read()

def run(model):
    sys_prompt = SYS
    if model.startswith("qwen3"):
        sys_prompt = "/no_think\n" + SYS  # disable Qwen 3 thinking for clean JSON
    body = {"model": model,
            "messages": [{"role": "system", "content": sys_prompt}, {"role": "user", "content": TEXT}],
            "temperature": 0.1, "max_tokens": 2000, "stream": False,
            "response_format": {"type": "json_object"}}
    t0 = time.time()
    req = urllib.request.Request("http://localhost:11434/v1/chat/completions",
                                data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=600))
    dt = time.time() - t0
    out = r["choices"][0]["message"]["content"]
    u = r.get("usage", {})
    print("\n########## %s | %.1fs | finish=%s | ptok=%s ctok=%s ##########" % (
        model, dt, r["choices"][0].get("finish_reason"), u.get("prompt_tokens"), u.get("completion_tokens")))
    print(out[:1200])

for m in ["gemma3:12b", "qwen2.5:14b-instruct", "qwen3:14b"]:
    try:
        urllib.request.urlopen(urllib.request.Request(
            "http://localhost:11434/api/generate",
            data=json.dumps({"model": m, "prompt": "hi", "stream": False}).encode(),
            headers={"Content-Type": "application/json"}), timeout=300).read()
        run(m)
    except Exception as e:
        print("\n########## %s FAILED: %s ##########" % (m, str(e)[:200]))
