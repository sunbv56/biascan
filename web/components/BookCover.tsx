"use client";

import Image from "next/image";
import { useState } from "react";
import { hostOf } from "@/lib/format";

const OPTIMIZED_HOSTS = new Set(["cdn0.fahasa.com"]);

interface Props {
  src: string;
  title: string;
  width: number;
  sizes: string;
  priority?: boolean;
  className?: string;
}

export function BookCover({ src, title, width, sizes, priority, className }: Props) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(src);
  const height = Math.round(width * 1.45);

  if (!src || !host || failed) {
    return (
      <div className={`cover cover--missing ${className ?? ""}`} style={{ aspectRatio: `${width} / ${height}` }} aria-hidden="true">
        <span>Không có ảnh bìa</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={`Bìa sách ${title}`}
      width={width}
      height={height}
      sizes={sizes}
      priority={priority}
      unoptimized={!OPTIMIZED_HOSTS.has(host)}
      onError={() => setFailed(true)}
      className={`cover ${className ?? ""}`}
    />
  );
}
