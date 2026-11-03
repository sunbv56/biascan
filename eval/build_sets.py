"""Tạo bộ đánh giá: image_aug, text_query, real_photo (xem README)."""

import argparse
import io
import random
import re
import sys
from pathlib import Path

from common import CATALOG_MAX, DATA_DIR, load_books, read_jsonl, sample, settings, write_jsonl
from textnorm import normalize

DEFAULT_SEED = 20261103
GENERIC_AUTHORS = {"nhieu tac gia", "nhieu tac gia khac", "nhieu dich gia", "khuyet danh", "nhom tac gia"}
TEXT_PROMPT = """Bạn đóng vai một người đang tìm mua sách trên Fahasa. Dựa vào phần giới thiệu bên dưới,
viết ĐÚNG MỘT câu tiếng Việt tự nhiên (12–30 từ) mô tả nhu cầu, bắt đầu bằng "Sách về".
Bắt buộc:
- KHÔNG nhắc tên sách, KHÔNG nhắc tên tác giả, tên nhân vật riêng hay tên bộ truyện.
- Diễn đạt bằng chủ đề, nội dung, đối tượng người đọc, cảm xúc mà sách mang lại.
- Chỉ trả về câu đó, không ngoặc kép, không giải thích.
Từ cấm (không được xuất hiện, kể cả viết không dấu): {forbidden}
{extra}
Giới thiệu sách:
{description}
"""


def _contains_phrase(haystack: str, needle: str) -> bool:
    return bool(needle) and re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", haystack) is not None


def main_title(title: str) -> str:
    return re.split(r"\s+-\s+|:|\(|\btập\b|\btap\b", title, maxsplit=1, flags=re.IGNORECASE)[0].strip()


def author_names(author: str) -> list[str]:
    names = []
    for part in re.split(r",|;|&|\s+và\s+|\s+-\s+", author or ""):
        n = normalize(part)
        if len(n) >= 4 and n not in GENERIC_AUTHORS:
            names.append(n)
    return names


def find_violations(query: str, title: str, author: str) -> list[str]:
    q = normalize(query)
    bad = []
    t = normalize(title)
    if len(t) >= 4 and _contains_phrase(q, t):
        bad.append(f"chứa tên sách: {t}")
    mt = normalize(main_title(title))
    if len(mt) >= 4 and mt != t and _contains_phrase(q, mt):
        bad.append(f"chứa tên sách (phần chính): {mt}")
    words, q_words = re.findall(r"\w+", t), " ".join(re.findall(r"\w+", q))
    for i in range(len(words) - 3):
        gram = " ".join(words[i : i + 4])
        if _contains_phrase(q_words, gram):
            bad.append(f"chứa 4 từ liền của tên sách: {gram}")
            break
    for name in author_names(author):
        if _contains_phrase(q, name):
            bad.append(f"chứa tên tác giả: {name}")
    return bad


def clean_description(title: str, description: str, limit: int = 2000) -> str:
    lines = (description or "").strip().splitlines()
    if lines and normalize(lines[0]) == normalize(title):
        lines = lines[1:]
    return "\n".join(lines).strip()[:limit]


def tidy_query(raw: str) -> str:
    line = next((ln for ln in raw.strip().splitlines() if ln.strip()), "")
    return line.strip().strip('"“”').strip()


def mock_generate(prompt: str) -> str:
    desc = prompt.split("Giới thiệu sách:", 1)[1].split()
    return "Sách về " + " ".join(desc[:14]).lower()


def build_text_query(books, n, seed, out_dir: Path, generate, log=print):
    from common import QuotaStop

    manifest, rejected_path = out_dir / "manifest.jsonl", out_dir / "rejected.jsonl"
    rows, rejected = read_jsonl(manifest), read_jsonl(rejected_path)
    done = {r["expected_id"] for r in rows}
    gave_up = {r["expected_id"] for r in rejected if r.get("attempt") == 2}
    if rows:
        log(f"text_query: chạy tiếp từ {len(rows)} câu đã có trong {manifest}")
    pool = [b for b in sample(books, seed + 1) if len(clean_description(b["title"], b["description"])) >= 150]
    stopped = None
    for book in pool:
        if len(rows) >= n or stopped:
            break
        if book["image_id"] in done or book["image_id"] in gave_up:
            continue
        desc = clean_description(book["title"], book["description"])
        forbidden = [book["title"], main_title(book["title"])] + [
            a.strip() for a in re.split(r",|;|&", book["author"]) if a.strip()
        ]
        extra = ""
        for attempt in range(2):
            prompt = TEXT_PROMPT.format(
                forbidden="; ".join(dict.fromkeys(f for f in forbidden if f)), extra=extra, description=desc
            )
            try:
                query = tidy_query(generate(prompt))
            except QuotaStop as exc:
                stopped = str(exc)
                break
            except Exception as exc:  # noqa: BLE001
                rejected.append({"expected_id": book["image_id"], "query": None, "reasons": [f"lỗi gọi model: {exc}"]})
                break
            reasons = find_violations(query, book["title"], book["author"])
            if not query or len(query) > 400:
                reasons.append("câu rỗng hoặc quá dài")
            if not reasons:
                rows.append({"query": query, "expected_id": book["image_id"]})
                break
            rejected.append({"expected_id": book["image_id"], "query": query, "reasons": reasons, "attempt": attempt + 1})
            extra = "Lần trước bạn vi phạm (" + "; ".join(reasons) + "). Viết lại, tránh hoàn toàn các từ cấm."
        write_jsonl(manifest, rows)
        write_jsonl(rejected_path, rejected)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(manifest, rows)
    write_jsonl(rejected_path, rejected)
    log(f"text_query: {len(rows)} câu hợp lệ, {len(rejected)} lần bị loại → {out_dir}")
    if stopped:
        log(f"DỪNG vì hết quota: {stopped}. Chạy lại lệnh sau để làm tiếp.")
    if len(rows) < n:
        log(f"CẢNH BÁO: chỉ được {len(rows)}/{n}")
    return rows, rejected


def fetch_cover(url: str, cache_dir: Path, image_id: str, session) -> bytes:
    cached = cache_dir / f"{image_id}.img"
    if cached.exists() and cached.stat().st_size > 0:
        return cached.read_bytes()
    resp = session.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0 (BiaScan eval)"})
    resp.raise_for_status()
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(resp.content)
    return resp.content


def build_image_aug(books, n, seed, out_dir: Path, fetch, log=print):
    from PIL import Image

    from augment import phone_like

    out_dir.mkdir(parents=True, exist_ok=True)
    rows, failed = [], []
    for book in sample(books, seed):
        if len(rows) >= n:
            break
        if not book["image_url"]:
            continue
        try:
            img = Image.open(io.BytesIO(fetch(book)))
            img.load()
            data, params = phone_like(img, random.Random(f"{seed}:{book['image_id']}"))
        except Exception as exc:  # noqa: BLE001
            failed.append({"expected_id": book["image_id"], "error": str(exc)[:200]})
            continue
        name = f"{book['image_id']}.jpg"
        (out_dir / name).write_bytes(data)
        rows.append({"query_image": name, "expected_id": book["image_id"], "aug": params})
    write_jsonl(out_dir / "manifest.jsonl", rows)
    if failed:
        write_jsonl(out_dir / "failed.jsonl", failed)
    log(f"image_aug: {len(rows)} ảnh, {len(failed)} lỗi tải/xử lý → {out_dir}")
    return rows, failed


def check_real_photo(books, out_dir: Path, log=print) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = out_dir / "manifest.jsonl"
    if not manifest.exists():
        log(f"Chưa có {manifest}. Chụp ảnh bỏ vào {out_dir}/ rồi điền manifest theo eval/README.md.")
        return 1
    ids = {b["image_id"] for b in books}
    errors = 0
    rows = read_jsonl(manifest)
    for i, r in enumerate(rows, 1):
        if not (out_dir / r.get("query_image", "")).is_file():
            log(f"dòng {i}: không thấy ảnh {r.get('query_image')}")
            errors += 1
        if r.get("expected_id") not in ids:
            log(f"dòng {i}: expected_id {r.get('expected_id')} không có trong kho đánh giá (xem --catalog-max)")
            errors += 1
    log(f"real_photo: {len(rows)} dòng, {errors} lỗi")
    return 1 if errors else 0


def find_books(books, text: str, limit: int = 10):
    q = normalize(text)
    hits = [b for b in books if q in normalize(b["title"])]
    for b in hits[:limit]:
        print(f"{b['image_id']}\t{b['title']}\t{b['author']}")
    if not hits:
        print("Không thấy sách nào khớp.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("set", choices=["image_aug", "text_query", "real_photo"])
    ap.add_argument("--n", type=int, help="số mẫu (mặc định 100 ảnh / 100 câu)")
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--data-dir", type=Path, default=DATA_DIR)
    ap.add_argument("--dataset", type=Path, help="file train.parquet/.jsonl có sẵn (mặc định tải sunbv56/biascan-950 từ HF)")
    ap.add_argument("--catalog-max", type=int, default=CATALOG_MAX,
                    help="chỉ lấy sách fahasa_0 … fahasa_<N-1> (mặc định 950, đúng kho trong DB)")
    ap.add_argument("--mock", action="store_true", help="text_query: không gọi Gemini, dùng câu giả để thử luồng")
    ap.add_argument("--min-interval", type=float, default=4.5, help="giây tối thiểu giữa 2 lần gọi Gemini")
    ap.add_argument("--find", help="real_photo: tìm image_id theo tên sách")
    args = ap.parse_args(argv)

    books = load_books(args.dataset, args.catalog_max)
    if not books:
        print("Không có sách nào trong kho sau khi lọc --catalog-max.")
        return 1
    out_dir = args.data_dir / args.set

    if args.set == "image_aug":
        import requests

        session = requests.Session()
        cache = args.data_dir / "_orig"
        build_image_aug(
            books, args.n or 100, args.seed, out_dir,
            lambda b: fetch_cover(b["image_url"], cache, b["image_id"], session),
        )
        return 0
    if args.set == "text_query":
        if args.mock:
            generate = mock_generate
            out_dir = out_dir.with_name("text_query_mock")
        else:
            from gemini import Gemini

            generate = Gemini(settings(), min_interval=args.min_interval).generate
        rows, _ = build_text_query(books, args.n or 100, args.seed, out_dir, generate)
        return 0 if rows else 1
    if args.find:
        find_books(books, args.find)
        return 0
    return check_real_photo(books, out_dir)


if __name__ == "__main__":
    sys.exit(main())
