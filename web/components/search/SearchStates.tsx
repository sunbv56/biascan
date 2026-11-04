"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { errorMessage, explain } from "@/lib/api";
import { formatInt, formatMs } from "@/lib/format";
import { EASE_OUT, prefersReducedMotion } from "@/lib/motion";
import { SAMPLE_COVERS, SAMPLE_QUERIES, type SampleCover } from "@/lib/samples";
import { getSessionId } from "@/lib/session";
import { N_BOOKS } from "@/lib/site";
import type { ApiErrorCode, SearchResponse } from "@/lib/types";
import { CompactCard, TopResultCard, type ExplainStatus } from "../BookCards";

gsap.registerPlugin(useGSAP);

interface EmptyProps {
  disabled: boolean;
  loadingCover: string | null;
  onQuery: (q: string) => void;
  onCover: (c: SampleCover) => void;
}

export function EmptyState({ disabled, loadingCover, onQuery, onCover }: EmptyProps) {
  const samplesId = useId();
  return (
    <div className="state state--empty">
      <p className="state__body">
        Gửi ảnh bìa hoặc vài dòng mô tả: ba cuốn khớp nhất đứng đầu, bấm “Vì sao?” để AI viết lý do. Sau đó cứ hỏi tiếp ngay ở ô dưới — trợ lý
        dựa trên các cuốn vừa tìm để so sánh, gợi ý.
      </p>
      <ul className="state__tips">
        <li>Chụp thẳng mặt bìa, đủ sáng, để chữ tên sách rõ nhất có thể.</li>
        <li>Không có sách trong tay? Kể nội dung: “sách dạy nấu ăn chay cho người mới”.</li>
      </ul>
      <section className="samples" aria-labelledby={samplesId}>
        <p id={samplesId} className="field__label">
          Bấm thử
        </p>
        <ul className="samples__queries">
          {SAMPLE_QUERIES.map((q) => (
            <li key={q}>
              <button type="button" className="chip" onClick={() => onQuery(q)} disabled={disabled}>
                {q}
              </button>
            </li>
          ))}
        </ul>
        <ul className="samples__covers" aria-label="Ảnh bìa mẫu">
          {SAMPLE_COVERS.map((c) => (
            <li key={c.image_id}>
              <button type="button" className="sample-cover" onClick={() => onCover(c)} disabled={disabled} aria-busy={loadingCover === c.image_id || undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh nhỏ từ CDN Fahasa, bản xuất tĩnh không tối ưu ảnh */}
                <img src={c.image_url} alt="" className="sample-cover__img" loading="lazy" width={56} height={80} />
                <span className="sample-cover__label">{loadingCover === c.image_id ? "Đang tải…" : c.title}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mono-note">Ảnh mẫu là bìa gốc từ Fahasa, tải về trình duyệt rồi gửi như ảnh bạn chụp.</p>
      </section>
    </div>
  );
}

const STEPS_WITH_IMAGE = [
  { label: "Đọc chữ trên bìa", until: 4000 },
  { label: "Nhúng thành vector", until: 6000 },
  { label: `Tìm trong ${formatInt(N_BOOKS)} cuốn`, until: Infinity },
];
const STEPS_TEXT_ONLY = [
  { label: "Nhúng câu mô tả thành vector", until: 2000 },
  { label: `Tìm trong ${formatInt(N_BOOKS)} cuốn`, until: Infinity },
];

export function LoadingState({ hasImage, startedAt }: { hasImage: boolean; startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(t);
  }, [startedAt]);

  const steps = hasImage ? STEPS_WITH_IMAGE : STEPS_TEXT_ONLY;
  const current = steps.findIndex((s) => elapsed < s.until);

  return (
    <div className="state state--loading">
      <ol className="steps" aria-label="Tiến trình tìm kiếm">
        {steps.map((s, i) => {
          const status = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s.label} className="steps__item" data-status={status} aria-current={status === "active" ? "step" : undefined}>
              <span className="steps__dot" aria-hidden="true" />
              {s.label}
              {status === "active" && <span className="sr-only"> (đang chạy)</span>}
            </li>
          );
        })}
      </ol>
      <p className="mono-note">
        {Math.floor(elapsed / 1000)} giây · bước hiện tại ước theo thời gian chờ, máy chủ chỉ trả lời một lần
      </p>
      <div className="skeleton" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton__top">
            <span className="skeleton__cover" />
            <span className="skeleton__lines">
              <span />
              <span />
              <span />
            </span>
          </div>
        ))}
        <div className="skeleton__grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="skeleton__tile" />
          ))}
        </div>
      </div>
    </div>
  );
}

export const ERROR_TITLES: Record<ApiErrorCode, string> = {
  unauthorized: "Máy chủ không nhận token của trang.",
  rate_limited: "Tạm dừng vì gửi quá nhiều lần.",
  quota_exhausted: "Demo đã hết lượt miễn phí hôm nay.",
  bad_request: "Yêu cầu chưa đủ thông tin.",
  upstream: "Dịch vụ AI chưa trả lời.",
  timeout: "Chờ quá lâu nên đã dừng.",
  network: "Mất kết nối tới máy chủ.",
  config: "Trang chưa được cấu hình.",
  invalid_response: "Máy chủ trả dữ liệu lạ.",
};

export const RETRYABLE = new Set<ApiErrorCode>(["rate_limited", "upstream", "timeout", "network", "invalid_response"]);

export function ErrorState({ code, message, status, onRetry }: { code: ApiErrorCode; message: string; status: number; onRetry: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">{ERROR_TITLES[code]}</p>
      <p className="state__body">{message}</p>
      <p className="mono-note">
        mã lỗi: {code}
        {status ? ` · HTTP ${status}` : ""}
      </p>
      {RETRYABLE.has(code) && (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          Thử lại
        </button>
      )}
    </div>
  );
}

function OcrBlock({ text }: { text: string }) {
  return (
    <figure className="ocr">
      <figcaption className="ocr__label">Chữ đọc được trên bìa</figcaption>
      <pre className="ocr__text">{text}</pre>
    </figure>
  );
}

export function NoResults({ ocrText }: { ocrText: string | null }) {
  return (
    <div className="state state--none">
      {ocrText && <OcrBlock text={ocrText} />}
      <p className="state__title">Không tìm thấy cuốn nào khớp.</p>
      <p className="state__body">
        {ocrText
          ? "Chữ trên bìa đã đọc được nhưng không khớp sách nào trong kho. Thử thêm vài dòng mô tả, hoặc chụp lại gần và thẳng hơn."
          : "Thử mô tả cụ thể hơn: thể loại, nhân vật, bối cảnh, hoặc tên tác giả nếu bạn nhớ."}
      </p>
    </div>
  );
}

type ExplainState = { kind: "idle" } | { kind: "loading" } | { kind: "done"; reasons: Record<string, string> } | { kind: "error"; code: ApiErrorCode; message: string };

function useExplain(query: string | null, ids: string[], saved?: Record<string, string>, onSaved?: (reasons: Record<string, string>) => void) {
  const [state, setState] = useState<ExplainState>(saved ? { kind: "done", reasons: saved } : { kind: "idle" });
  const inflight = useRef<AbortController | null>(null);
  const idsKey = ids.join(",");

  useEffect(() => () => inflight.current?.abort(), []);

  const run = useCallback(async () => {
    if (!query || !idsKey || inflight.current) return;
    const controller = new AbortController();
    inflight.current = controller;
    setState({ kind: "loading" });
    try {
      const res = await explain({ session_id: getSessionId(), query, image_ids: idsKey.split(",") }, controller.signal);
      if (!controller.signal.aborted) {
        setState({ kind: "done", reasons: res.reasons });
        onSaved?.(res.reasons);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const { code, message } = errorMessage(err);
      setState({ kind: "error", code, message });
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  }, [query, idsKey, onSaved]);

  return { state, run, available: Boolean(query) };
}

function statusFor(state: ExplainState, id: string): ExplainStatus {
  if (state.kind === "loading") return { kind: "loading" };
  if (state.kind === "done") return state.reasons[id] ? { kind: "done", reason: state.reasons[id] } : { kind: "missing" };
  return { kind: "idle" };
}

interface ResultsProps {
  data: SearchResponse;
  query: string | null;
  onAsk?: () => void;
  savedReasons?: Record<string, string>;
  onReasons?: (reasons: Record<string, string>) => void;
}

export function Results({ data, query, onAsk, savedReasons, onReasons }: ResultsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const topId = useId();
  const restId = useId();
  const top = data.results.slice(0, 3);
  const rest = data.results.slice(3);
  const t = data.timings_ms;
  const explainQuery = query || data.ocr_text;
  const why = useExplain(explainQuery, top.map((b) => b.image_id), savedReasons, onReasons);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from("[data-reveal]", { autoAlpha: 0, y: 10, duration: 0.42, ease: EASE_OUT, stagger: 0.05, clearProps: "all" });
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef} className="results">
      {data.ocr_text && <OcrBlock text={data.ocr_text} />}

      <section aria-labelledby={topId} className="results__top">
        <div className="results__head">
          <h2 id={topId} className="section-title">
            Khớp nhất
          </h2>
          <div className="results__head-side">
            {data.cached && (
              <span className="cached-tag" title="Câu này đã có người tìm gần đây, kết quả lấy lại từ bộ nhớ đệm, không gọi AI lần nữa">
                lấy từ bộ nhớ đệm
              </span>
            )}
            {onAsk && (
              <button type="button" className="btn btn--text" onClick={onAsk}>
                So sánh ba cuốn này
              </button>
            )}
          </div>
        </div>
        <ol className="top-list">
          {top.map((b, i) => (
            <li key={b.image_id}>
              <TopResultCard
                book={b}
                rank={i + 1}
                explain={why.available ? statusFor(why.state, b.image_id) : undefined}
                onExplain={() => void why.run()}
              />
            </li>
          ))}
        </ol>
        {why.state.kind === "error" && (
          <div className="explain-error" role="alert">
            <p>
              <strong>Chưa viết được lý do.</strong> {why.state.message}
            </p>
            <p className="mono-note">mã lỗi: {why.state.code}</p>
            {RETRYABLE.has(why.state.code) && (
              <button type="button" className="btn btn--text" onClick={() => void why.run()}>
                Thử lại
              </button>
            )}
          </div>
        )}
        <p className="sr-only" role="status">
          {why.state.kind === "loading" ? "Đang viết lý do cho ba cuốn đầu…" : why.state.kind === "done" ? "Đã có lý do cho ba cuốn đầu." : ""}
        </p>
      </section>

      {rest.length > 0 && (
        <section aria-labelledby={restId} className="results__rest">
          <h2 id={restId} className="section-title section-title--small">
            {rest.length} cuốn gần giống
          </h2>
          <ul className="strip">
            {rest.map((b) => (
              <li key={b.image_id}>
                <CompactCard book={b} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {t.total > 0 && (
        <p className="timings mono-note">
          {formatMs(t.total)} · OCR {formatMs(t.ocr)} · nhúng {formatMs(t.embed)} · tìm {formatMs(t.search)}
        </p>
      )}
    </div>
  );
}
