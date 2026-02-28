"""
Storage client (synchronous) for storages.augmenter.pro — worker Celery.

Same API as backend/app/services/storage.py but synchronous (httpx sync)
so it can be called from Celery tasks without an asyncio event loop.

Uses a persistent connection pool to avoid creating new TCP connections
for every request (which would exhaust Hostinger's process limit of ~120).

API:
  POST /api/upload.php  — X-File-Path header + Bearer auth + raw binary body
  POST /api/delete.php  — JSON body {"path": "bucket/path"}
  GET  /files/{path}    — public URL, HTTP Range supported
"""
import logging
import os
import time
import hashlib
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

_UPLOAD_TIMEOUT = 120.0    # large audio files (~50-150 MB)
_DELETE_TIMEOUT = 10.0
_EXISTS_TIMEOUT = 5.0
_DOWNLOAD_TIMEOUT = 180.0  # reference.wav can be large
_UPLOAD_ATTEMPTS = 3
_UPLOAD_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_UPLOAD_FOLLOW_REDIRECTS = os.getenv("STORAGE_UPLOAD_FOLLOW_REDIRECTS", "true").lower() in {"1", "true", "yes", "on"}

# Connection pool limits — prevents overwhelming Hostinger (120 max processes)
_MAX_CONNECTIONS = 10
_MAX_KEEPALIVE = 5


def _is_storage_url(path_or_url: str) -> bool:
    return path_or_url.startswith("http://") or path_or_url.startswith("https://")


class StorageClient:
    """Synchronous HTTP client for storages.augmenter.pro (bucket: kiaraoke).

    Uses a persistent connection pool to reuse TCP connections across requests.
    """

    def __init__(self):
        self.base_url = self._normalize_base_url(
            os.getenv("STORAGE_URL", "https://storages.augmenter.pro")
        )
        self.api_key = os.getenv("STORAGE_API_KEY", "")
        self.bucket = os.getenv("STORAGE_BUCKET", "kiaraoke")
        self._client: httpx.Client | None = None
        key_fp = hashlib.sha256(self.api_key.encode("utf-8")).hexdigest()[:10] if self.api_key else "missing"
        logger.info(
            "Storage client configured: base_url=%s bucket=%s api_key_fp=%s pool=%d/%d",
            self.base_url,
            self.bucket,
            key_fp,
            _MAX_KEEPALIVE,
            _MAX_CONNECTIONS,
        )

    def _get_client(self, follow_redirects: bool = True) -> httpx.Client:
        """Get or create the persistent HTTP client with connection pooling."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.Client(
                follow_redirects=follow_redirects,
                limits=httpx.Limits(
                    max_connections=_MAX_CONNECTIONS,
                    max_keepalive_connections=_MAX_KEEPALIVE,
                ),
            )
        return self._client

    def close(self):
        """Close the persistent HTTP client."""
        if self._client and not self._client.is_closed:
            self._client.close()
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

    def public_url(self, relative_path: str) -> str:
        """Return public URL. Accepts both relative paths and full storage URLs."""
        if _is_storage_url(relative_path):
            return relative_path
        if not relative_path.startswith(self.bucket + "/"):
            relative_path = f"{self.bucket}/{relative_path}"
        return f"{self.base_url}/files/{relative_path}"

    def storage_path(self, relative: str) -> str:
        """Return full bucket/relative path."""
        return f"{self.bucket}/{relative}"

    def upload(self, data: bytes, relative_path: str, content_type: str = "audio/wav") -> str:
        """Upload raw bytes, returns public URL."""
        full_path = self.storage_path(relative_path)
        headers = {
            **self._auth_headers(),
            "Content-Type": content_type,
            "X-File-Path": full_path,
        }
        client = self._get_client(follow_redirects=_UPLOAD_FOLLOW_REDIRECTS)
        last_exc: Exception | None = None
        for attempt in range(1, _UPLOAD_ATTEMPTS + 1):
            try:
                logger.info(
                    "Storage upload attempt %d/%d: path=%s bytes=%d follow_redirects=%s endpoint=%s",
                    attempt,
                    _UPLOAD_ATTEMPTS,
                    full_path,
                    len(data),
                    _UPLOAD_FOLLOW_REDIRECTS,
                    f"{self.base_url}/api/upload.php",
                )
                response = client.post(
                    f"{self.base_url}/api/upload.php",
                    content=data,
                    headers=headers,
                    timeout=_UPLOAD_TIMEOUT,
                )
                self._log_upload_response(response, full_path, attempt)
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
                time.sleep(backoff)
        assert last_exc is not None
        raise last_exc

    def _log_upload_response(self, response: httpx.Response, full_path: str, attempt: int) -> None:
        """Emit concise diagnostics for redirects/upstream failures."""
        history = response.history or []
        if history:
            chain = []
            for hop in history:
                location = hop.headers.get("location", "")
                chain.append(f"{hop.status_code} {hop.url} -> {location}")
            logger.info(
                "Storage upload redirect chain (attempt %d, %s): %s",
                attempt,
                full_path,
                " | ".join(chain),
            )
        logger.info(
            "Storage upload response (attempt %d, %s): status=%d final_url=%s",
            attempt,
            full_path,
            response.status_code,
            response.url,
        )

    def upload_from_file(self, local_path: Path, relative_path: str, content_type: str = "audio/wav") -> str:
        """Upload a local file to storage, returns public URL."""
        logger.info("Uploading %s → storage:%s", local_path.name, relative_path)
        data = local_path.read_bytes()
        return self.upload(data, relative_path, content_type)

    def delete(self, relative_path: str) -> None:
        """Delete a file from storage (non-fatal on error)."""
        full_path = self.storage_path(relative_path)
        headers = {**self._auth_headers(), "Content-Type": "application/json"}
        client = self._get_client()
        try:
            response = client.post(
                f"{self.base_url}/api/delete.php",
                json={"path": full_path},
                headers=headers,
                timeout=_DELETE_TIMEOUT,
            )
            if response.status_code not in (200, 204, 404):
                logger.warning("Storage delete %d for %s", response.status_code, full_path)
            else:
                logger.debug("Storage delete OK: %s", full_path)
        except Exception as e:
            logger.warning("Storage delete failed for %s (non-fatal): %s", full_path, e)

    def exists(self, relative_path: str) -> bool:
        """Check existence via HEAD request."""
        url = self.public_url(relative_path)
        client = self._get_client()
        try:
            response = client.head(url, timeout=_EXISTS_TIMEOUT)
            return response.status_code == 200
        except Exception:
            return False

    def download(self, relative_path: str) -> bytes:
        """Download file bytes from storage."""
        url = self.public_url(relative_path)
        client = self._get_client()
        response = client.get(url, timeout=_DOWNLOAD_TIMEOUT)
        response.raise_for_status()
        logger.debug("Storage download OK: %s (%d bytes)", relative_path, len(response.content))
        return response.content

    def download_to_file(self, relative_path: str, local_path: Path) -> Path:
        """Download from storage to a local path, returns local_path."""
        local_path.parent.mkdir(parents=True, exist_ok=True)
        url = self.public_url(relative_path)
        logger.info("Downloading storage:%s → %s", relative_path, local_path)
        client = self._get_client()
        with client.stream("GET", url, timeout=_DOWNLOAD_TIMEOUT) as response:
            response.raise_for_status()
            with open(local_path, "wb") as f:
                for chunk in response.iter_bytes(chunk_size=1024 * 256):
                    f.write(chunk)
        return local_path


# Module-level singleton — lazily instantiated
_client: StorageClient | None = None


def get_storage() -> StorageClient:
    global _client
    if _client is None:
        _client = StorageClient()
    return _client
