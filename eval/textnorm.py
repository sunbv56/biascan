import re
import unicodedata

_SPACES = re.compile(r"\s+")


def normalize(text: str | None) -> str:
    """Giống hợp đồng title_norm: lowercase, bỏ dấu, đ→d, gộp khoảng trắng."""
    if not text:
        return ""
    s = text.lower().replace("đ", "d")
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return _SPACES.sub(" ", s).strip()
