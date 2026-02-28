"""
Lyrics fetching module for worker tasks.
Fetches lyrics from Genius API for comparison with user transcription.
"""
import os
import re
import logging
from typing import Optional
import httpx

logger = logging.getLogger(__name__)


GENIUS_API_TOKEN = os.getenv("GENIUS_API_TOKEN", "")
GENIUS_API_URL = "https://api.genius.com"


def get_lyrics(artist: str, title: str) -> dict:
    """
    Fetch lyrics for a song from Genius API.

    Args:
        artist: Artist name
        title: Song title

    Returns:
        dict with:
            - text: Lyrics text (empty if not found)
            - source: "genius" or "none"
            - status: "found", "not_found", or "error"
    """
    if not GENIUS_API_TOKEN:
        logger.warning("No GENIUS_API_TOKEN configured")
        return {
            "text": "",
            "source": "none",
            "status": "error",
            "error": "Genius API not configured",
        }

    try:
        # Step 1: Search for the song
        search_result = _search_song(artist, title)
        if not search_result:
            return {
                "text": "",
                "source": "none",
                "status": "not_found",
            }

        # Step 2: Get lyrics from the song page
        lyrics = _scrape_lyrics(search_result["url"])
        if not lyrics:
            return {
                "text": "",
                "source": "none",
                "status": "not_found",
            }

        return {
            "text": lyrics,
            "source": "genius",
            "status": "found",
            "url": search_result["url"],
            "title": search_result["title"],
            "artist": search_result["artist"],
        }

    except Exception as e:
        logger.error("Lyrics fetch error: %s", e)
        return {
            "text": "",
            "source": "none",
            "status": "error",
            "error": str(e),
        }


def _search_song(artist: str, title: str) -> Optional[dict]:
    """Search for a song on Genius API."""
    headers = {
        "Authorization": f"Bearer {GENIUS_API_TOKEN}",
    }

    query = f"{artist} {title}"

    try:
        response = httpx.get(
            f"{GENIUS_API_URL}/search",
            headers=headers,
            params={"q": query},
            timeout=15.0,
        )
        response.raise_for_status()
        data = response.json()

        hits = data.get("response", {}).get("hits", [])
        if not hits:
            return None

        # Find best match (first result usually)
        for hit in hits:
            result = hit.get("result", {})
            song_artist = result.get("primary_artist", {}).get("name", "").lower()
            song_title = result.get("title", "").lower()

            # Check if artist matches somewhat
            if artist.lower() in song_artist or song_artist in artist.lower():
                return {
                    "url": result.get("url", ""),
                    "title": result.get("title", ""),
                    "artist": result.get("primary_artist", {}).get("name", ""),
                    "path": result.get("path", ""),
                }

        # Fallback to first result
        first_result = hits[0].get("result", {})
        return {
            "url": first_result.get("url", ""),
            "title": first_result.get("title", ""),
            "artist": first_result.get("primary_artist", {}).get("name", ""),
            "path": first_result.get("path", ""),
        }

    except Exception as e:
        logger.warning("Lyrics search error: %s", e)
        return None


def _scrape_lyrics(url: str) -> Optional[str]:
    """
    Scrape lyrics from Genius song page.

    Uses the Genius page HTML to extract lyrics.
    """
    try:
        response = httpx.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36"
            },
            timeout=15.0,
            follow_redirects=True,
        )
        response.raise_for_status()
        html = response.text

        # Extract lyrics using regex patterns
        # Genius uses data-lyrics-container divs
        lyrics_parts = []

        # Pattern 1: New Genius format (data-lyrics-container)
        pattern1 = r'<div[^>]*data-lyrics-container="true"[^>]*>(.*?)</div>'
        matches = re.findall(pattern1, html, re.DOTALL)

        if matches:
            for match in matches:
                # Remove HTML tags but keep line breaks
                text = re.sub(r'<br\s*/?>', '\n', match)
                text = re.sub(r'<[^>]+>', '', text)
                text = _decode_html_entities(text)
                lyrics_parts.append(text.strip())

        if lyrics_parts:
            lyrics = '\n'.join(lyrics_parts)
            return _clean_lyrics(lyrics)

        # Pattern 2: Old format (Lyrics__Container)
        pattern2 = r'class="Lyrics__Container[^"]*"[^>]*>(.*?)</div>'
        matches = re.findall(pattern2, html, re.DOTALL)

        if matches:
            for match in matches:
                text = re.sub(r'<br\s*/?>', '\n', match)
                text = re.sub(r'<[^>]+>', '', text)
                text = _decode_html_entities(text)
                lyrics_parts.append(text.strip())

            if lyrics_parts:
                lyrics = '\n'.join(lyrics_parts)
                return _clean_lyrics(lyrics)

        logger.debug("Could not find lyrics in page")
        return None

    except Exception as e:
        logger.warning("Lyrics scrape error: %s", e)
        return None


def _decode_html_entities(text: str) -> str:
    """Decode HTML entities like &amp; &quot; etc."""
    import html
    return html.unescape(text)


def _clean_lyrics(lyrics: str) -> str:
    """
    Clean up raw lyrics.

    Removes:
    - Section headers [Verse 1], [Chorus]
    - Extra whitespace
    - Special characters
    """
    if not lyrics:
        return ""

    # Remove section headers [Verse], [Chorus], etc.
    lyrics = re.sub(r'\[.*?\]', '', lyrics)

    # Remove Genius metadata prefix (e.g. "10 ContributorsTranslationsEnglish")
    lyrics = re.sub(
        r'^\d*\s*Contributor[s]?.*?\n+', '', lyrics, flags=re.IGNORECASE,
    )

    # Clean up whitespace
    lyrics = re.sub(r'\n{3,}', '\n\n', lyrics)
    lyrics = lyrics.strip()

    return lyrics
