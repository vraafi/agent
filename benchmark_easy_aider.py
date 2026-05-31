import requests
from bs4 import BeautifulSoup
import csv
import random
import logging
import sys
from typing import Dict, List, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# List of User-Agents to rotate to avoid being blocked
USER_AGENTS: List[str] = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15"
]

def get_random_user_agent() -> str:
    """Returns a random user-agent string from the predefined list."""
    return random.choice(USER_AGENTS)

def scrape_wikipedia_page(url: str) -> Optional[Dict[str, str]]:
    """
    Fetches a Wikipedia page and parses 3 specific data points:
    1. Page Title
    2. The first summary paragraph
    3. The 'First appeared' date from the infobox.

    Args:
        url (str): The URL of the Wikipedia page to scrape.

    Returns:
        Optional[Dict[str, str]]: A dictionary containing the scraped data or None if failed.
    """
    headers = {"User-Agent": get_random_user_agent()}
    
    try:
        logger.info(f"Fetching content from {url}...")
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()  # Raise exception for 4xx or 5xx errors
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 1. Extract Page Title
        title = soup.find('h1', id='firstHeading').get_text(strip=True) if soup.find('h1', id='firstHeading') else "N/A"
        
        # 2. Extract First Summary Paragraph
        # Wikipedia summaries are usually the first few <p> tags that are not empty and not inside a div
        summary_p = soup.find('div', class_='mw-parser-output').find('p', recursive=False)
        while summary_p and not summary_p.get_text(strip=True):
            summary_p = summary_p.find_next_sibling('p')
        
        summary = summary_p.get_text(strip=True) if summary_p else "N/A"
        
        # 3. Extract 'First appeared' date from the infobox
        first_appeared = "N/A"
        infobox = soup.find('table', class_='infobox')
        if infobox:
            rows = infobox.find_all('tr')
            for row in rows:
                label = row.find('th')
                if label and "First appeared" in label.get_text():
                    data = row.find('td')
                    if data:
                        first_appeared = data.get_text(strip=True)
                        break

        logger.info("Successfully parsed data points.")
        return {
            "Title": title,
            "Summary": summary,
            "First Appeared": first_appeared
        }

    except requests.exceptions.HTTPError as http_err:
        logger.error(f"HTTP error occurred: {http_err}")
    except requests.exceptions.ConnectionError as conn_err:
        logger.error(f"Connection error occurred: {conn_err}")
    except requests.exceptions.Timeout as timeout_err:
        logger.error(f"Timeout error occurred: {timeout_err}")
    except Exception as err:
        logger.error(f"An unexpected error occurred: {err}")
    
    return None

def save_to_csv(data: Dict[str, str], filename: str = "scraped_data.csv") -> None:
    """
    Saves the scraped data dictionary to a CSV file.

    Args:
        data (Dict[str, str]): The data to save.
        filename (str): The name of the output CSV file.
    """
    try:
        with open(filename, mode='w', newline='', encoding='utf-8') as csvfile:
            fieldnames = data.keys()
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            
            writer.writeheader()
            writer.writerow(data)
            
        logger.info(f"Data successfully saved to {filename}")
    except IOError as e:
        logger.error(f"I/O error occurred while saving CSV: {e}")

def main():
    """Main execution function."""
    # Target: Wikipedia page for Python (programming language)
    target_url = "https://en.wikipedia.org/wiki/Python_(programming_language)"
    
    scraped_data = scrape_wikipedia_page(target_url)
    
    if scraped_data:
        save_to_csv(scraped_data)
        print("\n--- Scraped Results ---")
        for key, value in scraped_data.items():
            print(f"{key}: {value[:100]}..." if len(value) > 100 else f"{key}: {value}")
        print("-----------------------\n")
    else:
        logger.error("Failed to retrieve data. CSV was not created.")
        sys.exit(1)

if __name__ == "__main__":
    main()
