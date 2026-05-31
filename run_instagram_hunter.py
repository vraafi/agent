import logging
from dotenv import load_dotenv
from api_client import GeminiClient
from instagram_agent import InstagramAgent
import os

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def main():
    load_dotenv()
    
    api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11) if os.environ.get(f"GEMINI_KEY_{i}")]
    if not api_keys:
        api_keys = [os.environ.get("GEMINI_API_KEY")]
        
    llm = GeminiClient(api_keys)
    
    print("Menghidupkan Hermes Instagram Hunter (Instagrapi Edition)...")
    agent = InstagramAgent(browser_agent=None, llm_client=llm)
    
    if agent.login_instagram():
        print("\nMemulai perburuan klien F&B...")
        agent.search_and_execute_missions()
    else:
        print("Gagal login, periksa file .env Anda.")

if __name__ == "__main__":
    main()
