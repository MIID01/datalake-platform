import json, base64, urllib.request, time

def img(p):
    return {"type": "image_url", "image_url": {
        "url": "data:image/png;base64," + base64.b64encode(open(p, "rb").read()).decode()}}
SYS = ("Read this Saudi employment contract (bilingual Arabic/English) and extract data. "
       "GROUNDING: only what is visibly present; null if absent; never invent. "
       "Read Arabic in its correct right-to-left order. "
       "Return ONLY JSON: {\"employee_name\":null,\"employee_name_ar\":null,\"nationality\":null,"
       "\"passport_number\":null,\"job_title\":null,\"job_title_ar\":null}")
body = {"model": "gemma3:12b",
        "messages": [{"role": "system", "content": SYS},
                     {"role": "user", "content": [
                         {"type": "text", "text": "Extract the data as JSON. Get the Arabic name right."},
                         img("/tmp/contract-p1.png"), img("/tmp/contract-p2.png")]}],
        "temperature": 0.1, "max_tokens": 500, "stream": False,
        "response_format": {"type": "json_object"}}
t0 = time.time()
req = urllib.request.Request("http://localhost:11434/v1/chat/completions",
                            data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=300))
print("=== GEMMA VISION on contract page 1 | %.1fs ===" % (time.time() - t0))
print(r["choices"][0]["message"]["content"])
print("\n(reference: pdf-parse gave REVERSED 'عليات بن مروان'; correct doc order is 'مروان بن عليات')")
