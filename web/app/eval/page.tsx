import type { Metadata } from "next";
import Link from "next/link";
import { loadEvalResults, MODE_LABELS, SET_LABELS } from "@/lib/eval";
import { formatDecimal, formatInt, formatMs, formatPercent } from "@/lib/format";
import type { EvalRun, EvalSet } from "@/lib/types";

export const metadata: Metadata = {
  title: "Đo lường",
  description: "Recall@1, Recall@10, MRR và độ trễ của BiaScan trên ảnh bìa biến dạng, câu mô tả và ảnh chụp thật.",
};

function Cell({ value, kind }: { value: number | null; kind: "pct" | "dec" | "ms" }) {
  if (value === null) return <span className="unmeasured">chưa đo</span>;
  const text = kind === "pct" ? formatPercent(value) : kind === "dec" ? formatDecimal(value) : formatMs(value);
  return <span className="num">{text}</span>;
}

const COLUMNS: { key: keyof EvalRun; label: string; kind: "pct" | "dec" | "ms" }[] = [
  { key: "recall_at_1", label: "Recall@1", kind: "pct" },
  { key: "recall_at_10", label: "Recall@10", kind: "pct" },
  { key: "mrr", label: "MRR", kind: "dec" },
  { key: "latency_p50_ms", label: "p50", kind: "ms" },
  { key: "latency_p95_ms", label: "p95", kind: "ms" },
];

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(d);
}

export default async function EvalPage() {
  const data = await loadEvalResults();
  const measured = data?.status === "measured";
  const date = formatDate(data?.generated_at ?? null);
  const sets = (Object.keys(SET_LABELS) as EvalSet[]).map((set) => ({ set, runs: data?.runs.filter((r) => r.set === set) ?? [] }));

  return (
    <div className="page page--eval">
      <header className="eval-head">
        <h1 className="page-title">Đo lường</h1>
        <p className="eval-status" data-measured={measured || undefined}>
          {measured ? <>Đã đo{date ? ` · ${date}` : ""}</> : "Chưa đo"}
        </p>
        <p className="page-lede">
          {measured
            ? `Số đo trên kho ${formatInt(data!.n_books)} đầu sách. Mỗi dòng là một bộ câu hỏi chạy với một chế độ tìm.`
            : "Bộ đánh giá chưa chạy nên bảng dưới để trống có chủ đích. Khi script trong eval/ chạy xong, nó ghi đè tệp kết quả và trang này hiện số thật."}
        </p>
        {!data && <p className="field__error">Không đọc được tệp /eval/results.json.</p>}
      </header>

      <section className="eval-section" aria-labelledby="bang-ket-qua">
        <h2 id="bang-ket-qua" className="section-title">
          Kết quả theo bộ × chế độ
        </h2>
        <div className="table-wrap">
          <table className="eval-table">
            <caption className="sr-only">Chỉ số tìm kiếm theo bộ dữ liệu và chế độ</caption>
            <thead>
              <tr>
                <th scope="col">Bộ</th>
                <th scope="col">Chế độ</th>
                <th scope="col" className="num-col">
                  n
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className="num-col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            {sets.map(({ set, runs }) => (
              <tbody key={set}>
                {runs.length === 0 ? (
                  <tr>
                    <th scope="row" data-label="Bộ">
                      {SET_LABELS[set].name}
                    </th>
                    <td colSpan={2 + COLUMNS.length} className="unmeasured">
                      chưa có lượt chạy
                    </td>
                  </tr>
                ) : (
                  runs.map((r, i) => (
                    <tr key={`${r.set}-${r.mode}`}>
                      {i === 0 ? (
                        <th scope="rowgroup" rowSpan={runs.length} data-label="Bộ" className="eval-table__set">
                          {SET_LABELS[set].name}
                        </th>
                      ) : null}
                      <td data-label="Chế độ">{MODE_LABELS[r.mode]}</td>
                      <td data-label={measured ? "n" : "n (dự kiến)"} className="num-col">
                        <span className="num">{formatInt(r.n)}</span>
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} data-label={c.label} className="num-col">
                          <Cell value={r[c.key] as number | null} kind={c.kind} />
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            ))}
          </table>
        </div>
        {!measured && <p className="mono-note">Cột n là cỡ mẫu dự kiến, chưa phải số đã chạy.</p>}
      </section>

      <section className="eval-section eval-method" aria-labelledby="phuong-phap">
        <h2 id="phuong-phap" className="section-title">
          Phương pháp
        </h2>
        <div className="eval-method__cols">
          <dl className="spec">
            {(Object.keys(SET_LABELS) as EvalSet[]).map((s) => (
              <div key={s}>
                <dt>{SET_LABELS[s].name}</dt>
                <dd>{SET_LABELS[s].detail}</dd>
              </div>
            ))}
          </dl>
          <dl className="spec">
            <div>
              <dt>Recall@1 · @10</dt>
              <dd>Tỉ lệ câu hỏi mà cuốn đúng nằm ở hạng 1 / trong 10 kết quả đầu.</dd>
            </div>
            <div>
              <dt>MRR</dt>
              <dd>Trung bình của 1 / hạng của cuốn đúng; không có trong top 10 thì tính 0.</dd>
            </div>
            <div>
              <dt>p50 · p95</dt>
              <dd>Độ trễ toàn luồng tính từ lúc gửi tới lúc nhận kết quả, trung vị và phân vị 95.</dd>
            </div>
            <div>
              <dt>Chế độ</dt>
              <dd>Văn bản: OCR rồi tìm theo chữ. Ảnh: tìm theo embedding ảnh bìa. Kết hợp: gộp hai danh sách bằng RRF.</dd>
            </div>
          </dl>
        </div>
        {data && (
          <p className="mono-note">
            Mô hình cấu hình: OCR {data.models.ocr || "—"} · embedding {data.models.embed || "—"} · xếp hạng {data.models.rerank || "—"}
          </p>
        )}
      </section>

      <section className="eval-section" aria-labelledby="vi-du">
        <h2 id="vi-du" className="section-title">
          Ví dụ
        </h2>
        {data && data.examples.length > 0 ? (
          <ul className="examples">
            {data.examples.map((ex, i) => (
              <li key={`${ex.expected_id}-${i}`} className="example">
                <p className="example__query">{ex.query}</p>
                <p className="mono-note">
                  {SET_LABELS[ex.set as EvalSet]?.name ?? ex.set} · cần ra {ex.expected_id} ·{" "}
                  {ex.hit_rank === null ? (measured ? "không có trong top 10" : "chưa đo") : `trúng ở hạng ${ex.hit_rank}`}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="state state--empty">
            <p className="state__title">Chưa có ví dụ.</p>
            <p className="state__body">Ví dụ được lấy từ lượt chạy đánh giá thật, nên sẽ có cùng lúc với bảng số.</p>
            <Link href="/tim-kiem" className="btn btn--ghost">
              Tự thử một lượt tìm
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
