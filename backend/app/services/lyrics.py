"""
Unified lyrics service with hierarchical provider chain.

Provider priority:
1. Cache (Redis → PostgreSQL)
2. LRCLib (free, legal, synced lyrics)
3. Genius Plain Text Lyrics (fallback)

All results are cached for subsequent requests.
"""
import re
import asyncio
from typing import Optional
import httpx
import lyricsgenius

from app.config import settings
from app.services.lyrics_cache import lyrics_cache_service


class LRCLibLyricsProvider:
    """
    LRCLib provider for free, legal synced lyrics.
    API docs: https://lrclib.net/docs
    No API key required, no rate limiting.
    """

    BASE_URL = "https://lrclib.net/api"

    async def get_lyrics(
        self,
        artist: str,
        title: str,
        album: Optional[str] = None,
        duration_sec: Optional[int] = None,
    ) -> dict:
        """
        Fetch synced lyrics from LRCLib.

        Args:
            artist: Artist name
            title: Song title
            album: Album name (optional, improves matching)
            duration_sec: Track duration in seconds (optional, improves matching)

        Returns:
            dict with text, lines, source, syncType, status
        """
        try:
            # Try exact match first with /api/get
            if duration_sec:
                result = await self._get_exact(artist, title, album, duration_sec)
                if result["status"] == "found":
                    return result

            # Fallback to search
            return await self._search(artist, title)

        except Exception as e:
            print(f"[LRCLib] Error: {e}")
            return {
                "text": "",
                "lines": None,
                "source": "none",
                "syncType": "none",
                "status": "error",
                "error": str(e),
            }

    async def _get_exact(
        self,
        artist: str,
        title: str,
        album: Optional[str],
        duration_sec: int,
    ) -> dict:
        """Try exact match using /api/get endpoint."""
        params = {
            "track_name": title,
            "artist_name": artist,
            "duration": duration_sec,
        }
        if album:
            params["album_name"] = album

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/get",
                params=params,
                headers={"User-Agent": "VoiceJury/1.0"},
                timeout=10.0,
            )

            if response.status_code == 200:
                data = response.json()
                return self._parse_response(data)
            elif response.status_code == 404:
                return {
                    "text": "",
                    "lines": None,
                    "source": "none",
                    "syncType": "none",
                    "status": "not_found",
                }
            else:
                print(f"[LRCLib] API error: {response.status_code}")
                return {
                    "text": "",
                    "lines": None,
                    "source": "none",
                    "syncType": "none",
                    "status": "error",
                    "error": f"HTTP {response.status_code}",
                }

    async def _search(self, artist: str, title: str) -> dict:
        """Search for lyrics using /api/search endpoint."""
        query = f"{artist} {title}"

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/search",
                params={"q": query},
                headers={"User-Agent": "VoiceJury/1.0"},
                timeout=10.0,
            )

            if response.status_code == 200:
                results = response.json()
                if results and len(results) > 0:
                    # Take the first result
                    return self._parse_response(results[0])
                return {
                    "text": "",
                    "lines": None,
                    "source": "none",
                    "syncType": "none",
                    "status": "not_found",
                }
            else:
                print(f"[LRCLib] Search error: {response.status_code}")
                return {
                    "text": "",
                    "lines": None,
                    "source": "none",
                    "syncType": "none",
                    "status": "error",
                    "error": f"HTTP {response.status_code}",
                }

    def _parse_response(self, data: dict) -> dict:
        """Parse LRCLib API response."""
        synced_lyrics = data.get("syncedLyrics")
        plain_lyrics = data.get("plainLyrics", "")

        if synced_lyrics:
            # Parse LRC format to our format
            lines = self._parse_lrc(synced_lyrics)
            plain_text = "\n".join([line["text"] for line in lines])

            return {
                "text": plain_text,
                "lines": lines,
                "source": "lrclib",
                "syncType": "synced",
                "status": "found",
                "title": data.get("trackName"),
                "artist": data.get("artistName"),
                "album": data.get("albumName"),
                "duration": data.get("duration"),
            }
        elif plain_lyrics:
            return {
                "text": plain_lyrics,
                "lines": None,
                "source": "lrclib",
                "syncType": "unsynced",
                "status": "found",
                "title": data.get("trackName"),
                "artist": data.get("artistName"),
            }
        else:
            return {
                "text": "",
                "lines": None,
                "source": "none",
                "syncType": "none",
                "status": "not_found",
            }

    def _parse_lrc(self, lrc_text: str) -> list[dict]:
        """
        Parse LRC format to our synced lines format.
        LRC format: [mm:ss.xx]lyrics text

        Returns:
            list of {text, startTimeMs, endTimeMs}
        """
        lines = []
        lrc_pattern = re.compile(r"\[(\d{2}):(\d{2})\.(\d{2,3})\](.+)")

        for line in lrc_text.strip().split("\n"):
            match = lrc_pattern.match(line.strip())
            if match:
                minutes = int(match.group(1))
                seconds = int(match.group(2))
                centiseconds = match.group(3)
                # Handle both .xx (centiseconds) and .xxx (milliseconds)
                if len(centiseconds) == 2:
                    ms = int(centiseconds) * 10
                else:
                    ms = int(centiseconds)
                text = match.group(4).strip()

                if text:  # Skip empty lines
                    start_time_ms = (minutes * 60 + seconds) * 1000 + ms
                    lines.append({
                        "text": text,
                        "startTimeMs": start_time_ms,
                        "endTimeMs": None,  # Will be filled below
                    })

        # Calculate endTimeMs from next line's startTime
        for i in range(len(lines) - 1):
            lines[i]["endTimeMs"] = lines[i + 1]["startTimeMs"]

        # Last line: estimate 5 seconds duration
        if lines:
            lines[-1]["endTimeMs"] = lines[-1]["startTimeMs"] + 5000

        return lines


class GeniusLyricsProvider:
    """
    Genius API provider for plain text lyrics.
    Falls back when synced lyrics aren't available.
    """

    def __init__(self):
        self._genius: Optional[lyricsgenius.Genius] = None

    def _get_client(self) -> Optional[lyricsgenius.Genius]:
        """Lazy-load Genius client."""
        if not settings.genius_api_client_access_token:
            print("[GeniusLyrics] No GENIUS_API_CLIENT_ACCESS_TOKEN configured")
            return None

        if self._genius is None:
            self._genius = lyricsgenius.Genius(
                settings.genius_api_client_access_token,
                timeout=15,
                retries=2,
                verbose=False,
                remove_section_headers=True,
            )
            self._genius.skip_non_songs = True

        return self._genius

    async def get_lyrics(self, artist: str, title: str) -> dict:
        """
        Fetch lyrics from Genius API.

        Args:
            artist: Artist name
            title: Song title

        Returns:
            dict with text, source, syncType, status, url
        """
        genius = self._get_client()
        if not genius:
            return {
                "text": "",
                "lines": None,
                "source": "none",
                "syncType": "none",
                "status": "error",
                "error": "Genius API not configured",
            }

        try:
            # Run in thread to avoid blocking
            song = await asyncio.to_thread(
                genius.search_song,
                title,
                artist,
            )

            if song and song.lyrics:
                clean_lyrics = self._clean_lyrics(song.lyrics)

                return {
                    "text": clean_lyrics,
                    "lines": None,  # Genius doesn't provide timestamps
                    "source": "genius",
                    "syncType": "unsynced",
                    "status": "found",
                    "url": song.url,
                    "title": song.title,
                    "artist": song.artist,
                }
            else:
                return {
                    "text": "",
                    "lines": None,
                    "source": "none",
                    "syncType": "none",
                    "status": "not_found",
                }

        except Exception as e:
            print(f"[GeniusLyrics] Error: {e}")
            return {
                "text": "",
                "lines": None,
                "source": "none",
                "syncType": "none",
                "status": "error",
                "error": str(e),
            }

    def _clean_lyrics(self, lyrics: str) -> str:
        """Clean up raw lyrics from Genius."""
        if not lyrics:
            return ""

        # Remove "SongTitle Lyrics" header
        lyrics = re.sub(r"^.*Lyrics\n", "", lyrics, count=1)

        # Remove "Embed" footer
        lyrics = re.sub(r"\d*Embed$", "", lyrics)

        # Remove section headers
        lyrics = re.sub(r"\[.*?\]", "", lyrics)

        # Clean up whitespace
        lyrics = re.sub(r"\n{3,}", "\n\n", lyrics)
        lyrics = lyrics.strip()

        return lyrics

    async def search_songs(self, query: str, limit: int = 5) -> list[dict]:
        """Search for songs on Genius."""
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
            print(f"[GeniusLyrics] Search error: {e}")
            return []


class LyricsService:
    """
    Unified lyrics service with caching and provider chain.

    Priority:
    1. Cache (Redis → PostgreSQL)
    2. LRCLib (free, legal, synced lyrics)
    3. Genius Plain Text (fallback)
    """

    def __init__(self):
        self.lrclib = LRCLibLyricsProvider()
        self.genius = GeniusLyricsProvider()

    async def get_lyrics(
        self,
        spotify_track_id: str,
        artist: str,
        title: str,
        album: Optional[str] = None,
        duration_sec: Optional[int] = None,
    ) -> dict:
        """
        Get lyrics with hierarchical provider chain and caching.

        Args:
            spotify_track_id: Spotify track ID (for cache key)
            artist: Artist name
            title: Song title
            album: Album name (optional, improves LRCLib matching)
            duration_sec: Track duration in seconds (optional, improves LRCLib matching)

        Returns:
            dict with:
                - text: Plain text lyrics
                - lines: Synced lyrics array (if available)
                - syncType: 'synced', 'unsynced', or 'none'
                - source: 'lrclib', 'genius', or 'none'
                - status: 'found', 'not_found', or 'error'
                - cachedAt: Cache timestamp (if cached)
        """
        # 1. Check cache first
        cached = await lyrics_cache_service.get(spotify_track_id)
        if cached:
            return cached

        # 2. Try LRCLib for synced lyrics (free & legal)
        result = await self.lrclib.get_lyrics(
            artist=artist,
            title=title,
            album=album,
            duration_sec=duration_sec,
        )
        if result["status"] == "found":
            # Cache the result
            await lyrics_cache_service.set(
                spotify_track_id=spotify_track_id,
                lyrics_text=result.get("text"),
                synced_lines=result.get("lines"),
                sync_type=result.get("syncType", "synced"),
                source=result.get("source", "lrclib"),
                source_url=None,
                artist_name=artist,
                track_name=title,
            )
            return result

        # 3. Fallback to Genius (plain text only)
        result = await self.genius.get_lyrics(artist, title)
        if result["status"] == "found":
            # Cache the result
            await lyrics_cache_service.set(
                spotify_track_id=spotify_track_id,
                lyrics_text=result.get("text"),
                synced_lines=result.get("lines"),
                sync_type=result.get("syncType", "unsynced"),
                source=result.get("source", "genius"),
                source_url=result.get("url"),
                artist_name=artist,
                track_name=title,
            )
            return result

        # 4. Cache negative result (to avoid repeated API calls)
        await lyrics_cache_service.set(
            spotify_track_id=spotify_track_id,
            lyrics_text=None,
            synced_lines=None,
            sync_type="none",
            source="none",
            artist_name=artist,
            track_name=title,
        )

        return result

    async def search_songs(self, query: str, limit: int = 5) -> list[dict]:
        """Search for songs (via Genius)."""
        return await self.genius.search_songs(query, limit)

    async def invalidate_cache(self, spotify_track_id: str) -> None:
        """Invalidate cached lyrics for a track."""
        await lyrics_cache_service.invalidate(spotify_track_id)


# Singleton instance
lyrics_service = LyricsService()
