import type { Metadata } from "next";
import { SearchClient } from "@/components/search/SearchClient";

export const metadata: Metadata = {
  title: { absolute: "BiaScan — tra sách bằng ảnh bìa" },
  description: "Chụp bìa hoặc mô tả cuốn sách, BiaScan trả về 10 cuốn khớp nhất trong kho 950 đầu sách, rồi hỏi tiếp trợ lý về các cuốn đó.",
};

export default function Home() {
  return (
    <div className="page page--search">
      <SearchClient />
    </div>
  );
}
