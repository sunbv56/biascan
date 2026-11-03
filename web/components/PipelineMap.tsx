"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Link from "next/link";
import { useRef } from "react";
import { EASE_OUT } from "@/lib/motion";
import { GITHUB_URL } from "@/lib/site";

gsap.registerPlugin(useGSAP);

export function PipelineMap() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const nodes = gsap.utils.toArray<HTMLElement>("[data-node]", el);
        const edges = gsap.utils.toArray<HTMLElement>("[data-edge]", el);
        gsap.set(nodes, { autoAlpha: 0, y: 12 });
        gsap.set(edges, { scaleX: 0, scaleY: 0 });
        let played = false;
        const io = new IntersectionObserver(
          (entries) => {
            if (played || !entries.some((e) => e.isIntersecting)) return;
            played = true;
            io.disconnect();
            const tl = gsap.timeline({ defaults: { ease: EASE_OUT } });
            tl.to(nodes, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.09 });
            tl.to(edges, { scaleX: 1, scaleY: 1, duration: 0.36, stagger: 0.07 }, 0.15);
          },
          { threshold: 0.05 },
        );
        io.observe(el);
        return () => io.disconnect();
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className="map" role="group" aria-label="Sơ đồ luồng xử lý của BiaScan">
      <ol className="map__grid">
        <li className="node node--input node--photo" data-node>
          <p className="node__kind">Đầu vào</p>
          <h3 className="node__title">Ảnh bìa</h3>
          <p className="node__body">Chụp bằng điện thoại, nén ở trình duyệt: cạnh dài ≤ 768 px, JPEG chất lượng 0,8 — ít token hơn khi đọc chữ.</p>
          <span className="edge edge--solid" data-edge aria-hidden="true" />
        </li>

        <li className="node node--ocr" data-node>
          <p className="node__kind">Bước 1 · chỉ với ảnh</p>
          <h3 className="node__title">Đọc chữ trên bìa</h3>
          <p className="node__tech">Gemini · OCR, có model dự phòng</p>
          <p className="node__body">Lấy tên sách, tác giả, nhà xuất bản — kể cả chữ cong, chữ nghệ thuật.</p>
          <span className="edge edge--solid" data-edge aria-hidden="true" />
        </li>

        <li className="node node--input node--text" data-node>
          <p className="node__kind">Hoặc · đầu vào</p>
          <h3 className="node__title">Lời mô tả</h3>
          <p className="node__body">“Sách về cậu bé chăn cừu đi tìm kho báu” — đi thẳng vào bước nhúng, bỏ qua OCR.</p>
          <span className="edge edge--dashed" data-edge aria-hidden="true" />
        </li>

        <li className="node node--embed" data-node>
          <p className="node__kind">Bước 2</p>
          <h3 className="node__title">Nhúng thành vector</h3>
          <p className="node__tech">gemini-embedding-2 · 768 chiều</p>
          <p className="node__body">Cùng một khuôn ghép văn bản cho sách và câu hỏi: tên, tác giả, NXB, nhà phát hành, 2.000 ký tự mô tả đầu.</p>
          <span className="edge edge--solid" data-edge aria-hidden="true" />
        </li>

        <li className="node node--search" data-node>
          <p className="node__kind">Bước 3</p>
          <h3 className="node__title">Tìm 10 ứng viên</h3>
          <p className="node__tech">Supabase pgvector · HNSW cosine</p>
          <p className="node__body">Cộng điểm khi tên sách không dấu khớp ≥ 0,6 theo trigram, để chữ OCR gần nguyên văn lên đầu. Câu đã tìm gần đây lấy lại từ bộ nhớ đệm.</p>
          <a className="node__link" href={`${GITHUB_URL}/tree/main/supabase`} target="_blank" rel="noopener noreferrer">
            Xem mã SQL<span aria-hidden="true"> ↗</span>
          </a>
          <span className="edge edge--solid" data-edge aria-hidden="true" />
        </li>

        <li className="node node--explain" data-node>
          <p className="node__kind">Bước 4 · khi bạn hỏi</p>
          <h3 className="node__title">Giải thích vì sao khớp</h3>
          <p className="node__tech">Gemini · một lần gọi cho 3 cuốn</p>
          <p className="node__body">Kết quả tìm không gọi model viết chữ. Bấm “Vì sao?” thì một lượt gọi viết lý do cho cả ba cuốn đầu, lưu lại cho lần sau.</p>
          <Link className="node__link" href="/tim-kiem">
            Thử với một cuốn sách
          </Link>
        </li>
      </ol>
      <p className="map__legend">
        <span className="legend legend--solid" aria-hidden="true" /> luồng ảnh
        <span className="legend legend--dashed" aria-hidden="true" /> luồng lời mô tả
      </p>
    </div>
  );
}
