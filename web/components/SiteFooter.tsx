import { DATASET_NAME, DATASET_URL, GITHUB_URL, N_BOOKS } from "@/lib/site";
import { formatInt } from "@/lib/format";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer__colophon">
        <span className="site-footer__mark">BiaScan</span> — dự án portfolio về tìm kiếm sách bằng AI, trên kho cố định{" "}
        {formatInt(N_BOOKS)} đầu sách (ảnh bìa và mô tả công khai trên Fahasa). Đọc chữ, nhúng vector và viết lý do bằng Gemini; tìm
        kiếm bằng pgvector trên Supabase; điều phối bằng n8n. Không liên kết hay đại diện cho Fahasa — liên kết sản phẩm chỉ dẫn về
        trang gốc. Mã nguồn:{" "}
        <a href={GITHUB_URL} rel="noopener noreferrer" target="_blank">
          github.com/sunbv56/biascan
        </a>
        {" · "}dữ liệu:{" "}
        <a href={DATASET_URL} rel="noopener noreferrer" target="_blank">
          huggingface.co/datasets/{DATASET_NAME}
        </a>
        . Chữ: Newsreader, Be Vietnam Pro, JetBrains Mono.
      </p>
    </footer>
  );
}
