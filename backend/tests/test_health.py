"""
Tests for health check and root endpoints.
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport

from app.main import app


async def test_root():
    """Root endpoint should return service name."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "incroyable talent" in data["service"]


async def test_health_all_healthy():
    """Health check should return healthy when all services are up."""
    mock_redis_client = AsyncMock()
    mock_redis_client.get_client.return_value = mock_redis_client
    mock_redis_client.ping.return_value = True

    mock_db_session = AsyncMock()

    with (
        patch("app.main.redis_client", mock_redis_client, create=True),
        patch("app.services.redis_client.redis_client", mock_redis_client),
        patch("app.services.database.get_db") as mock_get_db,
    ):
        mock_get_db.return_value.__aenter__ = AsyncMock(return_value=mock_db_session)
        mock_get_db.return_value.__aexit__ = AsyncMock(return_value=False)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/health")

    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == "0.1.0"
    assert data["services"]["api"] is True


async def test_health_returns_version():
    """Health check should always include version."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert "version" in resp.json()
    assert resp.json()["version"] == "0.1.0"
