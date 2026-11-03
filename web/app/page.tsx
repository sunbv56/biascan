import Link from "next/link";
import { PipelineMap } from "@/components/PipelineMap";
import { formatInt } from "@/lib/format";
import { DATASET_URL, GITHUB_URL, N_BOOKS } from "@/lib/site";

export default function Home() {
  return (
    <div className="page page--home">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title" className="hero__title">
          Chụp bìa sách, ra đúng cuốn.
        </h1>
        <div className="hero__side">
          <p className="hero__lede">
            BiaScan đọc chữ trên bìa, đối chiếu với {formatInt(N_BOOKS)} đầu sách và chọn ra ba cuốn khớp nhất — mỗi cuốn kèm một
            dòng lý do. Không có sách trong tay thì kể nội dung, nó vẫn tìm.
          </p>
          <div className="hero__actions">
            <Link href="/tim-kiem" className="btn btn--primary">
              Tìm một cuốn sách
            </Link>
            <Link href="/eval" className="link-quiet">
              Xem cách đo độ chính xác
            </Link>
          </div>
        </div>
      </section>

      <section className="map-section" aria-labelledby="map-title">
        <h2 id="map-title" className="map-section__title">
          Ảnh → chữ → vector → 10 ứng viên → 3 cuốn.
        </h2>
        <p className="map-section__lede">Toàn bộ luồng chạy trên một workflow n8n, không có backend riêng. Mỗi lượt tìm đi qua bốn bước:</p>
        <PipelineMap />
        <div className="map-section__cta">
          <Link href="/tim-kiem" className="btn btn--ghost">
            Mở trang tìm kiếm
          </Link>
        </div>
      </section>

      <section className="facts" aria-labelledby="facts-title">
        <h2 id="facts-title" className="section-title">
          Kho sách và cách đo
        </h2>
        <div className="facts__cols">
          <dl className="spec">
            <div>
              <dt>Số đầu sách</dt>
              <dd>{formatInt(N_BOOKS)}</dd>
            </div>
            <div>
              <dt>Nguồn</dt>
              <dd>
                <a href={DATASET_URL} target="_blank" rel="noopener noreferrer">
                  sunbv56/vi-OCR_VQA-desc
                </a>
              </dd>
            </div>
            <div>
              <dt>Mô tả đem nhúng</dt>
              <dd>2.000 ký tự đầu (dài nhất trong kho: 34.352)</dd>
            </div>
            <div>
              <dt>Sách không có mô tả</dt>
              <dd>564 — chỉ tìm được qua tên, tác giả, NXB</dd>
            </div>
          </dl>
          <div className="facts__eval">
            <p>
              Độ chính xác đo trên ba bộ: 300 ảnh bìa bị làm méo như ảnh điện thoại, 100 câu “sách về…” không chứa tên sách, và
              khoảng 20 ảnh chụp thật. Chỉ số: Recall@1, Recall@10, MRR, độ trễ p50/p95.
            </p>
            <p>Trang đo lường chỉ hiện số khi đã chạy thật; chưa chạy thì ghi rõ là chưa đo.</p>
            <p className="facts__links">
              <Link href="/eval" className="link-quiet">
                Trang đo lường
              </Link>
              <a href={GITHUB_URL} className="link-quiet" target="_blank" rel="noopener noreferrer">
                Mã nguồn trên GitHub<span aria-hidden="true"> ↗</span>
              </a>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
