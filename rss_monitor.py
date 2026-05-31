import requests
import xml.etree.ElementTree as ET
import time
import os
from datetime import datetime

def fetch_upwork_jobs(rss_url):
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(rss_url, headers=headers, timeout=15)
        if response.status_code != 200:
            print(f"[{datetime.now()}] Gagal mengambil RSS. Status: {response.status_code}")
            return []
        
        root = ET.fromstring(response.content)
        jobs = []
        for item in root.findall('.//item'):
            title = item.find('title').text
            link = item.find('link').text
            description = item.find('description').text
            pub_date = item.find('pubDate').text
            
            jobs.append({
                'title': title,
                'link': link,
                'description': description,
                'date': pub_date
            })
        return jobs
    except Exception as e:
        print(f"ERROR RSS: {e}")
        return []

def monitor_rss(rss_url, interval=60):
    print(f"[*] Memulai RSS Monitor pada: {rss_url[:50]}...")
    seen_links = set()
    
    while True:
        jobs = fetch_upwork_jobs(rss_url)
        new_jobs_found = False
        
        for job in jobs:
            if job['link'] not in seen_links:
                print("\n" + "="*50)
                print(f"🔥 JOB BARU DITEMUKAN!")
                print(f"Judul: {job['title']}")
                print(f"Tanggal: {job['date']}")
                print(f"Link: {job['link']}")
                print("="*50)
                seen_links.add(job['link'])
                new_jobs_found = True
        
        if not new_jobs_found:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Menunggu job baru...", end='\r')
            
        time.sleep(interval)

if __name__ == "__main__":
    # Nanti kita akan masukkan RSS URL di sini
    RSS_URL = os.environ.get("UPWORK_RSS_URL", "")
    if not RSS_URL:
        print("Gagal: Silakan set environment variable UPWORK_RSS_URL atau edit script ini.")
    else:
        monitor_rss(RSS_URL)
