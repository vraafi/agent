import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11) if os.environ.get(f"GEMINI_KEY_{i}")]
if not api_keys and os.environ.get("GEMINI_API_KEY"):
    api_keys = [os.environ.get("GEMINI_API_KEY")]

model_url = "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent"

print(f"Menguji {len(api_keys)} API keys untuk model gemma-4-26b-a4b-it...")

for i, key in enumerate(api_keys):
    url = f"{model_url}?key={key}"
    data = {
        "contents": [{"role": "user", "parts": [{"text": "Hello, ini test."}]}]
    }
    
    try:
        response = requests.post(url, headers={"Content-Type": "application/json"}, json=data, timeout=10)
        print(f"Key {i+1}: Status {response.status_code}")
        if response.status_code != 200:
            print(f"  Error Detail: {response.text[:150]}")
    except requests.exceptions.Timeout:
        print(f"Key {i+1}: TIMEOUT (Gagal terhubung dalam 10 detik)")
    except Exception as e:
        print(f"Key {i+1}: ERROR {e}")
