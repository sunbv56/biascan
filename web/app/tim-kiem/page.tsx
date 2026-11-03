import type { Metadata } from "next";
import { SearchClient } from "@/components/search/SearchClient";

export const metadata: Metadata = {
  title: "Tìm sách",
  description: "Chụp bìa hoặc mô tả cuốn sách, BiaScan trả về 10 cuốn khớp nhất trong kho 950 đầu sách; ba cuốn đầu có thể hỏi vì sao khớp.",
};

export default function SearchPage() {
  return (
    <div className="page page--search">
      <SearchClient />
    </div>
  );
}
