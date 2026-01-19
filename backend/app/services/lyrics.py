"""
Lyrics service for fetching song lyrics from Genius API.
Used to compare user's transcribed lyrics with official lyrics.
"""
import re
import asyncio
from typing import Optional
import lyricsgenius
from app.config import settings


class LyricsService:
    """
    Service for fetching song lyrics from Genius API.

    Provides:
    - Search by artist + title
    - Clean lyrics extraction (removes annotations)
    - Caching support via Redis (handled externally)
    """

    def __init__(self):
        self._genius: Optional[lyricsgenius.Genius] = None

    def _get_client(self) -> Optional[lyricsgenius.Genius]:
        """Lazy-load Genius client."""
        if not settings.genius_api_token:
            print("[LyricsService] No GENIUS_API_TOKEN configured")
            return None

        if self._genius is None:
            self._genius = lyricsgenius.Genius(
                settings.genius_api_token,
                timeout=15,
                retries=2,
                verbose=False,
                remove_section_headers=True,
            )
            # Don't include song info in output
            self._genius.skip_non_songs = True

        return self._genius

    async def get_lyrics(
        self,
        artist: str,
        title: str,
    ) -> dict:
        """
        Fetch lyrics for a song from Genius API.

        Args:
            artist: Artist name (e.g., "Ed Sheeran")
            title: Song title (e.g., "Shape of You")

        Returns:
            dict with:
                - text: Lyrics text (empty if not found)
                - source: "genius" or "none"
                - status: "found", "not_found", or "error"
                - url: Genius URL (if found)
        """
        genius = self._get_client()
        if not genius:
            return {
                "text": "",
                "source": "none",
                "status": "error",
                "error": "Genius API not configured",
            }

        try:
            # Run in thread to avoid blocking (lyricsgenius is sync)
            song = await asyncio.to_thread(
                genius.search_song,
                title,
                artist,
            )

            if song and song.lyrics:
                # Clean up lyrics
                clean_lyrics = self._clean_lyrics(song.lyrics)

                return {
                    "text": clean_lyrics,
                    "source": "genius",
                    "status": "found",
                    "url": song.url,
                    "title": song.title,
                    "artist": song.artist,
                }
            else:
                return {
                    "text": "",
                    "source": "none",
                    "status": "not_found",
                }

        except Exception as e:
            print(f"[LyricsService] Error fetching lyrics: {e}")
            return {
                "text": "",
                "source": "none",
                "status": "error",
                "error": str(e),
            }

    def _clean_lyrics(self, lyrics: str) -> str:
        """
        Clean up raw lyrics from Genius.

        Removes:
        - "X Lyrics" header
        - "XEmbed" footer
        - Section headers like [Verse 1], [Chorus]
        - Extra whitespace
        """
        if not lyrics:
            return ""

        # Remove "SongTitle Lyrics" header pattern
        lyrics = re.sub(r"^.*Lyrics\n", "", lyrics, count=1)

        # Remove "Embed" or "XEmbed" footer
        lyrics = re.sub(r"\d*Embed$", "", lyrics)

        # Remove section headers [Verse], [Chorus], etc.
        lyrics = re.sub(r"\[.*?\]", "", lyrics)

        # Clean up whitespace
        lyrics = re.sub(r"\n{3,}", "\n\n", lyrics)
        lyrics = lyrics.strip()

        return lyrics

    async def search_songs(
        self,
        query: str,
        limit: int = 5,
    ) -> list[dict]:
        """
        Search for songs on Genius.

        Args:
            query: Search query (e.g., "shape of you ed sheeran")
            limit: Max results to return

        Returns:
            List of song matches with title, artist, url
        """
        genius = self._get_client()
        if not genius:
            return []

        try:
            results = await asyncio.to_thread(
                genius.search_songs,
                query,
            )

            songs = []
            for hit in results.get("hits", [])[:limit]:
                song_data = hit.get("result", {})
                songs.append({
                    "title": song_data.get("title", ""),
                    "artist": song_data.get("primary_artist", {}).get("name", ""),
                    "url": song_data.get("url", ""),
                    "thumbnail": song_data.get("song_art_image_thumbnail_url", ""),
                })

            return songs

        except Exception as e:
            print(f"[LyricsService] Search error: {e}")
            return []


# Singleton instance
lyrics_service = LyricsService()
