"""
YouTube service for searching and downloading audio using yt-dlp.
"""
import asyncio
import os
import re
from pathlib import Path
from typing import Any

import yt_dlp

from app.config import settings


class YouTubeService:
    """Service for YouTube search and audio download."""

    def __init__(self):
        self.output_dir = Path(settings.audio_upload_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def _get_ydl_opts(self, output_path: str) -> dict[str, Any]:
        """Get yt-dlp options for audio extraction."""
        return {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'wav',
                'preferredquality': '192',
            }],
            'outtmpl': output_path,
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
        }

    async def search(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """
        Search YouTube for videos matching query.

        Returns list of videos with id, title, duration, channel.
        """
        search_opts = {
            'quiet': False,
            'no_warnings': False,
            'extract_flat': 'in_playlist',
            'skip_download': True,
        }

        def _search():
            try:
                # Use explicit ytsearch prefix
                search_query = f"ytsearch{limit}:{query}"
                with yt_dlp.YoutubeDL(search_opts) as ydl:
                    print(f"[YouTube] Searching: {search_query}")
                    result = ydl.extract_info(search_query, download=False)
                    if not result:
                        print("[YouTube] No result returned")
                        return []

                    entries = result.get('entries', [])
                    print(f"[YouTube] Found {len(entries)} entries")
                    videos = []
                    for entry in entries:
                        if entry:
                            videos.append({
                                'id': entry.get('id'),
                                'title': entry.get('title'),
                                'duration': entry.get('duration'),
                                'channel': entry.get('channel') or entry.get('uploader'),
                                'url': f"https://www.youtube.com/watch?v={entry.get('id')}",
                            })
                    return videos
            except Exception as e:
                print(f"[YouTube] Search error: {e}")
                import traceback
                traceback.print_exc()
                return []

        return await asyncio.to_thread(_search)

    async def search_for_track(self, artist: str, title: str) -> dict[str, Any] | None:
        """
        Search YouTube for a specific track.

        Returns best match with confidence score based on duration.
        """
        query = f"{artist} {title} official audio"
        results = await self.search(query, limit=5)

        if not results:
            # Try simpler query
            query = f"{artist} {title}"
            results = await self.search(query, limit=5)

        if not results:
            return None

        # Return first result (usually most relevant)
        return results[0]

    async def download_audio(
        self,
        url: str,
        session_id: str,
        filename: str = "reference"
    ) -> Path:
        """
        Download audio from YouTube URL.

        Returns path to downloaded WAV file.
        """
        # Create session directory
        session_dir = self.output_dir / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        output_path = str(session_dir / filename)
        opts = self._get_ydl_opts(output_path)

        def _download():
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])

        await asyncio.to_thread(_download)

        # yt-dlp adds .wav extension after conversion
        wav_path = session_dir / f"{filename}.wav"
        if not wav_path.exists():
            # Try without extension (in case it wasn't converted)
            for ext in ['.wav', '.webm', '.m4a', '.mp3']:
                candidate = session_dir / f"{filename}{ext}"
                if candidate.exists():
                    return candidate
            raise FileNotFoundError(f"Downloaded file not found in {session_dir}")

        return wav_path

    async def get_video_info(self, url: str) -> dict[str, Any] | None:
        """Get video metadata without downloading."""
        opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
        }

        def _get_info():
            with yt_dlp.YoutubeDL(opts) as ydl:
                try:
                    return ydl.extract_info(url, download=False)
                except Exception:
                    return None

        info = await asyncio.to_thread(_get_info)

        if not info:
            return None

        return {
            'id': info.get('id'),
            'title': info.get('title'),
            'duration': info.get('duration'),
            'channel': info.get('channel') or info.get('uploader'),
            'thumbnail': info.get('thumbnail'),
        }

    def validate_youtube_url(self, url: str) -> bool:
        """Validate if URL is a valid YouTube URL."""
        patterns = [
            r'^https?://(?:www\.)?youtube\.com/watch\?v=[\w-]+',
            r'^https?://youtu\.be/[\w-]+',
            r'^https?://(?:www\.)?youtube\.com/shorts/[\w-]+',
        ]
        return any(re.match(pattern, url) for pattern in patterns)


# Singleton instance
youtube_service = YouTubeService()
