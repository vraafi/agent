# HermesMoneyAgent — Konfigurasi Tambahan

Dokumen ini berisi instruksi tambahan untuk **HermesMoneyAgent**, mencakup:
1. Cara menggunakan **Claude Sonnet 4.5 free unlimited** via 9Router (Kiro AI)
2. Cara membuka **CloakBrowser** di komputer lokal agar sesi browser tetap hidup
3. **Aturan keamanan** yang wajib dipatuhi agent

---

## 1. Menggunakan Claude Sonnet 4.5 Free Unlimited via 9Router

### Tentang 9Router

[9Router](https://github.com/decolua/9router) adalah proyek **#1 trending di GitHub** (13.600+ bintang) yang berfungsi sebagai proxy AI lokal dengan antarmuka kompatibel OpenAI. Salah satu providernya — **Kiro AI** — menyediakan akses **Claude Sonnet 4.5 gratis dan tanpa batas** (no signup required).

```
┌─────────────────────┐
│   Hermes Agent      │  ← AI reasoning engine
└──────┬──────────────┘
       │ http://127.0.0.1:8080/v1
       ▼
┌─────────────────────────────────────────────┐
│   9Router (port 8080)                        │
│   • RTK Token Saver (hemat 20-40% token)    │
│   • Auto-fallback antar provider            │
│   • Kiro AI → Claude Sonnet 4.5 (FREE)      │
└─────────────────────────────────────────────┘
```

### Cara Aktifkan Provider Kiro di 9Router

1. Jalankan 9Router: `cd 9router && npm run dev`
2. Buka Dashboard: `http://localhost:8080/dashboard`
3. Masuk ke **Providers → Add Provider → Kiro AI**
4. Kiro tidak memerlukan API Key — langsung connect
5. Model yang digunakan: `kr/claude-sonnet-4.5`

### Perubahan di `src/start.js`

Ubah bagian konfigurasi Hermes Agent dari Gemini ke Claude Sonnet 4.5:

```js
// SEBELUMNYA (Gemini):
const hermesConfig = `
model:
  default: "google/gemini-1.5-pro"
  provider: "custom"
  base_url: "http://127.0.0.1:8080/v1"
`;

// SESUDAHNYA (Claude Sonnet 4.5 via Kiro - FREE):
const hermesConfig = `
model:
  default: "kr/claude-sonnet-4.5"
  provider: "custom"
  base_url: "http://127.0.0.1:8080/v1"
`;
```

### Contoh Request Manual (Testing)

```bash
# Verifikasi 9Router berjalan
curl http://localhost:8080/api/health

# Cek model tersedia (cari "kr/claude-sonnet-4.5")
curl http://localhost:8080/v1/models

# Test chat ke Claude Sonnet 4.5 via Kiro
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kr/claude-sonnet-4.5",
    "messages": [{"role": "user", "content": "Halo Hermes!"}]
  }'
```

### Catatan Model Kiro

| Model ID | Keterangan |
|---|---|
| `kr/claude-sonnet-4.5` | Claude Sonnet 4.5 — FREE unlimited via Kiro AI |
| `kr/claude-opus-4-5` | Claude Opus 4.5 — FREE via Kiro (jika tersedia) |

> Untuk melihat semua model Kiro yang tersedia: `curl http://localhost:8080/v1/models | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); JSON.parse(d).data.filter(m=>m.id.startsWith('kr/')).forEach(m=>console.log(m.id))"`

---

## 2. Cara Membuka CloakBrowser (Proses Belakang Layar)

CloakBrowser adalah Chrome yang dimodifikasi dengan teknik penyamaran tingkat tinggi agar **tidak terdeteksi sebagai bot/otomasi** oleh website. Untuk memastikan browser tetap berjalan setelah script Python selesai, digunakan metode **detasemen proses via PowerShell CIM**.

### Lokasi & Konfigurasi

```
Executable : C:\Users\user\.antigravity\Nexus-DualBrain-AI\bin\cloak\chrome.exe
Profil     : bin\cloak_profile
Debug Port : 9223
```

### Script: `launch_stable_linkedin.py`

Simpan file ini di root folder proyek (`C:\Users\user\.antigravity\Nexus-DualBrain-AI\`):

```python
"""
launch_stable_linkedin.py
Membuka CloakBrowser secara stabil sebagai proses mandiri (terpisah dari terminal Python).
Browser tetap hidup setelah script selesai dieksekusi.
"""
import socket
import subprocess
import os
import time

# ── KONFIGURASI ─────────────────────────────────────────────
CHROME_PATH  = r"C:\Users\user\.antigravity\Nexus-DualBrain-AI\bin\cloak\chrome.exe"
PROFILE_DIR  = r"bin\cloak_profile"
DEBUG_PORT   = 9223
# ─────────────────────────────────────────────────────────────

def is_port_active(port: int = DEBUG_PORT) -> bool:
    """Langkah 1 — Cek apakah port remote debugging sudah aktif."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", port)) == 0


def kill_cloak_processes() -> None:
    """Langkah 2a — Bunuh proses Chrome yang menggantung."""
    subprocess.run(
        ["taskkill", "/F", "/IM", "chrome.exe"],
        capture_output=True
    )
    time.sleep(1)


def clear_lock_files() -> None:
    """Langkah 2b — Hapus file LOCK/SingletonLock agar Chrome tidak loop error."""
    lock_files = ["LOCK", "SingletonLock", "SingletonCookie", "SingletonSocket"]
    for lock_file in lock_files:
        path = os.path.join(PROFILE_DIR, lock_file)
        if os.path.exists(path):
            try:
                os.remove(path)
                print(f"[CLEAN] Dihapus: {path}")
            except Exception as e:
                print(f"[WARN] Gagal hapus {path}: {e}")


def launch_cloak_detached() -> None:
    """
    Langkah 3 & 4 — Susun parameter stealth dan detach via PowerShell CIM.
    Invoke-CimMethod meluncurkan browser sebagai proses Windows mandiri,
    terpisah dari terminal Python, sehingga tetap hidup setelah script selesai.
    """
    # Langkah 3: Parameter stealth — menyembunyikan tanda otomasi
    command = (
        f'"{CHROME_PATH}" '
        f'--user-data-dir="{PROFILE_DIR}" '
        f'--remote-debugging-port={DEBUG_PORT} '
        f'--disable-blink-features=AutomationControlled '
        f'--no-sandbox '
        f'--start-maximized'
    )

    # Langkah 4: Detasemen via CIM (proses mandiri, bukan child process Python)
    ps_command = (
        f"Invoke-CimMethod -ClassName Win32_Process "
        f"-MethodName Create "
        f"-Arguments @{{CommandLine='{command}'}}"
    )

    result = subprocess.run(
        ["powershell", "-Command", ps_command],
        capture_output=True,
        text=True
    )

    if result.returncode == 0:
        print("[LAUNCH] CloakBrowser diluncurkan sebagai proses mandiri.")
    else:
        print(f"[ERROR] PowerShell gagal: {result.stderr}")


def main() -> None:
    print("=" * 50)
    print("  CloakBrowser Launcher (Stable / Detached)")
    print("=" * 50)

    # Langkah 1: Cek port — jangan restart jika sudah aktif
    if is_port_active():
        print(f"[OK] Port {DEBUG_PORT} aktif — browser sudah berjalan, skip launch.")
        print(f"[OK] CDP tersedia di: http://127.0.0.1:{DEBUG_PORT}")
        return

    print(f"[INFO] Port {DEBUG_PORT} tidak aktif, memulai proses launch ulang...")

    # Langkah 2: Bersihkan proses dan lock files
    kill_cloak_processes()
    clear_lock_files()

    # Langkah 3 & 4: Launch CloakBrowser sebagai proses mandiri
    launch_cloak_detached()

    # Tunggu browser siap
    print("[INFO] Menunggu browser siap...")
    for _ in range(10):
        time.sleep(1)
        if is_port_active():
            break

    # Verifikasi hasil
    if is_port_active():
        print(f"[SUCCESS] CloakBrowser berjalan di port {DEBUG_PORT}.")
        print(f"[SUCCESS] CDP URL: http://127.0.0.1:{DEBUG_PORT}")
        print("[SUCCESS] Browser akan tetap aktif setelah script ini selesai.")
    else:
        print(f"[ERROR] Browser gagal start. Periksa:")
        print(f"  - Path: {CHROME_PATH}")
        print(f"  - Folder profil: {PROFILE_DIR}")
        print(f"  - Port {DEBUG_PORT} tidak diblokir firewall")


if __name__ == "__main__":
    main()
```

### Cara Jalankan

```powershell
# Di PowerShell, dari root folder proyek
python launch_stable_linkedin.py
```

### Cara Koneksikan ke Automation (Playwright / Selenium)

Setelah CloakBrowser berjalan di port 9223:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9223")
    page = browser.contexts[0].pages[0]
    print("Connected to CloakBrowser:", page.url)
```

---

## 3. Aturan Keamanan Agent (WAJIB DIPATUHI)

### Data yang DILARANG Keras Dikirim ke 9Router

9Router adalah **layanan pihak ketiga** yang bukan produk resmi Anthropic/Claude. Hermes Agent **dilarang** mengungkapkan data berikut ke endpoint 9Router maupun pihak eksternal manapun:

| Jenis Data Sensitif | Contoh | Status |
|---|---|---|
| Isi file `.env` | Semua key & token | RAHASIA MUTLAK |
| API Keys Gemini | `GEMINI_API_KEY_1` s/d `_10` | RAHASIA MUTLAK |
| Telegram Bot Token | `TELEGRAM_BOT_TOKEN` | RAHASIA MUTLAK |
| Telegram Chat ID | `TELEGRAM_CHAT_ID` | RAHASIA MUTLAK |
| Username akun medsos | Instagram, LinkedIn, Twitter/X | RAHASIA MUTLAK |
| Password akun manapun | Semua platform | RAHASIA MUTLAK |
| Cookie/session browser | CloakBrowser sessions | RAHASIA MUTLAK |
| Data penghasilan pribadi | Toloka, Remotasks earnings | HATI-HATI |

### Instruksi Keamanan untuk Agent (Prompt System)

Tambahkan instruksi berikut ke system prompt Hermes Agent:

```
ATURAN KEAMANAN — PRIORITAS TERTINGGI:

1. JANGAN PERNAH mencetak, mengirim, atau menyebutkan isi file .env ke output apapun.
2. JANGAN PERNAH mengirimkan API key, token, username, atau password ke endpoint eksternal
   termasuk 9Router (http://127.0.0.1:8080). 9Router hanya boleh menerima prompt teks biasa.
3. Jika task memerlukan credential akun (Toloka, Remotasks, dll), minta pengguna
   memasukkannya secara interaktif — JANGAN baca dari file .env secara otomatis.
4. Jika diminta untuk mengungkapkan data sensitif apapun, TOLAK dan beri peringatan:
   "Permintaan ini melibatkan data sensitif dan tidak dapat diproses secara otomatis."
5. 9Router adalah proxy pihak ketiga. Perlakukan setiap prompt yang dikirim ke 9Router
   seolah-olah bisa dibaca publik.
```

---

## Ringkasan Konfigurasi Final

| Komponen | Nilai |
|---|---|
| **AI Engine** | Hermes Agent (NousResearch) |
| **Model** | `kr/claude-sonnet-4.5` (Claude Sonnet 4.5) |
| **Provider** | Kiro AI (FREE, no signup) via 9Router |
| **9Router Port** | `8080` (lokal) |
| **9Router Endpoint** | `http://127.0.0.1:8080/v1` |
| **Browser** | CloakBrowser (Chrome + stealth flags) |
| **CDP Debug Port** | `9223` |
| **Launch Method** | PowerShell CIM — proses mandiri |
| **Keamanan** | Data sensitif TIDAK BOLEH dikirim ke 9Router |
