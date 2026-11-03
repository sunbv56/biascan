import math
import time

from common import Settings, Throttle, with_retry

OCR_PROMPT = (
    "Đây là ảnh chụp bìa một cuốn sách. Chép lại nguyên văn mọi chữ đọc được trên bìa "
    "(tên sách, tác giả, nhà xuất bản, dòng phụ), mỗi cụm một dòng, giữ dấu tiếng Việt. "
    "Không giải thích, không thêm chữ không có trên bìa. Không đọc được gì thì trả về chuỗi rỗng."
)


class Gemini:
    def __init__(self, s: Settings, min_interval: float = 0.0):
        from google import genai

        if not s.gemini_api_key:
            raise SystemExit("Thiếu GEMINI_API_KEY trong eval/.env")
        self.s = s
        self.client = genai.Client(api_key=s.gemini_api_key)
        self.throttle = Throttle(min_interval)
        self.last_call_ms: float | None = None

    def _call(self, fn):
        def run():
            self.throttle.wait()
            t0 = time.perf_counter()
            out = fn()
            self.last_call_ms = (time.perf_counter() - t0) * 1000
            return out

        self.last_call_ms = None
        return with_retry(run)

    def generate(self, prompt: str, model: str | None = None, temperature: float = 0.7) -> str:
        from google.genai import types

        resp = self._call(
            lambda: self.client.models.generate_content(
                model=model or self.s.chat_model,
                contents=prompt,
                config=types.GenerateContentConfig(temperature=temperature),
            )
        )
        return (resp.text or "").strip()

    def ocr(self, jpeg: bytes) -> str:
        from google.genai import types

        resp = self._call(
            lambda: self.client.models.generate_content(
                model=self.s.ocr_model,
                contents=[types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), OCR_PROMPT],
                config=types.GenerateContentConfig(temperature=0.0),
            )
        )
        return (resp.text or "").strip()

    def _embed(self, contents) -> list[float]:
        from google.genai import types

        cfg = {"output_dimensionality": self.s.embed_dims}
        if self.s.embed_task_type and not self.s.embed_model.startswith("gemini-embedding-2"):
            cfg["task_type"] = self.s.embed_task_type
        resp = self._call(
            lambda: self.client.models.embed_content(
                model=self.s.embed_model,
                contents=contents,
                config=types.EmbedContentConfig(**cfg),
            )
        )
        values = list(resp.embeddings[0].values)
        if len(values) != self.s.embed_dims:
            raise RuntimeError(f"Embedding {len(values)} chiều, cần {self.s.embed_dims}")
        norm = math.sqrt(sum(x * x for x in values))
        return [x / norm for x in values] if norm > 0 else values

    def embed_text(self, text: str) -> list[float]:
        return self._embed(text)

    def embed_image(self, jpeg: bytes) -> list[float]:
        from google.genai import types

        return self._embed(types.Content(parts=[types.Part.from_bytes(data=jpeg, mime_type="image/jpeg")]))
