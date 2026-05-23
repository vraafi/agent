# HermesMoneyAgent 💸

Proyek ini adalah implementasi Agen AI Otonom untuk mencari dan menyelesaikan microtasks guna menghasilkan uang saku hingga target \$10 tercapai. Agent ini menggunakan core dari [Hermes Agent](https://github.com/NousResearch/hermes-agent) dan dirouting menggunakan [9Router](https://github.com/9router/9router) untuk efisiensi limit API Gemini (menghindari HTTP 429). Sistem dieksekusi dengan Node.js orchestrator yang mengekspos custom JavaScript modules menggunakan arsitektur MCP (Model Context Protocol).

## ⚠️ Peringatan Penting
- **Constraints**: Agent ini dilarang keras untuk mengeluarkan uang sungguhan.
- Harus ada *Human approval* sebelum penarikan (withdrawal) pendapatan yang dikumpulkan.

## 🛠 Step by Step Setup dari Nol

### 1. Prasyarat Sistem
Pastikan komputer kamu sudah terinstal:
- Node.js (v18+)
- Python (v3.11+)
- Git

### 2. Cara Isi 10 API Key Gemini
Untuk menghindari rate-limit saat agen melakukan reasoning panjang, agen menggunakan sistem rotasi dari 10 API Key Google Gemini (gratis).
1. Kunjungi [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Buat project baru dan generate API Key. Ulangi untuk mendapatkan total 10 Key (bisa menggunakan akun google sekunder jika batas project tercapai).
3. Salin file `.env.example` menjadi `.env`.
   ```bash
   cp .env.example .env
   ```
4. Buka `.env` di text editor dan masukkan 10 key kamu:
   ```env
   GEMINI_API_KEY_1=AizaSyYourKey1...
   GEMINI_API_KEY_2=AizaSyYourKey2...
   # ... dst
   ```

### 3. Cara Daftar Toloka dan Remotasks Manual
Karena platform pekerja lepas memiliki captcha & verifikasi identitas (KYC) yang rumit, pembuatan akun harus dilakukan secara manual sebelum agen dijalankan:

**Toloka:**
1. Buka [Toloka.ai](https://toloka.ai/).
2. Daftar sebagai *Toloker* (bukan Requestor).
3. Selesaikan verifikasi nomor HP dan KYC dasar.
4. Luluskan tes bahasa Inggris (wajib untuk task bayaran tinggi).

**Remotasks:**
1. Buka [Remotasks.com](https://www.remotasks.com/).
2. Daftar menggunakan email atau akun Google.
3. Selesaikan "Onboarding Bootcamp" untuk mengaktifkan antrian tugas (Lidar/Categorization).

### 4. Menjalankan Agent
Setelah lingkungan disiapkan:
1. Instal package Node.js untuk modul kustom (MCP server & utilitas):
   ```bash
   npm install dotenv sqlite3 @modelcontextprotocol/sdk
   ```
2. Instal dependensi Hermes Agent (sebagai virtual env `venv` yang biasa dijalankan di repo Hermes). Disarankan menggunakan `uv` atau skrip setup.sh mereka.
   ```bash
   cd hermes-agent && ./scripts/install.sh && cd ..
   ```
3. Bangun production NextJS app di 9router:
   ```bash
   cd 9router && npm install && npm run build && cd ..
   ```
4. Jalankan orchestrator:
   ```bash
   node src/start.js
   ```

### 🗂 Struktur File
- `/hermes-agent/` : Cloned repository engine agen asli dari NousResearch. Dilengkapi integrasi `mcp.json` ke server NodeJS.
- `/9router/`      : Cloned repository lokal proxy 9router untuk multi-key management.
- `/src/`          : Modul tambahan HermesMoneyAgent
  - `start.js`     : Orchestrator yang menjalankan kedua layanan dan menyambungkan komunikasi proses.
  - `mcp_server.js`: MCP Server yang dieksekusi oleh Hermes Agent untuk mengakses modul javascript.
  - `keyManager.js`: Generator konfigurasi rotasi 10 key untuk 9Router (`9router-data/db.json`).
  - `taskDiscovery.js`: Algoritma scraping/API call ke platform tasks.
  - `earningsTracker.js`: Database SQLite pencatatan penghasilan.
  - `telegramNotifier.js`: Modul notifikasi periodik progres ke Telegram.
- `logs/actions.log` : Rekaman log aktivitas agen secara rinci.
