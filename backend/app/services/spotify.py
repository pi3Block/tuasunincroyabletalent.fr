"""
Spotify API service for track search and metadata.
Uses Client Credentials flow (no user login required).
"""
import base64
from datetime import datetime, timedelta
from typing import Any

import httpx

from app.config import settings


class SpotifyService:
    """Spotify API client using Client Credentials flow."""

    TOKEN_URL = "https://accounts.spotify.com/api/token"
    API_BASE = "https://api.spotify.com/v1"

    def __init__(self):
        self._token: str | None = None
        self._token_expires: datetime | None = None

    async def _get_token(self) -> str:
        """Get or refresh access token."""
        if self._token and self._token_expires and datetime.now() < self._token_expires:
            return self._token

        # Encode credentials
        credentials = f"{settings.spotify_client_id}:{settings.spotify_client_secret}"
        encoded = base64.b64encode(credentials.encode()).decode()

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.TOKEN_URL,
                headers={
                    "Authorization": f"Basic {encoded}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "client_credentials"},
            )
            response.raise_for_status()
            data = response.json()

        self._token = data["access_token"]
        # Token expires in 3600s, refresh 5 min before
        self._token_expires = datetime.now() + timedelta(seconds=data["expires_in"] - 300)

        return self._token

    async def _request(self, method: str, endpoint: str, **kwargs) -> dict[str, Any]:
        """Make authenticated request to Spotify API."""
        token = await self._get_token()

        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                f"{self.API_BASE}{endpoint}",
                headers={"Authorization": f"Bearer {token}"},
                **kwargs,
            )
            response.raise_for_status()
            return response.json()

    async def search_tracks(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        """
        Search for tracks on Spotify.

        Returns list of tracks with:
        - id: Spotify track ID
        - name: Track name
        - artists: List of artist names
        - album: Album name and image
        - duration_ms: Duration in milliseconds
        - preview_url: 30s preview URL (if available)
        """
        data = await self._request(
            "GET",
            "/search",
            params={
                "q": query,
                "type": "track",
                "limit": limit,
                "market": "FR",
            },
        )

        tracks = []
        for item in data.get("tracks", {}).get("items", []):
            # Get album image (prefer 300x300)
            images = item.get("album", {}).get("images", [])
            image_url = None
            for img in images:
                if img.get("height") == 300:
                    image_url = img["url"]
                    break
            if not image_url and images:
                image_url = images[0]["url"]

            tracks.append({
                "id": item["id"],
                "name": item["name"],
                "artists": [artist["name"] for artist in item.get("artists", [])],
                "album": {
                    "name": item.get("album", {}).get("name"),
                    "image": image_url,
                },
                "duration_ms": item.get("duration_ms", 0),
                "preview_url": item.get("preview_url"),
                "external_url": item.get("external_urls", {}).get("spotify"),
            })

        return tracks

    async def get_track(self, track_id: str) -> dict[str, Any] | None:
        """Get track details by Spotify ID."""
        try:
            item = await self._request("GET", f"/tracks/{track_id}")

            images = item.get("album", {}).get("images", [])
            image_url = images[0]["url"] if images else None

            return {
                "id": item["id"],
                "name": item["name"],
                "artists": [artist["name"] for artist in item.get("artists", [])],
                "album": {
                    "name": item.get("album", {}).get("name"),
                    "image": image_url,
                },
                "duration_ms": item.get("duration_ms", 0),
                "preview_url": item.get("preview_url"),
                "external_url": item.get("external_urls", {}).get("spotify"),
            }
        except httpx.HTTPStatusError:
            return None


# Singleton instance
spotify_service = SpotifyService()
