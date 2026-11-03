import type { Metadata } from "next";
import { SearchClient } from "@/components/search/SearchClient";

export const metadata: Metadata = {
  title: "Tìm sách",
  description: "Chụp bìa hoặc mô tả cuốn sách, BiaScan trả về 10 cuốn khớp nhất, ba cuốn đầu kèm lý do.",
};

export default function SearchPage() {
  return (
    <div className="page page--search">
      <SearchClient />
    </div>
  );
}
