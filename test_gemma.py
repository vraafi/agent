import requests
import json

api_key = 'AIzaSyAi9-GpAF5eW_Qg3PdA_0DoaPHZG2zNiM0'
url = f'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key={api_key}'

payload = {
    'contents': [{
        'parts': [
            {'text': 'KEMBALIKAN OUTPUT DALAM FORMAT JSON BERIKUT: { "thought": "tes", "action": "CLICK", "x": 100, "y": 200 }'}
        ]
    }],
    'generationConfig': {
        'responseMimeType': 'application/json',
    }
}

try:
    print("Mengirim request ke API...")
    response = requests.post(url, json=payload, headers={'Content-Type': 'application/json'})
    if response.status_code == 200:
        data = response.json()
        print('Raw response parts:')
        print(json.dumps(data['candidates'][0]['content']['parts'], indent=2))
        
        final_text = ''
        for part in data['candidates'][0]['content']['parts']:
            if not part.get('thought'):
                final_text = part['text']
                break
                
        print('\nExtracted JSON text:', final_text)
        try:
            parsed = json.loads(final_text)
            print('\nSuccessfully parsed JSON:', parsed)
        except Exception as e:
            print('\nFailed to parse JSON:', e)
    else:
        print(f'Error API {response.status_code}: {response.text[:200]}')
except Exception as e:
    print("Fatal error:", e)
