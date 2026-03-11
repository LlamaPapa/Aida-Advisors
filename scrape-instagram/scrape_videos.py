#!/usr/bin/env python3
"""
Instagram Video Scraper for @mattganzak
========================================
Scrapes the last N videos (Reels) from a public Instagram profile
and exports metadata to JSON + CSV.

Requirements:
    pip install instaloader

Usage:
    python scrape_videos.py                          # Default: 15 videos from @mattganzak
    python scrape_videos.py --username mattganzak --count 15
    python scrape_videos.py --username mattganzak --count 15 --login your_username

Notes:
    - Works best when logged in (Instagram rate-limits anonymous requests)
    - To login: python scrape_videos.py --login YOUR_INSTAGRAM_USERNAME
    - First login will prompt for password and save session for reuse
"""

import argparse
import csv
import json
import os
import sys
from datetime import datetime

try:
    import instaloader
except ImportError:
    print("ERROR: instaloader not installed. Run: pip install instaloader")
    sys.exit(1)


def scrape_videos(username: str, count: int, login_user: str | None = None) -> list[dict]:
    """Scrape the last `count` video posts from an Instagram profile."""

    L = instaloader.Instaloader(
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        quiet=True,
    )

    # Login if credentials provided (helps avoid rate limiting)
    if login_user:
        try:
            L.load_session_from_file(login_user)
            print(f"[+] Loaded saved session for {login_user}")
        except FileNotFoundError:
            print(f"[*] No saved session found. Logging in as {login_user}...")
            L.interactive_login(login_user)
            L.save_session_to_file()
            print(f"[+] Session saved for future use")

    print(f"[*] Fetching profile: @{username}")
    try:
        profile = instaloader.Profile.from_username(L.context, username)
    except instaloader.exceptions.ProfileNotExistsException:
        print(f"ERROR: Profile @{username} does not exist")
        sys.exit(1)

    print(f"[+] Profile: {profile.full_name}")
    print(f"    Followers: {profile.followers:,}")
    print(f"    Following: {profile.followees:,}")
    print(f"    Posts: {profile.mediacount:,}")
    print(f"    Bio: {profile.biography}")
    print(f"    External URL: {profile.external_url}")
    print(f"    Is Private: {profile.is_private}")
    print()

    if profile.is_private:
        print("ERROR: Profile is private. Login with a follower account to access posts.")
        sys.exit(1)

    videos = []
    skipped = 0
    print(f"[*] Scanning posts for videos (target: {count})...")

    for post in profile.get_posts():
        if len(videos) >= count:
            break

        # Only collect video posts (Reels, IGTV, video posts)
        if not post.is_video:
            skipped += 1
            continue

        video_data = {
            "shortcode": post.shortcode,
            "url": f"https://www.instagram.com/p/{post.shortcode}/",
            "date": post.date_utc.isoformat(),
            "date_readable": post.date_utc.strftime("%B %d, %Y %I:%M %p UTC"),
            "caption": post.caption or "(no caption)",
            "likes": post.likes,
            "comments": post.comments,
            "video_view_count": post.video_view_count,
            "video_url": post.video_url,
            "video_duration": getattr(post, "video_duration", None),
            "typename": post.typename,
            "is_sponsored": post.is_sponsored,
            "hashtags": list(post.caption_hashtags) if post.caption_hashtags else [],
            "mentions": list(post.caption_mentions) if post.caption_mentions else [],
            "tagged_users": list(post.tagged_users) if post.tagged_users else [],
            "location": str(post.location) if post.location else None,
            "thumbnail_url": post.url,
        }

        videos.append(video_data)
        print(
            f"  [{len(videos)}/{count}] {video_data['date_readable']} | "
            f"{video_data['video_view_count']:,} views | "
            f"{video_data['likes']:,} likes | "
            f"{post.caption[:80] + '...' if post.caption and len(post.caption) > 80 else post.caption or '(no caption)'}"
        )

    print(f"\n[+] Collected {len(videos)} videos (skipped {skipped} non-video posts)")
    return videos


def export_json(videos: list[dict], filepath: str):
    """Export video data to JSON."""
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(
            {
                "scraped_at": datetime.utcnow().isoformat(),
                "total_videos": len(videos),
                "videos": videos,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )
    print(f"[+] Exported JSON: {filepath}")


def export_csv(videos: list[dict], filepath: str):
    """Export video data to CSV."""
    if not videos:
        return

    fieldnames = [
        "shortcode",
        "url",
        "date",
        "caption",
        "likes",
        "comments",
        "video_view_count",
        "video_duration",
        "hashtags",
        "mentions",
        "tagged_users",
        "location",
        "video_url",
    ]

    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for v in videos:
            row = {**v}
            row["hashtags"] = ", ".join(v.get("hashtags", []))
            row["mentions"] = ", ".join(v.get("mentions", []))
            row["tagged_users"] = ", ".join(v.get("tagged_users", []))
            writer.writerow(row)

    print(f"[+] Exported CSV: {filepath}")


def print_analysis(videos: list[dict]):
    """Print a summary analysis of the scraped videos."""
    if not videos:
        print("No videos to analyze.")
        return

    total_views = sum(v["video_view_count"] or 0 for v in videos)
    total_likes = sum(v["likes"] for v in videos)
    total_comments = sum(v["comments"] for v in videos)
    avg_views = total_views / len(videos)
    avg_likes = total_likes / len(videos)
    avg_comments = total_comments / len(videos)

    # Find top performers
    by_views = sorted(videos, key=lambda x: x["video_view_count"] or 0, reverse=True)
    by_likes = sorted(videos, key=lambda x: x["likes"], reverse=True)
    by_engagement = sorted(
        videos,
        key=lambda x: (x["likes"] + x["comments"]) / max(x["video_view_count"] or 1, 1),
        reverse=True,
    )

    # Collect all hashtags
    all_hashtags: dict[str, int] = {}
    for v in videos:
        for tag in v.get("hashtags", []):
            all_hashtags[tag] = all_hashtags.get(tag, 0) + 1

    print("\n" + "=" * 70)
    print("VIDEO PERFORMANCE ANALYSIS")
    print("=" * 70)
    print(f"\nTotal Videos Analyzed: {len(videos)}")
    print(f"Date Range: {videos[-1]['date_readable']} → {videos[0]['date_readable']}")
    print(f"\nTotal Views:    {total_views:>12,}")
    print(f"Total Likes:    {total_likes:>12,}")
    print(f"Total Comments: {total_comments:>12,}")
    print(f"\nAvg Views/Video:    {avg_views:>10,.0f}")
    print(f"Avg Likes/Video:    {avg_likes:>10,.0f}")
    print(f"Avg Comments/Video: {avg_comments:>10,.0f}")
    print(f"Avg Engagement Rate: {((avg_likes + avg_comments) / max(avg_views, 1)) * 100:.2f}%")

    print(f"\n{'─' * 70}")
    print("TOP 3 BY VIEWS:")
    for i, v in enumerate(by_views[:3], 1):
        caption_preview = (v["caption"][:100] + "...") if len(v["caption"]) > 100 else v["caption"]
        print(f"  {i}. {v['video_view_count']:,} views | {v['url']}")
        print(f"     {caption_preview}")

    print(f"\n{'─' * 70}")
    print("TOP 3 BY LIKES:")
    for i, v in enumerate(by_likes[:3], 1):
        caption_preview = (v["caption"][:100] + "...") if len(v["caption"]) > 100 else v["caption"]
        print(f"  {i}. {v['likes']:,} likes | {v['url']}")
        print(f"     {caption_preview}")

    print(f"\n{'─' * 70}")
    print("TOP 3 BY ENGAGEMENT RATE:")
    for i, v in enumerate(by_engagement[:3], 1):
        eng_rate = (v["likes"] + v["comments"]) / max(v["video_view_count"] or 1, 1) * 100
        caption_preview = (v["caption"][:100] + "...") if len(v["caption"]) > 100 else v["caption"]
        print(f"  {i}. {eng_rate:.2f}% engagement | {v['url']}")
        print(f"     {caption_preview}")

    if all_hashtags:
        print(f"\n{'─' * 70}")
        print("MOST USED HASHTAGS:")
        for tag, cnt in sorted(all_hashtags.items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"  #{tag}: {cnt}x")

    print(f"\n{'=' * 70}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Scrape Instagram videos and analyze performance"
    )
    parser.add_argument(
        "--username", "-u", default="mattganzak", help="Instagram username (default: mattganzak)"
    )
    parser.add_argument(
        "--count", "-n", type=int, default=15, help="Number of videos to scrape (default: 15)"
    )
    parser.add_argument("--login", "-l", help="Your Instagram username for authenticated access")
    parser.add_argument(
        "--output-dir",
        "-o",
        default="output",
        help="Output directory for exports (default: output)",
    )
    parser.add_argument("--no-analysis", action="store_true", help="Skip performance analysis")
    args = parser.parse_args()

    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)

    # Scrape
    videos = scrape_videos(args.username, args.count, args.login)

    if not videos:
        print("No videos found.")
        sys.exit(0)

    # Export
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    json_path = os.path.join(args.output_dir, f"{args.username}_videos_{timestamp}.json")
    csv_path = os.path.join(args.output_dir, f"{args.username}_videos_{timestamp}.csv")

    export_json(videos, json_path)
    export_csv(videos, csv_path)

    # Analyze
    if not args.no_analysis:
        print_analysis(videos)


if __name__ == "__main__":
    main()
