"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppState } from "./AppState";

const LINKS = [
  { href: "/tim-kiem", label: "Tìm sách" },
  { href: "/eval", label: "Đo lường" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { openChat, chatOpen } = useAppState();

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="wordmark" aria-label="BiaScan — trang chủ">
          Bia<span className="wordmark__scan">Scan</span>
        </Link>
        <nav aria-label="Chính" className="site-nav">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link key={l.href} href={l.href} className="site-nav__link" aria-current={active ? "page" : undefined}>
                {l.label}
              </Link>
            );
          })}
          <button
            type="button"
            className="btn btn--ghost site-nav__chat"
            onClick={() => openChat()}
            aria-haspopup="dialog"
            aria-expanded={chatOpen}
          >
            Hỏi trợ lý
          </button>
        </nav>
      </div>
    </header>
  );
}
