import requests
from bs4 import BeautifulSoup
import csv
import random
import sys

def scrape_books():
    # Target URL: A public sandbox for web scraping
    url = "http://books.toscrape.com/catalogue/page-1.html"
    
    # List of fake user-agents for rotation to avoid basic bot detection
    user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15"
    ]

    headers = {
        "User-Agent": random.choice(user_agents),
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        print(f"Fetching data from {url}...")
        # Perform the request with a timeout to prevent hanging
        response = requests.get(url, headers=headers, timeout=15)
        
        # Raise an exception for bad status codes (4xx or 5xx)
        response.raise_for_status()
        
    except requests.exceptions.HTTPError as http_err:
        print(f"HTTP error occurred: {http_err}")
        sys.exit(1)
    except requests.exceptions.ConnectionError as conn_err:
        print(f"Error connecting: {conn_err}")
        sys.exit(1)
    except requests.exceptions.Timeout as timeout_err:
        print(f"Timeout error: {timeout_err}")
        sys.exit(1)
    except requests.exceptions.RequestException as req_err:
        print(f"An unexpected error occurred: {req_err}")
        sys.exit(1)

    try:
        soup = BeautifulSoup(response.content, 'html.parser')
        books = soup.find_all('article', class_='product_pod')
        
        scraped_data = []
        
        for book in books:
            try:
                # Data Point 1: Title
                # The title is inside the <a> tag within the <h3> tag
                title = book.h3.a['title']
                
                # Data Point 2: Price
                # Price is in a <p> tag with class 'price_color'
                price = book.find('p', class_='price_color').text
                
                # Data Point 3: Availability
                # Availability is in a <p> tag with class 'instock availability'
                availability = book.find('p', class_='instock availability').text.strip()
                
                scraped_data.append({
                    'Title': title,
                    'Price': price,
                    'Availability': availability
                })
            except AttributeError as e:
                print(f"Skipping a book due to missing data: {e}")
                continue

        if not scraped_data:
            print("No data found to save.")
            return

        # Save to CSV
        filename = "books_data.csv"
        keys = scraped_data[0].keys()
        
        with open(filename, 'w', newline='', encoding='utf-8') as output_file:
            dict_writer = csv.DictWriter(output_file, fieldnames=keys)
            dict_writer.writeheader()
            dict_writer.writerows(scraped_data)
            
        print(f"Successfully scraped {len(scraped_data)} items and saved them to {filename}")

    except Exception as e:
        print(f"An error occurred during parsing: {e}")
        sys.exit(1)

if __name__ == "__main__":
    scrape_books()
