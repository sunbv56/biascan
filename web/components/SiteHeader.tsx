"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const LINKS = [
  { href: "/", label: "Tìm sách" },
  { href: "/eval", label: "Đo lường" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header ref={ref} className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="wordmark" aria-label="BiaScan — trang chủ">
          Bia<span className="wordmark__scan">Scan</span>
        </Link>
        <nav aria-label="Chính" className="site-nav">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link key={l.href} href={l.href} className="site-nav__link" aria-current={active ? "page" : undefined}>
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
