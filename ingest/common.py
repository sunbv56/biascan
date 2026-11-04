import io
import json
import os
import random
import re
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

DATASET_REPO = "sunbv56/vi-OCR_VQA-desc"
DATASET_FILE = "train.jsonl"
N_BOOKS = 33531
FIELDS = (
    "image_id",
    "title",
    "author",
    "publisher",
    "supplier",
    "description",
    "og_description",
    "product_url",
    "image_url",
)


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str
    database_url: str
    embed_model: str
    embed_dims: int


def load_settings() -> Settings:
    try:
        from dotenv import load_dotenv

        load_dotenv(HERE / ".env")
    except ImportError:
        pass
    return Settings(
        gemini_api_key=os.environ.get("GEMINI_API_KEY", ""),
        database_url=os.environ.get("DATABASE_URL", ""),
        embed_model=os.environ.get("EMBED_MODEL", "gemini-embedding-2"),
        embed_dims=int(os.environ.get("EMBED_DIMS", "768")),
    )


def require(settings: Settings, *names: str) -> None:
    missing = [n for n in names if not getattr(settings, n)]
    if missing:
        env = ", ".join(n.upper() for n in missing)
        raise SystemExit(f"Thiếu biến môi trường: {env} (điền trong ingest/.env)")


def dataset_path() -> Path:
    from huggingface_hub import hf_hub_download

    return Path(hf_hub_download(DATASET_REPO, DATASET_FILE, repo_type="dataset"))


def product_key(url: str | None) -> str:
    return (url or "").split("?", 1)[0].strip()


# Dataset gốc lặp lại cùng một sản phẩm dưới nhiều image_id (12.661 / 33.531 dòng):
# giữ lần xuất hiện đầu tiên của mỗi link sản phẩm.
def load_rows(path: Path | None = None) -> list[dict]:
    path = path or dataset_path()
    rows: list[dict] = []
    seen: set[str] = set()
    seen_products: set[str] = set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            raw = json.loads(line)
            image_id = raw.get("image_id")
            if not image_id or image_id in seen:
                continue
            seen.add(image_id)
            key = product_key(raw.get("product_url"))
            if key:
                if key in seen_products:
                    continue
                seen_products.add(key)
            rows.append({k: raw.get(k) for k in FIELDS})
    return rows


class RateLimiter:
    """Cửa sổ trượt 60 giây; mỗi lần acquire tiêu `units` đơn vị (request hoặc input)."""

    def __init__(
        self,
        per_minute: int,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.per_minute = per_minute
        self.clock = clock
        self.sleep = sleep
        self.events: deque[float] = deque()

    def acquire(self, units: int = 1) -> None:
        if self.per_minute <= 0:
            return
        units = max(1, min(units, self.per_minute))
        while True:
            now = self.clock()
            while self.events and now - self.events[0] >= 60.0:
                self.events.popleft()
            if len(self.events) + units <= self.per_minute:
                self.events.extend([now] * units)
                return
            idx = len(self.events) + units - self.per_minute - 1
            self.sleep(max(0.05, 60.0 - (now - self.events[idx])))


class QuotaExhausted(RuntimeError):
    pass


_RETRY_DELAY = re.compile(r'"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s')


def _status_code(exc: BaseException) -> int | None:
    code = getattr(exc, "code", None)
    return code if isinstance(code, int) else None


def is_retryable(exc: BaseException) -> bool:
    code = _status_code(exc)
    if code is not None:
        return code == 429 or code >= 500
    try:
        import httpx

        if isinstance(exc, httpx.TransportError):
            return True
    except ImportError:
        pass
    return isinstance(exc, (ConnectionError, TimeoutError))


def is_daily_quota(exc: BaseException) -> bool:
    if _status_code(exc) != 429:
        return False
    text = f"{getattr(exc, 'details', '')} {exc}"
    return "PerDay" in text or "per_day" in text.lower()


def retry_delay_hint(exc: BaseException) -> float | None:
    text = json.dumps(getattr(exc, "details", None), default=str) + str(exc)
    m = _RETRY_DELAY.search(text)
    return float(m.group(1)) if m else None


def call_with_retry(
    fn: Callable[[], object],
    *,
    max_retries: int = 8,
    base: float = 2.0,
    cap: float = 90.0,
    sleep: Callable[[float], None] = time.sleep,
    on_retry: Callable[[BaseException, int, float], None] | None = None,
):
    attempt = 0
    while True:
        try:
            return fn()
        except Exception as exc:
            if is_daily_quota(exc):
                raise QuotaExhausted(str(exc)) from exc
            if not is_retryable(exc) or attempt >= max_retries:
                raise
            hint = retry_delay_hint(exc)
            delay = min(cap, base * (2**attempt)) * (0.5 + random.random() / 2)
            if hint is not None:
                delay = max(delay, min(hint + 1.0, cap * 2))
            attempt += 1
            if on_retry:
                on_retry(exc, attempt, delay)
            sleep(delay)


def l2_normalize(values: Iterable[float]) -> np.ndarray:
    v = np.asarray(list(values), dtype=np.float32)
    norm = float(np.linalg.norm(v))
    return v / norm if norm > 0 else v


def supports_task_type(model: str) -> bool:
    # gemini-embedding-2 từ chối task_type (tài liệu ai.google.dev/gemini-api/docs/embeddings).
    return not model.startswith("gemini-embedding-2")


@dataclass
class EmbedResult:
    vectors: list[np.ndarray]
    token_counts: list[int | None]
    retries: int
    rate_limited: int
    elapsed_s: float


class Embedder:
    def __init__(
        self,
        client,
        model: str,
        dims: int,
        limiter: RateLimiter,
        *,
        max_retries: int = 8,
        count_items: bool = False,
        task_type: str = "RETRIEVAL_DOCUMENT",
        log: Callable[[str], None] = print,
    ):
        self.client = client
        self.model = model
        self.dims = dims
        self.limiter = limiter
        self.max_retries = max_retries
        self.count_items = count_items
        self.task_type = task_type
        self.log = log

    def _config(self):
        from google.genai import types

        kwargs = {"output_dimensionality": self.dims}
        if self.task_type and supports_task_type(self.model):
            kwargs["task_type"] = self.task_type
        return types.EmbedContentConfig(**kwargs)

    def embed_contents(self, contents: list) -> EmbedResult:
        stats = {"retries": 0, "rate_limited": 0}

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            stats["retries"] += 1
            if _status_code(exc) == 429:
                stats["rate_limited"] += 1
            self.log(f"  thử lại lần {attempt} sau {delay:.1f}s ({type(exc).__name__}: {str(exc)[:160]})")

        def call():
            self.limiter.acquire(len(contents) if self.count_items else 1)
            return self.client.models.embed_content(
                model=self.model, contents=contents, config=self._config()
            )

        t0 = time.perf_counter()
        resp = call_with_retry(call, max_retries=self.max_retries, on_retry=on_retry)
        elapsed = time.perf_counter() - t0
        embeddings = list(resp.embeddings or [])
        if len(embeddings) != len(contents):
            raise RuntimeError(f"API trả {len(embeddings)} embedding cho {len(contents)} input")
        vectors, tokens = [], []
        for e in embeddings:
            if len(e.values) != self.dims:
                raise RuntimeError(f"Embedding {len(e.values)} chiều, cần {self.dims}")
            vectors.append(l2_normalize(e.values))
            st = getattr(e, "statistics", None)
            tc = getattr(st, "token_count", None) if st else None
            tokens.append(int(tc) if tc is not None else None)
        return EmbedResult(vectors, tokens, stats["retries"], stats["rate_limited"], elapsed)

    def embed_texts(self, texts: list[str]) -> EmbedResult:
        from google.genai import types

        contents = [types.Content(parts=[types.Part.from_text(text=t)]) for t in texts]
        return self.embed_contents(contents)

    def embed_images(self, images: list[tuple[bytes, str]]) -> EmbedResult:
        from google.genai import types

        contents = [
            types.Content(parts=[types.Part.from_bytes(data=data, mime_type=mime)])
            for data, mime in images
        ]
        return self.embed_contents(contents)


def make_client(api_key: str):
    from google import genai

    return genai.Client(api_key=api_key)


def connect_db(url: str):
    import psycopg
    from pgvector.psycopg import register_vector

    conn = psycopg.connect(url, autocommit=False, prepare_threshold=None)
    register_vector(conn)
    return conn


def sniff_mime(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return None


def to_supported_image(data: bytes) -> tuple[bytes, str]:
    mime = sniff_mime(data)
    if mime:
        return data, mime
    from PIL import Image

    with Image.open(io.BytesIO(data)) as img:
        img.seek(0)
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=90)
    return buf.getvalue(), "image/jpeg"


def fetch_image(http, url: str, *, retries: int = 3) -> tuple[bytes, str]:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = http.get(url, follow_redirects=True)
            if r.status_code == 404:
                raise FileNotFoundError(f"404 {url}")
            r.raise_for_status()
            return to_supported_image(r.content)
        except FileNotFoundError:
            raise
        except Exception as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Không tải được ảnh {url}: {last}")


def make_http():
    import httpx

    return httpx.Client(
        timeout=httpx.Timeout(30.0),
        headers={"User-Agent": "BiaScan-ingest/1.0 (+github.com/sunbv56/biascan)"},
    )


def chunks(items: list, size: int) -> Iterable[list]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    return float(np.percentile(np.asarray(values, dtype=np.float64), p))
