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

    # Lua script for atomic JSON merge — runs entirely inside Redis (no race window)
    _UPDATE_LUA = """
    local key = KEYS[1]
    local updates_json = ARGV[1]
    local fallback_ttl = tonumber(ARGV[2])
    local current = redis.call('GET', key)
    if not current then return 0 end
    local data = cjson.decode(current)
    local updates = cjson.decode(updates_json)
    for k, v in pairs(updates) do data[k] = v end
    local ttl = redis.call('TTL', key)
    if ttl < 1 then ttl = fallback_ttl end
    redis.call('SETEX', key, ttl, cjson.encode(data))
    return 1
    """

    async def update_session(self, session_id: str, updates: dict[str, Any]) -> bool:
        """Atomically merge updates into session JSON, preserving TTL."""
        client = await self.get_client()
        key = f"session:{session_id}"
        result = await client.eval(
            self._UPDATE_LUA, 1, key,
            json.dumps(updates, ensure_ascii=False), 3600,
        )
        return result == 1

    async def delete_session(self, session_id: str) -> None:
        """Delete session data."""
        client = await self.get_client()
        await client.delete(f"session:{session_id}")


# Singleton instance
redis_client = RedisClient()
