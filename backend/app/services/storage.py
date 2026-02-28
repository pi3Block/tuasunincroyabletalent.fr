"""
Storage client for storages.augmenter.pro.

API compatible with the Augmenter project:
  POST /api/upload.php  — upload raw binary (X-File-Path header, Bearer auth)
  POST /api/delete.php  — delete by path (JSON body)
  GET  /files/{path}    — public URL (HTTP Range supported → use for 302 redirects)

Uses a persistent connection pool to avoid creating new TCP connections
for every request (which would exhaust Hostinger's process limit of ~120).
"""
import logging
import asyncio
import hashlib
from pathlib import Path

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_UPLOAD_TIMEOUT = 60.0   # large audio files
_DELETE_TIMEOUT = 10.0
_EXISTS_TIMEOUT = 5.0
_DOWNLOAD_TIMEOUT = 120.0
_UPLOAD_ATTEMPTS = 3
_UPLOAD_RETRYABLE_STATUS = {429, 500, 502, 503, 504}

# Connection pool limits — prevents overwhelming Hostinger (120 max processes)
_MAX_CONNECTIONS = 10
_MAX_KEEPALIVE = 5


def _is_storage_url(path_or_url: str) -> bool:
    """Detect if a value is a remote storage URL vs a local path."""
    return path_or_url.startswith("http://") or path_or_url.startswith("https://")


class StorageClient:
    """Async HTTP client for storages.augmenter.pro (bucket: kiaraoke).

    Uses a persistent connection pool to reuse TCP connections across requests.
    """

    def __init__(self):
        self.base_url = self._normalize_base_url(settings.storage_url)
        self.api_key = settings.storage_api_key
        self.bucket = settings.storage_bucket
        self._client: httpx.AsyncClient | None = None
        key_fp = hashlib.sha256(self.api_key.encode("utf-8")).hexdigest()[:10] if self.api_key else "missing"
        logger.info(
            "Storage client configured: base_url=%s bucket=%s api_key_fp=%s pool=%d/%d",
            self.base_url,
            self.bucket,
            key_fp,
            _MAX_KEEPALIVE,
            _MAX_CONNECTIONS,
        )

    def _get_client(self) -> httpx.AsyncClient:
        """Get or create the persistent HTTP client with connection pooling."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                follow_redirects=True,
                limits=httpx.Limits(
                    max_connections=_MAX_CONNECTIONS,
                    max_keepalive_connections=_MAX_KEEPALIVE,
                ),
            )
        return self._client

    async def close(self):
        """Close the persistent HTTP client (call on app shutdown)."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
            logger.info("Storage client connection pool closed")

    @staticmethod
    def _normalize_base_url(raw_url: str) -> str:
        url = raw_url.rstrip("/")
        if url.endswith("/api"):
            url = url[:-4]
        return url

    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"}

    def public_url(self, storage_path: str) -> str:
        """Return public URL for a storage path (bucket already included if needed)."""
        if _is_storage_url(storage_path):
            return storage_path
        if not storage_path.startswith(self.bucket + "/"):
            storage_path = f"{self.bucket}/{storage_path}"
        return f"{self.base_url}/files/{storage_path}"

    def storage_path(self, relative: str) -> str:
        """Return full bucket/relative path from a relative path."""
        return f"{self.bucket}/{relative}"

    async def upload(self, data: bytes, relative_path: str, content_type: str = "audio/wav") -> str:
        """Upload raw bytes to storage, returns public URL."""
        full_path = self.storage_path(relative_path)
        headers = {
            **self._auth_headers(),
            "Content-Type": content_type,
            "X-File-Path": full_path,
        }
        client = self._get_client()
        last_exc: Exception | None = None
        for attempt in range(1, _UPLOAD_ATTEMPTS + 1):
            try:
                response = await client.post(
                    f"{self.base_url}/api/upload.php",
                    content=data,
                    headers=headers,
                    timeout=_UPLOAD_TIMEOUT,
                )
                if response.status_code in _UPLOAD_RETRYABLE_STATUS:
                    raise httpx.HTTPStatusError(
                        f"Retryable status {response.status_code}",
                        request=response.request,
                        response=response,
                    )
                response.raise_for_status()
                result = response.json()
                url = result.get("url") or self.public_url(full_path)
                logger.info("Storage upload OK: %s (%d bytes)", full_path, len(data))
                return url
            except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as e:
                last_exc = e
                retryable = not isinstance(e, httpx.HTTPStatusError) or (
                    e.response is not None and e.response.status_code in _UPLOAD_RETRYABLE_STATUS
                )
                if not retryable or attempt == _UPLOAD_ATTEMPTS:
                    logger.error("Storage upload failed for %s: %s", full_path, e)
                    raise
                backoff = 1.5 * (2 ** (attempt - 1))
                logger.warning(
                    "Storage upload retry %d/%d for %s after %.1fs (%s)",
                    attempt + 1, _UPLOAD_ATTEMPTS, full_path, backoff, e,
                )
                await asyncio.sleep(backoff)
        assert last_exc is not None
        raise last_exc

    async def upload_file(self, local_path: Path, relative_path: str, content_type: str = "audio/wav") -> str:
        """Upload a local file to storage, returns public URL."""
        data = local_path.read_bytes()
        return await self.upload(data, relative_path, content_type)

    async def delete(self, relative_path: str) -> None:
        """Delete a file from storage (non-fatal on error)."""
        full_path = self.storage_path(relative_path)
        headers = {**self._auth_headers(), "Content-Type": "application/json"}
        client = self._get_client()
        try:
            response = await client.post(
                f"{self.base_url}/api/delete.php",
                json={"path": full_path},
                headers=headers,
                timeout=_DELETE_TIMEOUT,
            )
            if response.status_code not in (200, 204, 404):
                logger.warning("Storage delete returned %d for %s", response.status_code, full_path)
            else:
                logger.debug("Storage delete OK: %s", full_path)
        except Exception as e:
            logger.warning("Storage delete failed for %s (non-fatal): %s", full_path, e)

    async def exists(self, relative_path: str) -> bool:
        """Check if a file exists in storage via HEAD request."""
        url = self.public_url(relative_path)
        client = self._get_client()
        try:
            response = await client.head(url, timeout=_EXISTS_TIMEOUT)
            return response.status_code == 200
        except Exception:
            return False

    async def download(self, relative_path: str) -> bytes:
        """Download file content from storage."""
        url = self.public_url(relative_path)
        client = self._get_client()
        response = await client.get(url, timeout=_DOWNLOAD_TIMEOUT)
        response.raise_for_status()
        return response.content

    async def download_to_file(self, relative_path: str, local_path: Path) -> Path:
        """Download from storage to a local file, returns local_path."""
        local_path.parent.mkdir(parents=True, exist_ok=True)
        data = await self.download(relative_path)
        local_path.write_bytes(data)
        logger.debug("Storage download OK: %s → %s", relative_path, local_path)
        return local_path


# Singleton — import and use directly
storage = StorageClient()
