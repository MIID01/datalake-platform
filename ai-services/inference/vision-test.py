import json, base64, io, urllib.request
from PIL import Image, ImageDraw

# Build a tiny synthetic "CV" image with text (self-test fixture; never stored).
img = Image.new("RGB", (640, 220), "white")
d = ImageDraw.Draw(img)
lines = [
    "CURRICULUM VITAE",
    "Name: Sarah Ahmed Al-Otaibi",
    "Email: sarah.alotaibi@example.com",
    "Phone: +966 50 123 4567",
    "Current Role: Data Engineer at Aramco",
    "Skills: Python, SQL, Spark, Airflow",
]
y = 12
for ln in lines:
    d.text((14, y), ln, fill="black")
    y += 32
buf = io.BytesIO(); img.save(buf, format="PNG")
b64 = base64.b64encode(buf.getvalue()).decode()

sys_prompt = ("Extract structured data from this CV image. GROUNDING: only what is "
              "present; null if absent. Return JSON: {\"full_name\":null,\"email\":null,"
              "\"phone\":null,\"current_role\":null,\"current_employer\":null,\"skills\":[]}")
body = {"model": "gemma3:12b",
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": [
                {"type": "text", "text": "Read this CV image and extract the data as JSON."},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + b64}},
            ]},
        ],
        "temperature": 0.1, "max_tokens": 600, "stream": False,
        "response_format": {"type": "json_object"}}
req = urllib.request.Request("http://localhost:11434/v1/chat/completions",
                            data=json.dumps(body).encode(),
                            headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=300))
print("=== VISION OUTPUT ===")
print(r["choices"][0]["message"]["content"])
