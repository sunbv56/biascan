import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono, Newsreader } from "next/font/google";
import { AppStateProvider } from "@/components/AppState";
import { ChatDrawer } from "@/components/ChatDrawer";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "700"],
  variable: "--font-newsreader",
  display: "swap",
});

const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "700"],
  variable: "--font-be-vietnam",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["400"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "BiaScan — tra sách bằng ảnh bìa", template: "%s · BiaScan" },
  description:
    "Chụp bìa hoặc kể nội dung, BiaScan tìm đúng cuốn sách trong kho 950 đầu sách: OCR, embedding Gemini và pgvector, lý do khớp viết khi bạn hỏi.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f1e9",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${newsreader.variable} ${beVietnam.variable} ${jetbrains.variable}`}>
      <body>
        <AppStateProvider>
          <a href="#noi-dung" className="skip-link">
            Bỏ qua tới nội dung
          </a>
          <SiteHeader />
          <main id="noi-dung" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
          <ChatDrawer />
        </AppStateProvider>
      </body>
    </html>
  );
}
