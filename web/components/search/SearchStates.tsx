"use client";

import { useEffect, useState } from "react";
import { formatInt, formatMs } from "@/lib/format";
import { N_BOOKS } from "@/lib/site";
import type { ApiErrorCode, SearchResponse } from "@/lib/types";
import { CompactCard, TopResultCard } from "../BookCards";

export function EmptyState() {
  return (
    <div className="state state--empty">
      <p className="state__title">Chưa có lượt tìm nào.</p>
      <p className="state__body">
        Kết quả hiện ở đây: ba cuốn khớp nhất đứng đầu, mỗi cuốn kèm một dòng lý do; bảy cuốn gần giống xếp gọn bên dưới.
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
  { label: `Tìm trong ${formatInt(N_BOOKS)} cuốn`, until: 7000 },
  { label: "Xếp hạng lại và viết lý do", until: Infinity },
];
const STEPS_TEXT_ONLY = [
  { label: `Tìm trong ${formatInt(N_BOOKS)} cuốn`, until: 3000 },
  { label: "Xếp hạng lại và viết lý do", until: Infinity },
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
  rate_limited: "Tạm dừng vì tìm quá nhiều lần.",
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

export function Results({ data, onAsk }: { data: SearchResponse; onAsk: () => void }) {
  const top = data.results.slice(0, 3);
  const rest = data.results.slice(3);
  const t = data.timings_ms;

  return (
    <div className="results">
      {data.ocr_text && <OcrBlock text={data.ocr_text} />}

      <section aria-labelledby="khop-nhat" className="results__top">
        <div className="results__head">
          <h2 id="khop-nhat" className="section-title">
            Khớp nhất
          </h2>
          <button type="button" className="btn btn--text" onClick={onAsk}>
            Hỏi trợ lý về các cuốn này
          </button>
        </div>
        <ol className="top-list">
          {top.map((b, i) => (
            <li key={b.image_id}>
              <TopResultCard book={b} rank={i + 1} />
            </li>
          ))}
        </ol>
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
                ["Xếp hạng", t.rerank],
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
