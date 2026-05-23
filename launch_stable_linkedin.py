"""
launch_stable_linkedin.py
=========================
Membuka CloakBrowser secara stabil sebagai proses mandiri (terpisah dari terminal Python).
Browser tetap hidup setelah script selesai dieksekusi.

Lokasi default CloakBrowser:
  C:\Users\user\.antigravity\Nexus-DualBrain-AI\bin\cloak\chrome.exe

Cara jalankan (PowerShell):
  python launch_stable_linkedin.py
"""

import socket
import subprocess
import os
import time

# ── KONFIGURASI ─────────────────────────────────────────────────────────────
CHROME_PATH = r"C:\Users\user\.antigravity\Nexus-DualBrain-AI\bin\cloak\chrome.exe"
PROFILE_DIR = r"bin\cloak_profile"
DEBUG_PORT  = 9222
# ─────────────────────────────────────────────────────────────────────────────


def is_port_active(port: int = DEBUG_PORT) -> bool:
    """Langkah 1 — Cek apakah port remote debugging sudah aktif."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", port)) == 0


def kill_cloak_processes() -> None:
    """Langkah 2a — Bunuh proses Chrome Cloak yang menggantung."""
    result = subprocess.run(
        ["taskkill", "/F", "/IM", "chrome.exe"],
        capture_output=True,
        text=True
    )
    if result.returncode == 0:
        print("[CLEAN] Proses chrome.exe dimatikan.")
    time.sleep(1)


def clear_lock_files() -> None:
    """Langkah 2b — Hapus LOCK / SingletonLock agar Chrome tidak loop error."""
    lock_files = ["LOCK", "SingletonLock", "SingletonCookie", "SingletonSocket"]
    for lock_file in lock_files:
        path = os.path.join(PROFILE_DIR, lock_file)
        if os.path.exists(path):
            try:
                os.remove(path)
                print(f"[CLEAN] Dihapus: {path}")
            except Exception as e:
                print(f"[WARN]  Gagal hapus {path}: {e}")


def launch_cloak_detached() -> None:
    """
    Langkah 3 & 4:
    - Susun parameter stealth (--disable-blink-features=AutomationControlled)
    - Detach via PowerShell CIM (Invoke-CimMethod Win32_Process)

    CIM meluncurkan browser sebagai proses Windows MANDIRI yang sepenuhnya
    terpisah dari terminal Python. Browser tetap hidup setelah script selesai.
    """
    # Langkah 3: Parameter stealth
    command = (
        f'"{CHROME_PATH}" '
        f'--user-data-dir="{PROFILE_DIR}" '
        f'--remote-debugging-port={DEBUG_PORT} '
        f'--disable-blink-features=AutomationControlled '
        f'--no-sandbox '
        f'--start-maximized'
    )

    # Langkah 4: Detach via PowerShell CIM (bukan subprocess biasa)
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
        print("[LAUNCH] CloakBrowser diluncurkan sebagai proses mandiri (via CIM).")
    else:
        print(f"[ERROR]  PowerShell gagal (exit {result.returncode}):")
        print(f"         {result.stderr.strip()}")


def connect_playwright(port: int = DEBUG_PORT) -> None:
    """Contoh: koneksikan Playwright ke CloakBrowser via CDP."""
    print(f"\n[INFO] Untuk koneksi Playwright/Selenium:")
    print(f"       CDP URL: http://127.0.0.1:{port}")
    print(f"       Contoh Playwright:")
    print(f"         browser = p.chromium.connect_over_cdp('http://127.0.0.1:{port}')")


def main() -> None:
    print("=" * 55)
    print("   CloakBrowser Launcher  —  Stable / Detached Mode")
    print("=" * 55)

    # Langkah 1: Cek port — skip launch jika browser sudah berjalan
    if is_port_active():
        print(f"[OK] Port {DEBUG_PORT} aktif — CloakBrowser sudah berjalan.")
        print(f"[OK] CDP tersedia di: http://127.0.0.1:{DEBUG_PORT}")
        connect_playwright()
        return

    print(f"[INFO] Port {DEBUG_PORT} tidak aktif, memulai launch...")

    # Langkah 2: Bersihkan proses dan lock files
    kill_cloak_processes()
    clear_lock_files()

    # Langkah 3 & 4: Launch sebagai proses mandiri via CIM
    launch_cloak_detached()

    # Tunggu browser siap (maks 10 detik)
    print("[INFO] Menunggu CloakBrowser siap", end="", flush=True)
    for _ in range(10):
        time.sleep(1)
        print(".", end="", flush=True)
        if is_port_active():
            break
    print()

    # Verifikasi
    if is_port_active():
        print(f"\n[SUCCESS] CloakBrowser berjalan di port {DEBUG_PORT}!")
        print(f"[SUCCESS] CDP URL  : http://127.0.0.1:{DEBUG_PORT}")
        print(f"[SUCCESS] Browser akan tetap aktif setelah script ini selesai.")
        connect_playwright()
    else:
        print(f"\n[ERROR] Browser gagal start. Periksa:")
        print(f"  1. Path : {CHROME_PATH}")
        print(f"  2. Profil: {PROFILE_DIR}")
        print(f"  3. Port {DEBUG_PORT} tidak diblokir firewall Windows")
        print(f"  4. Jalankan sebagai Administrator jika perlu")


if __name__ == "__main__":
    main()
