# Instagram Video Scraper

Scrapes the last N videos from a public Instagram profile and exports metadata + performance analysis.

## Setup

```bash
pip install -r requirements.txt
```

## Usage

```bash
# Scrape last 15 videos from @mattganzak (default)
python scrape_videos.py

# Custom target
python scrape_videos.py --username mattganzak --count 15

# With login (avoids rate limiting, required for private profiles)
python scrape_videos.py --login YOUR_INSTAGRAM_USERNAME

# Custom output directory
python scrape_videos.py --output-dir ./data
```

## Output

- **JSON** — Full metadata for each video (views, likes, comments, captions, hashtags, URLs)
- **CSV** — Spreadsheet-friendly export
- **Terminal** — Performance analysis with top videos by views, likes, and engagement rate

## Notes

- Instagram aggressively rate-limits anonymous requests. Using `--login` is recommended.
- First login prompts for password and saves the session locally for reuse.
- Only public profiles can be scraped without being a follower.
