import type {
  ApiErrorCode,
  BookCard,
  ChatRequest,
  ChatResponse,
  ExplainRequest,
  ExplainResponse,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from "./types";

export const REQUEST_TIMEOUT_MS = 30_000;

const FALLBACK_MESSAGES: Record<ApiErrorCode, string> = {
  unauthorized: "Máy chủ từ chối yêu cầu vì token không hợp lệ. Kiểm tra lại NEXT_PUBLIC_BIASCAN_TOKEN.",
  rate_limited: "Bạn đã gửi quá nhiều yêu cầu trong thời gian ngắn. Đợi khoảng một phút rồi thử lại.",
  quota_exhausted: "Demo đã dùng hết lượt miễn phí hôm nay, vui lòng thử lại sau 15:00 (giờ Việt Nam).",
  bad_request: "Yêu cầu chưa hợp lệ. Cần ít nhất một ảnh bìa hoặc một đoạn mô tả.",
  upstream: "Dịch vụ AI phía sau đang không trả lời. Thử lại sau ít phút.",
  timeout: "Quá 30 giây chưa có kết quả nên đã dừng chờ. Thử lại, hoặc dùng ảnh nhỏ hơn.",
  network: "Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.",
  config: "Trang chưa được cấu hình địa chỉ máy chủ (NEXT_PUBLIC_N8N_BASE_URL).",
  invalid_response: "Máy chủ trả về dữ liệu không đúng định dạng.",
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, status: number, message?: string) {
    super(message || FALLBACK_MESSAGES[code]);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(err: unknown): { code: ApiErrorCode; message: string } {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  return { code: "network", message: FALLBACK_MESSAGES.network };
}

function codeFromStatus(status: number): ApiErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 413 || status === 422) return "bad_request";
  return "upstream";
}

const KNOWN_CODES = new Set<ApiErrorCode>(["unauthorized", "rate_limited", "quota_exhausted", "bad_request", "upstream"]);

function baseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_N8N_BASE_URL;
  if (!raw) throw new ApiError("config", 0);
  return raw.replace(/\/+$/, "");
}

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const url = `${baseUrl()}${path}`;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-biascan-token": process.env.NEXT_PUBLIC_BIASCAN_TOKEN ?? "",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) throw new ApiError("timeout", 0);
    if (signal?.aborted) throw err;
    throw new ApiError("network", 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const e = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    const code = e?.code && KNOWN_CODES.has(e.code as ApiErrorCode) ? (e.code as ApiErrorCode) : codeFromStatus(res.status);
    throw new ApiError(code, res.status, typeof e?.message === "string" ? e.message : undefined);
  }
  if (payload === null || typeof payload !== "object") throw new ApiError("invalid_response", res.status);
  return payload;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function toCard(raw: unknown): BookCard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.image_id)) return null;
  return {
    image_id: str(r.image_id),
    title: str(r.title),
    author: str(r.author),
    publisher: str(r.publisher),
    supplier: str(r.supplier),
    image_url: str(r.image_url),
    product_url: str(r.product_url),
  };
}

export function parseSearchResponse(raw: unknown): SearchResponse {
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.results)) throw new ApiError("invalid_response", 200);
  const results: SearchResult[] = [];
  for (const item of r.results) {
    const card = toCard(item);
    if (!card) continue;
    const it = item as Record<string, unknown>;
    results.push({ ...card, score: num(it.score), reason: typeof it.reason === "string" && it.reason.trim() ? it.reason : null });
  }
  const t = (r.timings_ms ?? {}) as Record<string, unknown>;
  return {
    ocr_text: typeof r.ocr_text === "string" && r.ocr_text.trim() ? r.ocr_text : null,
    results,
    timings_ms: { ocr: num(t.ocr), embed: num(t.embed), search: num(t.search), rerank: num(t.rerank), total: num(t.total) },
    cached: r.cached === true,
  };
}

export function parseChatResponse(raw: unknown): ChatResponse {
  const r = raw as Record<string, unknown>;
  if (typeof r.reply !== "string") throw new ApiError("invalid_response", 200);
  return {
    reply: r.reply,
    suggestions: Array.isArray(r.suggestions) ? r.suggestions.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [],
    products: Array.isArray(r.products) ? r.products.map(toCard).filter((c): c is BookCard => c !== null) : [],
  };
}

export async function searchBooks(req: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
  if (!req.query?.trim() && !req.image) throw new ApiError("bad_request", 0);
  const body: SearchRequest = { session_id: req.session_id };
  if (req.query?.trim()) body.query = req.query.trim();
  if (req.image) body.image = req.image;
  return parseSearchResponse(await postJson("/webhook/biascan-search", body, signal));
}

export function parseExplainResponse(raw: unknown, ids: string[]): ExplainResponse {
  const r = (raw as Record<string, unknown>).reasons;
  if (!r || typeof r !== "object" || Array.isArray(r)) throw new ApiError("invalid_response", 200);
  const reasons: Record<string, string> = {};
  for (const id of ids) {
    const v = (r as Record<string, unknown>)[id];
    if (typeof v === "string" && v.trim()) reasons[id] = v.trim();
  }
  return { reasons };
}

export async function explain(req: ExplainRequest, signal?: AbortSignal): Promise<ExplainResponse> {
  const ids = req.image_ids.slice(0, 3);
  if (!req.query.trim() || ids.length === 0) throw new ApiError("bad_request", 0);
  const body: ExplainRequest = { session_id: req.session_id, query: req.query.trim(), image_ids: ids };
  return parseExplainResponse(await postJson("/webhook/biascan-explain", body, signal), ids);
}

export async function chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  const body: ChatRequest = { session_id: req.session_id, message: req.message };
  if (req.context_ids?.length) body.context_ids = req.context_ids;
  return parseChatResponse(await postJson("/webhook/biascan-chat", body, signal));
}
