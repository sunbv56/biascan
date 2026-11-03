"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, explain } from "@/lib/api";
import { formatInt, formatMs } from "@/lib/format";
import { getSessionId } from "@/lib/session";
import { N_BOOKS } from "@/lib/site";
import type { ApiErrorCode, SearchResponse } from "@/lib/types";
import { CompactCard, TopResultCard, type ExplainStatus } from "../BookCards";

export function EmptyState() {
  return (
    <div className="state state--empty">
      <p className="state__title">Chưa có lượt tìm nào.</p>
      <p className="state__body">
        Kết quả hiện ở đây: ba cuốn khớp nhất đứng đầu, bấm “Vì sao?” để AI viết một dòng lý do cho cả ba; bảy cuốn gần giống xếp gọn bên dưới.
      </p>
      <ul className="state__tips">
        <li>Chụp thẳng mặt bìa, đủ sáng, để chữ tên sách rõ nhất có thể.</li>
        <li>Không có sách trong tay? Kể nội dung: “sách dạy nấu ăn chay cho người mới”.</li>
      </ul>
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

const ERROR_TITLES: Record<ApiErrorCode, string> = {
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

const RETRYABLE = new Set<ApiErrorCode>(["rate_limited", "upstream", "timeout", "network", "invalid_response"]);

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

function useExplain(query: string | null, ids: string[]) {
  const [state, setState] = useState<ExplainState>({ kind: "idle" });
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
      if (!controller.signal.aborted) setState({ kind: "done", reasons: res.reasons });
    } catch (err) {
      if (controller.signal.aborted) return;
      const { code, message } = errorMessage(err);
      setState({ kind: "error", code, message });
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  }, [query, idsKey]);

  return { state, run, available: Boolean(query) };
}

function statusFor(state: ExplainState, id: string): ExplainStatus {
  if (state.kind === "loading") return { kind: "loading" };
  if (state.kind === "done") return state.reasons[id] ? { kind: "done", reason: state.reasons[id] } : { kind: "missing" };
  return { kind: "idle" };
}

export function Results({ data, query, onAsk }: { data: SearchResponse; query: string | null; onAsk: () => void }) {
  const top = data.results.slice(0, 3);
  const rest = data.results.slice(3);
  const t = data.timings_ms;
  const explainQuery = query || data.ocr_text;
  const why = useExplain(explainQuery, top.map((b) => b.image_id));

  return (
    <div className="results">
      {data.ocr_text && <OcrBlock text={data.ocr_text} />}

      <section aria-labelledby="khop-nhat" className="results__top">
        <div className="results__head">
          <h2 id="khop-nhat" className="section-title">
            Khớp nhất
          </h2>
          <div className="results__head-side">
            {data.cached && (
              <span className="cached-tag" title="Câu này đã có người tìm gần đây, kết quả lấy lại từ bộ nhớ đệm, không gọi AI lần nữa">
                lấy từ bộ nhớ đệm
              </span>
            )}
            <button type="button" className="btn btn--text" onClick={onAsk}>
              Hỏi trợ lý về các cuốn này
            </button>
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
        <section aria-labelledby="gan-giong" className="results__rest">
          <h2 id="gan-giong" className="section-title section-title--small">
            {rest.length} cuốn gần giống
          </h2>
          <ul className="compact-grid">
            {rest.map((b) => (
              <li key={b.image_id}>
                <CompactCard book={b} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {t.total > 0 && (
        <details className="timings">
          <summary>Thời gian xử lý · {formatMs(t.total)}</summary>
          <dl className="timings__list">
            {(
              [
                ["OCR", t.ocr],
                ["Nhúng", t.embed],
                ["Tìm", t.search],
                ["Tổng", t.total],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{formatMs(v)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
