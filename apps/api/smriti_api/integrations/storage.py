"""Object storage (TRD §8): Cloudflare R2 through its S3 API, or a local folder for development.

Buckets are named by role: ``uploads`` (private, signed URLs: PDF books, doubt photos) and
``assets`` (public through the CDN: generated images). ``R2Storage`` signs requests with AWS
Signature V4 (R2 accepts region ``auto``); ``LocalStorage`` writes under one folder and signs
download links with an HMAC that the dev-only file route checks.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import hmac
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol
from urllib.parse import quote

import httpx

Bucket = Literal["uploads", "assets"]


class StorageError(Exception):
    pass


@dataclass(frozen=True)
class StoredObject:
    bucket: Bucket
    key: str
    bytes: int
    sha256: str


class ObjectStorage(Protocol):
    name: str

    async def put(
        self, bucket: Bucket, key: str, data: bytes, content_type: str
    ) -> StoredObject: ...

    async def get(self, bucket: Bucket, key: str) -> bytes: ...

    def signed_url(self, bucket: Bucket, key: str, ttl_s: int) -> str: ...


def _safe_key(key: str) -> str:
    if not key or key.startswith("/") or ".." in key.split("/") or "\\" in key:
        raise StorageError("invalid object key")
    return key


class LocalStorage:
    name = "local"

    def __init__(self, root: Path, *, public_base_url: str, signing_key: bytes) -> None:
        self.root = root
        self._base = public_base_url.rstrip("/")
        self._key = signing_key

    def path(self, bucket: Bucket, key: str) -> Path:
        return self.root / bucket / _safe_key(key)

    async def put(self, bucket: Bucket, key: str, data: bytes, content_type: str) -> StoredObject:
        path = self.path(bucket, key)

        def write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

        await asyncio.to_thread(write)
        return StoredObject(bucket, key, len(data), hashlib.sha256(data).hexdigest())

    async def get(self, bucket: Bucket, key: str) -> bytes:
        path = self.path(bucket, key)
        try:
            return await asyncio.to_thread(path.read_bytes)
        except FileNotFoundError as exc:
            raise StorageError("not found") from exc

    def signature(self, bucket: str, key: str, expires: int) -> str:
        msg = f"{bucket}/{key}:{expires}".encode()
        return hmac.new(self._key, msg, hashlib.sha256).hexdigest()

    def verify(self, bucket: str, key: str, expires: int, sig: str) -> bool:
        if expires < int(time.time()):
            return False
        return hmac.compare_digest(self.signature(bucket, key, expires), sig)

    def signed_url(self, bucket: Bucket, key: str, ttl_s: int) -> str:
        expires = int(time.time()) + ttl_s
        sig = self.signature(bucket, key, expires)
        return f"{self._base}/v1/dev/files/{bucket}/{quote(key)}?expires={expires}&sig={sig}"


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


class R2Storage:
    """S3-compatible requests to ``https://<account>.r2.cloudflarestorage.com``."""

    name = "r2"
    region = "auto"
    service = "s3"

    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        endpoint: str,
        access_key_id: str,
        secret_access_key: str,
        buckets: dict[Bucket, str],
    ) -> None:
        self._http = http
        self._endpoint = endpoint.rstrip("/")
        self._host = httpx.URL(self._endpoint).host
        self._access = access_key_id
        self._secret = secret_access_key
        self._buckets = buckets

    def _path(self, bucket: Bucket, key: str) -> str:
        return f"/{self._buckets[bucket]}/{quote(_safe_key(key), safe='/')}"

    def _signing_key(self, day: str) -> bytes:
        k = _hmac(f"AWS4{self._secret}".encode(), day)
        k = _hmac(k, self.region)
        k = _hmac(k, self.service)
        return _hmac(k, "aws4_request")

    def _auth_headers(
        self, method: str, path: str, payload_hash: str, now: dt.datetime, extra: dict[str, str]
    ) -> dict[str, str]:
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        day = now.strftime("%Y%m%d")
        headers = {"host": self._host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
        headers.update({k.lower(): v for k, v in extra.items()})
        signed = ";".join(sorted(headers))
        canonical = "\n".join(
            [
                method,
                path,
                "",
                "".join(f"{k}:{headers[k].strip()}\n" for k in sorted(headers)),
                signed,
                payload_hash,
            ]
        )
        scope = f"{day}/{self.region}/{self.service}/aws4_request"
        to_sign = "\n".join(
            ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()]
        )
        signature = hmac.new(self._signing_key(day), to_sign.encode(), hashlib.sha256).hexdigest()
        headers["authorization"] = (
            f"AWS4-HMAC-SHA256 Credential={self._access}/{scope}, SignedHeaders={signed},"
            f" Signature={signature}"
        )
        headers.pop("host")
        return headers

    async def put(self, bucket: Bucket, key: str, data: bytes, content_type: str) -> StoredObject:
        path = self._path(bucket, key)
        digest = hashlib.sha256(data).hexdigest()
        headers = self._auth_headers(
            "PUT", path, digest, dt.datetime.now(dt.UTC), {"content-type": content_type}
        )
        try:
            r = await self._http.put(
                f"{self._endpoint}{path}", content=data, headers=headers, timeout=60
            )
        except httpx.HTTPError as exc:
            raise StorageError(f"r2 unreachable: {type(exc).__name__}") from exc
        if r.status_code >= 300:
            raise StorageError(f"r2 put status {r.status_code}")
        return StoredObject(bucket, key, len(data), digest)

    async def get(self, bucket: Bucket, key: str) -> bytes:
        path = self._path(bucket, key)
        headers = self._auth_headers(
            "GET", path, hashlib.sha256(b"").hexdigest(), dt.datetime.now(dt.UTC), {}
        )
        r = await self._http.get(f"{self._endpoint}{path}", headers=headers, timeout=60)
        if r.status_code == 404:
            raise StorageError("not found")
        if r.status_code >= 300:
            raise StorageError(f"r2 get status {r.status_code}")
        return r.content

    def signed_url(self, bucket: Bucket, key: str, ttl_s: int) -> str:
        """A presigned GET (query-string SigV4), valid for ``ttl_s`` seconds (max 7 days)."""
        now = dt.datetime.now(dt.UTC)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        day = now.strftime("%Y%m%d")
        scope = f"{day}/{self.region}/{self.service}/aws4_request"
        path = self._path(bucket, key)
        params = {
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": f"{self._access}/{scope}",
            "X-Amz-Date": amz_date,
            "X-Amz-Expires": str(min(max(ttl_s, 1), 604800)),
            "X-Amz-SignedHeaders": "host",
        }
        query = "&".join(
            f"{quote(k, safe='')}={quote(v, safe='')}" for k, v in sorted(params.items())
        )
        canonical = "\n".join(
            ["GET", path, query, f"host:{self._host}\n", "host", "UNSIGNED-PAYLOAD"]
        )
        to_sign = "\n".join(
            ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()]
        )
        signature = hmac.new(self._signing_key(day), to_sign.encode(), hashlib.sha256).hexdigest()
        return f"{self._endpoint}{path}?{query}&X-Amz-Signature={signature}"
