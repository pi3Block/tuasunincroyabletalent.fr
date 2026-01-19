"""
Unified lyrics service with hierarchical provider chain.

Provider priority:
1. Cache (Redis → PostgreSQL)
2. Spotify Synced Lyrics (if sp_dc configured)
3. Genius Plain Text Lyrics

All results are cached for subsequent requests.
"""
import re
import asyncio
from typing import Optional
import lyricsgenius

from app.config import settings
from app.services.lyrics_cache import lyrics_cache_service


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


class SpotifyLyricsProvider:
    """
    Spotify synced lyrics provider.
    Uses Spotify's internal API with sp_dc cookie authentication.

    Note: This is an undocumented API and may break without notice.
    """

    LYRICS_API_URL = "https://spclient.wg.spotify.com/color-lyrics/v2/track/{track_id}"

    def __init__(self):
        self._sp_dc: str | None = None

    def is_configured(self) -> bool:
        """Check if Spotify synced lyrics is configured."""
        return bool(getattr(settings, 'spotify_sp_dc', None))

    async def get_synced_lyrics(self, spotify_track_id: str) -> dict:
        """
        Fetch synced lyrics from Spotify's internal API.

        Args:
            spotify_track_id: Spotify track ID

        Returns:
            dict with text, lines, source, syncType, status
        """
        if not self.is_configured():
            return {
                "text": "",
                "lines": None,
                "source": "none",
                "syncType": "none",
                "status": "error",
                "error": "Spotify sp_dc not configured",
            }

        try:
            import httpx

            sp_dc = settings.spotify_sp_dc
            url = self.LYRICS_API_URL.format(track_id=spotify_track_id)

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "App-Platform": "WebPlayer",
                        "Authorization": f"Bearer {await self._get_access_token(sp_dc)}",
                    },
                    timeout=10.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    return self._parse_response(data)
                elif response.status_code == 401:
                    print("[SpotifyLyrics] sp_dc cookie expired or invalid")
                    return {
                        "text": "",
                        "lines": None,
                        "source": "none",
                        "syncType": "none",
                        "status": "error",
                        "error": "Spotify authentication expired",
                    }
                else:
                    print(f"[SpotifyLyrics] API error: {response.status_code}")
                    return {
                        "text": "",
                        "lines": None,
                        "source": "none",
                        "syncType": "none",
                        "status": "not_found",
                    }

        except Exception as e:
            print(f"[SpotifyLyrics] Error: {e}")
            return {
                "text": "",
                "lines": None,
                "source": "none",
                "syncType": "none",
                "status": "error",
                "error": str(e),
            }

    async def _get_access_token(self, sp_dc: str) -> str:
        """
        Get Spotify Web API access token using sp_dc cookie.
        """
        import httpx

        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
                cookies={"sp_dc": sp_dc},
                timeout=10.0,
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("accessToken", "")
            return ""

    def _parse_response(self, data: dict) -> dict:
        """Parse Spotify lyrics API response."""
        lyrics = data.get("lyrics", {})
        sync_type = lyrics.get("syncType", "UNSYNCED")

        lines = []
        plain_text_lines = []

        for line in lyrics.get("lines", []):
            words = line.get("words", "")
            start_time_ms = int(line.get("startTimeMs", 0))
            end_time_ms = int(line.get("endTimeMs", 0)) if line.get("endTimeMs") else None

            if words.strip():
                lines.append({
                    "text": words,
                    "startTimeMs": start_time_ms,
                    "endTimeMs": end_time_ms,
                })
                plain_text_lines.append(words)

        return {
            "text": "\n".join(plain_text_lines),
            "lines": lines if sync_type == "LINE_SYNCED" else None,
            "source": "spotify",
            "syncType": "synced" if sync_type == "LINE_SYNCED" else "unsynced",
            "status": "found" if lines else "not_found",
        }


class LyricsService:
    """
    Unified lyrics service with caching and provider chain.

    Priority:
    1. Cache (Redis → PostgreSQL)
    2. Spotify Synced (if configured)
    3. Genius Plain Text
    """

    def __init__(self):
        self.genius = GeniusLyricsProvider()
        self.spotify = SpotifyLyricsProvider()

    async def get_lyrics(
        self,
        spotify_track_id: str,
        artist: str,
        title: str,
    ) -> dict:
        """
        Get lyrics with hierarchical provider chain and caching.

        Args:
            spotify_track_id: Spotify track ID (for cache key and Spotify API)
            artist: Artist name (for Genius fallback)
            title: Song title (for Genius fallback)

        Returns:
            dict with:
                - lyrics: Plain text lyrics
                - lines: Synced lyrics array (if available)
                - syncType: 'synced', 'unsynced', or 'none'
                - source: 'spotify', 'genius', or 'none'
                - status: 'found', 'not_found', or 'error'
                - url: Source URL (if available)
                - cachedAt: Cache timestamp (if cached)
        """
        # 1. Check cache first
        cached = await lyrics_cache_service.get(spotify_track_id)
        if cached:
            return cached

        # 2. Try Spotify synced lyrics (if configured)
        if self.spotify.is_configured():
            result = await self.spotify.get_synced_lyrics(spotify_track_id)
            if result["status"] == "found":
                # Cache the result
                await lyrics_cache_service.set(
                    spotify_track_id=spotify_track_id,
                    lyrics_text=result.get("text"),
                    synced_lines=result.get("lines"),
                    sync_type=result.get("syncType", "none"),
                    source=result.get("source", "spotify"),
                    source_url=result.get("url"),
                    artist_name=artist,
                    track_name=title,
                )
                return result

        # 3. Fallback to Genius
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
