import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EvalExample, EvalMode, EvalResults, EvalRun, EvalSet } from "./types";

const SETS: EvalSet[] = ["image_aug", "text_query", "real_photo"];
const MODES: EvalMode[] = ["text", "image", "hybrid"];

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function normalizeEval(raw: unknown): EvalResults {
  const r = (raw ?? {}) as Record<string, unknown>;
  const status = r.status === "measured" ? "measured" : "placeholder";
  const models = (r.models ?? {}) as Record<string, unknown>;
  const runs: EvalRun[] = (Array.isArray(r.runs) ? r.runs : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => SETS.includes(x.set as EvalSet) && MODES.includes(x.mode as EvalMode))
    .map((x) => {
      const measured = status === "measured";
      const pick = (v: unknown) => (measured ? numOrNull(v) : null);
      return {
        set: x.set as EvalSet,
        mode: x.mode as EvalMode,
        n: numOrNull(x.n) ?? 0,
        recall_at_1: pick(x.recall_at_1),
        recall_at_10: pick(x.recall_at_10),
        mrr: pick(x.mrr),
        latency_p50_ms: pick(x.latency_p50_ms),
        latency_p95_ms: pick(x.latency_p95_ms),
      };
    });
  const examples: EvalExample[] = (Array.isArray(r.examples) ? r.examples : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => str(x.query))
    .map((x) => ({ set: str(x.set), query: str(x.query), expected_id: str(x.expected_id), hit_rank: status === "measured" ? numOrNull(x.hit_rank) : null }));
  return {
    status,
    generated_at: typeof r.generated_at === "string" ? r.generated_at : null,
    n_books: numOrNull(r.n_books) ?? 0,
    models: { ocr: str(models.ocr), embed: str(models.embed), rerank: str(models.rerank) },
    runs,
    examples,
  };
}

export async function loadEvalResults(): Promise<EvalResults | null> {
  try {
    const file = path.join(process.cwd(), "public", "eval", "results.json");
    return normalizeEval(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

export const SET_LABELS: Record<EvalSet, { name: string; detail: string }> = {
  image_aug: { name: "Ảnh bìa biến dạng", detail: "300 ảnh bìa gốc bị xoay, cắt, làm mờ, chỉnh sáng tối — giả ảnh chụp điện thoại." },
  text_query: { name: "Câu mô tả", detail: "100 câu “sách về…” do Gemini viết từ mô tả sách, cấm chứa tên sách." },
  real_photo: { name: "Ảnh chụp thật", detail: "Khoảng 20 ảnh tự chụp sách thật: góc nghiêng, bóng tay, ánh đèn." },
};

export const MODE_LABELS: Record<EvalMode, string> = {
  text: "Văn bản",
  image: "Ảnh",
  hybrid: "Kết hợp",
};
