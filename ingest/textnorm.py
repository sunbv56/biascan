import re
import unicodedata

DESC_MAX_CHARS = 2000

_WS = re.compile(r"\s+")


def normalize(text: str | None) -> str:
    if not text:
        return ""
    s = text.replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = unicodedata.normalize("NFC", s).lower()
    return _WS.sub(" ", s).strip()


def _clean(value: str | None) -> str:
    return (value or "").strip()


def pick_description(row: dict, max_chars: int = DESC_MAX_CHARS) -> str:
    desc = _clean(row.get("description")) or _clean(row.get("og_description"))
    return desc[:max_chars]


def build_embed_text(row: dict, max_chars: int = DESC_MAX_CHARS) -> str:
    return (
        f"title: {_clean(row.get('title')) or 'none'} | text: "
        f"Tác giả: {_clean(row.get('author'))}\n"
        f"Nhà xuất bản: {_clean(row.get('publisher'))}\n"
        f"Nhà phát hành: {_clean(row.get('supplier'))}\n"
        f"Mô tả: {pick_description(row, max_chars)}"
    )
