"""
instagram_inbox_agent.py — Nexus DualBrain AI
===============================================
Agen khusus untuk memantau kotak masuk (Inbox) Instagram.
Jika ada pesan masuk dari target (UMKM), agen akan membacanya,
menggunakan AI untuk merumuskan balasan (membuat caption/review),
lalu membalas secara otonom dan memberi notifikasi ke Telegram via Hermes.

v2 — Perbaikan selector berdasarkan real DOM analysis:
  - Instagram inbox menggunakan [aria-label="Thread list"] sebagai container
  - Thread list berisi teks plain (nama toko + preview pesan + timestamp)
  - Thread yang perlu dibalas = preview pesan BUKAN dimulai "You:"
"""

import asyncio
import logging
import os
import json
import re
import urllib.request
from typing import Optional, List, Dict

from hermes_agent import HermesAgent
from api_client import GeminiClient
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

SENT_TARGETS_PATH = os.path.join(os.path.dirname(__file__), "client_memory.json")

def _load_sent_targets() -> list:
    try:
        with open(SENT_TARGETS_PATH, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


class InstagramInboxAgent:
    def __init__(self, llm_client):
        self.llm = llm_client
        self.hermes = HermesAgent(gemini_client=None)
        self.pw = None
        self.browser = None
        self.page = None

    async def _ensure_browser(self):
        if self.page:
            return

        from playwright.async_api import async_playwright
        self.pw = await async_playwright().start()

        cdp_candidates = [
            os.environ.get("BRAVE_CDP_URL", "").strip(),
            "http://127.0.0.1:9223",
        ]

        cdp_url = None
        for url in cdp_candidates:
            if not url:
                continue
            try:
                req = urllib.request.urlopen(f"{url}/json/version", timeout=2)
                if req.status == 200:
                    cdp_url = url
                    break
            except Exception:
                continue

        if not cdp_url:
            raise RuntimeError("Brave browser CDP tidak ditemukan (port 9223).")

        logger.info("[InboxAgent] Menghubungkan ke CDP: %s", cdp_url)
        self.browser = await self.pw.chromium.connect_over_cdp(cdp_url)
        context = self.browser.contexts[0] if self.browser.contexts else await self.browser.new_context()
        self.page = context.pages[0] if context.pages else await context.new_page()

    def _parse_thread_list(self, raw_text: str) -> List[Dict]:
        """
        Parse teks dari Thread list menjadi list of thread dicts.
        Format tiap thread di inbox:
            NamaToko
            You: pesan terakhir kita   ATAU   pesan dari mereka
             
            ·
            48m
        """
        lines = raw_text.split('\n')
        threads = []
        
        # Skip header lines (username, notes, Messages, Requests)
        skip_headers = {'Messages', 'Requests', 'What\'s new...', 'Your note', '', '·'}
        
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            
            # Skip empty, header, dan timestamp lines
            if not line or line in skip_headers or line == ' ':
                i += 1
                continue
            
            # Skip jika ini timestamp (misal "46m", "1h", "2h", "1d", dll)
            if re.match(r'^\d+[mhd]$', line) or line in ('Active now', 'Typing...', 'Active'):
                i += 1
                continue
                
            # Skip jika ini username kita sendiri atau terkait Meta/Note
            if line == 'verdiawan.copy' or 'note' in line.lower() or 'obsession' in line.lower() or 'shared with' in line.lower():
                i += 1
                continue
            
            # Ini kemungkinan nama toko
            thread_name = line
            preview = ""
            
            # Cek baris berikutnya untuk preview pesan
            if i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if next_line and next_line not in skip_headers and next_line != ' ' and not re.match(r'^\d+[mhd]$', next_line):
                    preview = next_line
                    i += 1  # skip preview line juga
            
            # Validasi akhir untuk Note: jika preview mengandung kata 'note', 'obsession', 'shared'
            if 'note' in preview.lower() or 'obsession' in preview.lower() or 'shared with' in preview.lower():
                i += 1
                continue
                
            threads.append({
                'name': thread_name,
                'preview': preview,
                'has_reply': not preview.startswith('You:') and preview != ''
            })
            
            i += 1
        
        return threads

    async def check_inbox(self) -> int:
        """
        Mengecek inbox, membalas chat unread, return jumlah pesan yang dibalas.
        """
        await self._ensure_browser()
        replied_count = 0

        logger.info("[InboxAgent] Membuka Inbox Instagram...")
        try:
            await self.page.goto("https://www.instagram.com/direct/inbox/", wait_until="domcontentloaded", timeout=20000)
            await self.page.wait_for_timeout(5000)
            
            # Scroll thread list untuk memuat semua thread
            for _ in range(5):
                await self.page.evaluate("""() => {
                    const tl = document.querySelector('[aria-label="Thread list"]');
                    if (tl) tl.scrollTop += 500;
                }""")
                await self.page.wait_for_timeout(1000)
            
            # Ambil teks dari Thread list
            thread_text = await self.page.evaluate("""() => {
                const tl = document.querySelector('[aria-label="Thread list"]');
                return tl ? tl.innerText : '';
            }""")
            
            if not thread_text.strip():
                logger.info("[InboxAgent] Thread list kosong.")
                return 0
            
            # Parse threads
            threads = self._parse_thread_list(thread_text)
            logger.info("[InboxAgent] Ditemukan %d thread chat.", len(threads))
            
            # Filter: hanya thread yang punya balasan dari klien (bukan "You:")
            threads_with_replies = [t for t in threads if t['has_reply']]
            
            if not threads_with_replies:
                logger.info("[InboxAgent] Semua thread menunjukkan pesan terakhir dari kita. Tidak ada balasan baru.")
                return 0
            
            logger.info("[InboxAgent] 🔔 %d thread memiliki balasan dari klien!", len(threads_with_replies))
            
            for thread in threads_with_replies:
                target_name = thread['name']
                logger.info("[InboxAgent] Membuka chat dengan: %s (preview: %s)", target_name, thread['preview'][:50])
                
                # Klik thread berdasarkan nama — cari elemen yang berisi nama tersebut
                clicked = await self._click_thread(target_name)
                if not clicked:
                    logger.warning("[InboxAgent] Gagal klik thread %s, skip.", target_name)
                    continue
                
                await self.page.wait_for_timeout(4000)
                
                # Baca percakapan
                history = await self._read_conversation()
                if not history:
                    logger.warning("[InboxAgent] Tidak bisa membaca percakapan dengan %s", target_name)
                    # Kembali ke inbox
                    await self.page.goto("https://www.instagram.com/direct/inbox/", wait_until="domcontentloaded")
                    await self.page.wait_for_timeout(3000)
                    continue
                
                last_message = history[-1]
                logger.info("[InboxAgent] Pesan terakhir dari klien: %s", last_message[:80])
                
                # Gunakan LLM untuk merumuskan balasan
                reply_text = self._generate_reply(target_name, history)
                
                if not reply_text or "SKIP_REPLY" in reply_text:
                    logger.info("[InboxAgent] AI memutuskan untuk skip %s.", target_name)
                    await self.page.goto("https://www.instagram.com/direct/inbox/", wait_until="domcontentloaded")
                    await self.page.wait_for_timeout(3000)
                    continue
                
                logger.info("[InboxAgent] Mengirim balasan ke %s (%d kata)...", target_name, len(reply_text.split()))
                
                # Cari input chat dan kirim
                sent = await self._send_reply(reply_text)
                
                if sent:
                    replied_count += 1
                    
                    # Notifikasi via Hermes
                    notif_msg = (
                        f"📩 *INSTAGRAM DM DIBALAS!*\n\n"
                        f"👤 *Toko:* {target_name}\n"
                        f"💬 *Pesan Klien:* {last_message[:200]}\n\n"
                        f"🤖 *Balasan AI:*\n{reply_text[:300]}..."
                    )
                    self.hermes.send_message(notif_msg, markdown=True)
                    logger.info("[InboxAgent] ✅ Balasan terkirim ke %s dan dinotifikasikan ke Telegram.", target_name)
                else:
                    logger.warning("[InboxAgent] Gagal mengirim balasan ke %s", target_name)
                
                # Kembali ke daftar inbox
                await self.page.goto("https://www.instagram.com/direct/inbox/", wait_until="domcontentloaded")
                await self.page.wait_for_timeout(3000)

        except Exception as e:
            logger.error("[InboxAgent] Error saat mengecek inbox: %s", e)
            
        return replied_count

    async def _click_thread(self, target_name: str) -> bool:
        """Klik thread berdasarkan nama toko."""
        try:
            # Cari span/div yang berisi teks nama toko di dalam Thread list
            thread_el = await self.page.evaluate(f"""() => {{
                const tl = document.querySelector('[aria-label="Thread list"]');
                if (!tl) return false;
                
                const walker = document.createTreeWalker(tl, NodeFilter.SHOW_TEXT);
                while (walker.nextNode()) {{
                    const node = walker.currentNode;
                    if (node.textContent.trim() === '{target_name}') {{
                        // Klik parent element terdekat yang bisa di-klik
                        let el = node.parentElement;
                        while (el && el !== tl) {{
                            if (el.getAttribute('role') === 'button' || el.tagName === 'A') {{
                                el.click();
                                return true;
                            }}
                            el = el.parentElement;
                        }}
                        // Fallback: klik parent langsung
                        node.parentElement.click();
                        return true;
                    }}
                }}
                return false;
            }}""")
            
            if not thread_el:
                # Fallback: coba klik menggunakan text selector
                el = await self.page.get_by_text(target_name, exact=True).first.element_handle()
                if el:
                    await el.click()
                    return True
                return False
            
            return True
        except Exception as e:
            logger.error("[InboxAgent] Error klik thread %s: %s", target_name, e)
            return False

    async def _read_conversation(self) -> List[str]:
        """Baca pesan-pesan di halaman chat yang sedang terbuka."""
        try:
            # Instagram chat messages menggunakan div[dir="auto"] atau span[dir="auto"]
            messages = await self.page.evaluate("""() => {
                // Cari area pesan utama (bukan sidebar)
                const msgArea = document.querySelector('div[role="grid"]') 
                    || document.querySelector('main')
                    || document.body;
                
                const spans = msgArea.querySelectorAll('div[dir="auto"], span[dir="auto"]');
                const texts = [];
                const seen = new Set();
                
                spans.forEach(el => {
                    const text = el.innerText.trim();
                    // Filter: skip terlalu pendek, navigasi items, dan duplikat
                    if (text.length > 1 && text.length < 2000 && !seen.has(text)) {
                        const skipWords = ['Home', 'Reels', 'Messages', 'Search', 'Explore', 
                            'Notifications', 'New post', 'Settings', 'Requests', 'Send',
                            'verdiawan.copy', 'What\\'s new', 'Your note', 'Also from Meta'];
                        if (!skipWords.some(w => text === w)) {
                            seen.add(text);
                            texts.push(text);
                        }
                    }
                });
                
                return texts.slice(-10);  // Ambil 10 pesan terakhir
            }""")
            
            return messages if messages else []
        except Exception as e:
            logger.error("[InboxAgent] Error baca percakapan: %s", e)
            return []

    async def _send_reply(self, reply_text: str) -> bool:
        """Kirim balasan di chat yang sedang terbuka."""
        try:
            # Cari textbox
            dm_input = await self.page.query_selector('div[role="textbox"][contenteditable="true"]')
            if not dm_input:
                # Fallback: cari textarea
                dm_input = await self.page.query_selector('textarea[placeholder*="Message"], textarea[placeholder*="Pesan"]')
            
            if not dm_input:
                logger.warning("[InboxAgent] Input chat tidak ditemukan.")
                return False
            
            await dm_input.click()
            await self.page.wait_for_timeout(500)
            
            # Ketik perlahan
            await self.page.keyboard.type(reply_text, delay=15)
            await self.page.wait_for_timeout(1000)
            
            # Kirim
            await self.page.keyboard.press("Enter")
            await self.page.wait_for_timeout(3000)
            
            return True
        except Exception as e:
            logger.error("[InboxAgent] Error kirim balasan: %s", e)
            return False

    def _generate_reply(self, target_name: str, history: list) -> str:
        history_text = "\n".join([f"- {msg}" for msg in history])
        
        prompt = (
            f"Kamu adalah copywriter profesional Indonesia yang menawarkan jasa caption & deskripsi produk makanan.\n"
            f"Toko klien: {target_name}\n"
            f"Berikut adalah potongan percakapan terakhir (berurutan):\n"
            f"{history_text}\n\n"
            f"TUGAS:\n"
            f"Berdasarkan percakapan di atas, jika klien tertarik atau meminta caption seperti yang dijanjikan, "
            f"buatkan 3 ide caption Instagram makanan yang MENGGIURKAN dan 1 deskripsi produk.\n"
            f"Aturan:\n"
            f"1. Jika percakapan menunjukkan kita sudah membalas dengan caption/deskripsi, atau klien hanya bilang 'ok/terima kasih' tanda percakapan usai, keluarkan kata 'SKIP_REPLY' saja.\n"
            f"2. Jika klien menolak atau tidak tertarik, keluarkan kata 'SKIP_REPLY' saja.\n"
            f"3. Jika klien minta dibuatkan/tertarik/menjawab positif (misal: 'boleh', 'mau', 'iya', 'ok kirim', 'silakan'), tuliskan balasannya dengan ramah, berikan 3 caption dan 1 deskripsi singkat tersebut.\n"
            f"4. Bahasa Indonesia santai tapi profesional. Jangan terlalu panjang (max 250 kata).\n"
            f"5. Jangan keluarkan teks lain selain pesan yang akan dikirim (atau 'SKIP_REPLY').\n"
            f"6. Di akhir pesan, tambahkan: 'Kalau cocok, saya bisa buatkan lebih banyak lagi kak! Paket 10 caption cuma Rp 125.000 😊'"
        )
        try:
            res = self.llm.generate_content(prompt)
            return res.strip() if res else "SKIP_REPLY"
        except Exception as e:
            logger.error("[InboxAgent] Error generate reply: %s", e)
            return "SKIP_REPLY"

    async def reply_to_specific_user(self, username: str):
        """
        Langsung buka profil user tertentu dan balas chat-nya.
        Berguna untuk kasus pesan lama yang tidak terlihat di daftar inbox.
        """
        await self._ensure_browser()
        
        logger.info("[InboxAgent] Membuka profil @%s untuk balas chat...", username)
        await self.page.goto(f"https://www.instagram.com/{username}/", wait_until="domcontentloaded", timeout=15000)
        await self.page.wait_for_timeout(3000)
        
        # Klik tombol Message
        message_btn = await self.page.query_selector(
            'div[role="button"]:has-text("Message"), '
            'button:has-text("Message"), '
            'div[role="button"]:has-text("Kirim Pesan")'
        )
        if not message_btn:
            all_btns = await self.page.query_selector_all('div[role="button"], button')
            for btn in all_btns:
                text = (await btn.inner_text()).strip().lower()
                if text in ("message", "kirim pesan"):
                    message_btn = btn
                    break
        
        if not message_btn:
            logger.warning("[InboxAgent] Tombol Message tidak ada di @%s", username)
            return False
        
        await message_btn.click()
        await self.page.wait_for_timeout(4000)
        
        # Baca percakapan
        history = await self._read_conversation()
        if not history:
            logger.warning("[InboxAgent] Tidak ada percakapan dengan @%s", username)
            return False
        
        logger.info("[InboxAgent] Percakapan dengan @%s: %d pesan", username, len(history))
        for msg in history:
            logger.info("[InboxAgent]   -> %s", msg[:80])
        
        # Generate balasan
        reply = self._generate_reply(username, history)
        if not reply or "SKIP_REPLY" in reply:
            logger.info("[InboxAgent] AI skip reply untuk @%s", username)
            return False
        
        # Kirim
        sent = await self._send_reply(reply)
        if sent:
            self.hermes.send_message(
                f"📩 *INSTAGRAM DM DIBALAS!*\n\n"
                f"👤 *Toko:* @{username}\n"
                f"💬 *Pesan Klien:* {history[-1][:200]}\n\n"
                f"🤖 *Balasan AI:*\n{reply[:300]}...",
                markdown=True
            )
            logger.info("[InboxAgent] ✅ Balasan terkirim ke @%s!", username)
        
        return sent

    async def cleanup(self):
        if self.pw:
            try:
                await self.pw.stop()
            except Exception:
                pass

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    load_dotenv()
    
    api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11) if os.environ.get(f"GEMINI_KEY_{i}")]
    if not api_keys:
        api_keys = [os.environ.get("GEMINI_API_KEY")]
        
    llm = GeminiClient(api_keys)
    agent = InstagramInboxAgent(llm)
    
    async def main():
        # Cek inbox biasa
        count = await agent.check_inbox()
        print(f"Replied to {count} threads.")
        
        # Juga langsung balas ke tumpengjember.id
        await agent.reply_to_specific_user("tumpengjember.id")
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Stopped.")
