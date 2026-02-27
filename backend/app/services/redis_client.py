"""
Redis client for session state management.
"""
import json
from typing import Any

import redis.asyncio as redis

from app.config import settings


class RedisClient:
    """Async Redis client for session management."""

    def __init__(self):
        self._client: redis.Redis | None = None

    async def get_client(self) -> redis.Redis:
        """Get or create Redis connection with connection pooling."""
        if self._client is None:
            self._client = redis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
                max_connections=20,
                socket_connect_timeout=5,
                socket_keepalive=True,
            )
        return self._client

    async def close(self):
        """Close Redis connection."""
        if self._client:
            await self._client.close()
            self._client = None

    # Session operations
    async def set_session(self, session_id: str, data: dict[str, Any], ttl: int = 3600) -> None:
        """Store session data with TTL (default 1 hour)."""
        client = await self.get_client()
        await client.setex(
            f"session:{session_id}",
            ttl,
            json.dumps(data),
        )

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        """Retrieve session data."""
        client = await self.get_client()
        data = await client.get(f"session:{session_id}")
        if data:
            return json.loads(data)
        return None

    async def update_session(self, session_id: str, updates: dict[str, Any]) -> bool:
        """Update existing session data, preserving the current TTL."""
        client = await self.get_client()
        key = f"session:{session_id}"
        current = await self.get_session(session_id)
        if current is None:
            return False
        # Preserve remaining TTL (avoid resetting 3h → 1h on every update)
        remaining_ttl = await client.ttl(key)
        if remaining_ttl < 0:
            remaining_ttl = 3600  # fallback 1h if no TTL set
        current.update(updates)
        await client.setex(key, remaining_ttl, json.dumps(current))
        return True

    async def delete_session(self, session_id: str) -> None:
        """Delete session data."""
        client = await self.get_client()
        await client.delete(f"session:{session_id}")


# Singleton instance
redis_client = RedisClient()
