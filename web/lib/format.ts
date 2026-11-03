const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat("vi-VN", opts);

export const formatInt = (n: number) => nf({ maximumFractionDigits: 0 }).format(n);
export const formatPercent = (v: number) => nf({ style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
export const formatDecimal = (v: number, digits = 3) => nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
export const formatMs = (v: number) => `${formatInt(Math.round(v))} ms`;

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function safeHttpUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
