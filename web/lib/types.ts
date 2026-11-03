export interface BookCard {
  image_id: string;
  title: string;
  author: string;
  publisher: string;
  supplier: string;
  image_url: string;
  product_url: string;
}

export interface SearchResult extends BookCard {
  score: number;
  reason: string | null;
}

export interface SearchTimings {
  ocr: number;
  embed: number;
  search: number;
  rerank: number;
  total: number;
}

export interface SearchRequest {
  query?: string;
  image?: string;
  session_id: string;
}

export interface SearchResponse {
  ocr_text: string | null;
  results: SearchResult[];
  timings_ms: SearchTimings;
}

export interface ChatRequest {
  session_id: string;
  message: string;
  context_ids?: string[];
}

export interface ChatResponse {
  reply: string;
  suggestions: string[];
  products: BookCard[];
}

export type ApiErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "bad_request"
  | "upstream"
  | "timeout"
  | "network"
  | "config"
  | "invalid_response";

export type EvalSet = "image_aug" | "text_query" | "real_photo";
export type EvalMode = "text" | "image" | "hybrid";

export interface EvalRun {
  set: EvalSet;
  mode: EvalMode;
  n: number;
  recall_at_1: number | null;
  recall_at_10: number | null;
  mrr: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
}

export interface EvalExample {
  set: string;
  query: string;
  expected_id: string;
  hit_rank: number | null;
}

export interface EvalResults {
  status: "placeholder" | "measured";
  generated_at: string | null;
  n_books: number;
  models: { ocr: string; embed: string; rerank: string };
  runs: EvalRun[];
  examples: EvalExample[];
}
