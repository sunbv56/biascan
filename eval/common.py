import json
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
DATA_DIR = EVAL_DIR / "data"
OUT_DIR = EVAL_DIR / "out"
DEFAULT_RESULTS = EVAL_DIR.parent / "web" / "public" / "eval" / "results.json"

HF_REPO = "sunbv56/vi-OCR_VQA-desc"
HF_FILE = "train.jsonl"
N_BOOKS = 33531
SETS = ("image_aug", "text_query", "real_photo")
MODES = ("text", "image", "hybrid")


def load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(EVAL_DIR / ".env")


@dataclass
class Settings:
    gemini_api_key: str
    database_url: str
    embed_model: str
    embed_dims: int
    ocr_model: str
    chat_model: str
    embed_task_type: str
    n8n_base_url: str
    biascan_token: str


def settings() -> Settings:
    load_env()
    ocr = os.getenv("OCR_MODEL", "gemini-flash-latest")
    return Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
        database_url=os.getenv("DATABASE_URL", ""),
        embed_model=os.getenv("EMBED_MODEL", "gemini-embedding-2"),
        embed_dims=int(os.getenv("EMBED_DIMS", "768")),
        ocr_model=ocr,
        chat_model=os.getenv("CHAT_MODEL", ocr),
        embed_task_type=os.getenv("EMBED_QUERY_TASK_TYPE", "RETRIEVAL_QUERY"),
        n8n_base_url=os.getenv("N8N_BASE_URL", "").rstrip("/"),
        biascan_token=os.getenv("BIASCAN_TOKEN", ""),
    )


def dataset_path() -> Path:
    local = os.getenv("BIASCAN_DATASET_JSONL")
    if local:
        return Path(local)
    from huggingface_hub import hf_hub_download

    return Path(hf_hub_download(HF_REPO, HF_FILE, repo_type="dataset"))


def load_books(path: Path | None = None) -> list[dict]:
    keep = ("image_id", "title", "author", "publisher", "supplier", "description", "image_url")
    books = []
    with open(path or dataset_path(), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                row = json.loads(line)
                books.append({k: row.get(k) or "" for k in keep})
    books.sort(key=lambda b: b["image_id"])
    return books


def sample(books: list[dict], seed: int) -> list[dict]:
    shuffled = list(books)
    random.Random(seed).shuffle(shuffled)
    return shuffled


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def is_rate_limit_error(exc: Exception) -> bool:
    msg = str(exc)
    return "429" in msg or "RESOURCE_EXHAUSTED" in msg or "rate" in msg.lower()


def with_retry(fn, *, attempts: int = 5, base_wait: float = 10.0, sleep=time.sleep):
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            if i == attempts - 1 or not is_rate_limit_error(exc):
                raise
            sleep(base_wait * (2**i))


class Throttle:
    def __init__(self, min_interval: float, clock=time.monotonic, sleep=time.sleep):
        self.min_interval = min_interval
        self._clock, self._sleep = clock, sleep
        self._last = None

    def wait(self) -> None:
        if self._last is not None and self.min_interval > 0:
            gap = self.min_interval - (self._clock() - self._last)
            if gap > 0:
                self._sleep(gap)
        self._last = self._clock()
