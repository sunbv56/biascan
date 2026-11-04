"use client";

import Markdown, { type Components } from "react-markdown";
import { safeHttpUrl } from "@/lib/format";
import type { BookCard } from "@/lib/types";
import { BookCover } from "./BookCover";

const ALLOWED = ["p", "strong", "em", "ul", "ol", "li", "a", "code", "pre", "blockquote", "br", "h3", "h4", "hr", "del"];

const components: Components = {
  a: ({ href, children }) => {
    const safe = safeHttpUrl(href);
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
};

export function ChatError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="msg msg--error" role="alert">
      <span className="msg__who">Trợ lý chưa trả lời được</span>
      {message}
      {onRetry && (
        <button type="button" className="btn btn--text msg__retry" onClick={onRetry}>
          Thử lại
        </button>
      )}
    </div>
  );
}

export function ChatMessage({ text, products }: { text: string; products?: BookCard[] }) {
  return (
    <div className="msg msg--assistant">
      <span className="sr-only">Trợ lý: </span>
      <div className="prose-chat">
        <Markdown
          skipHtml
          allowedElements={[...ALLOWED, "h1", "h2"]}
          unwrapDisallowed
          components={components}
        >
          {text}
        </Markdown>
      </div>
      {products && products.length > 0 && (
        <ul className="mini-cards" aria-label="Sách được nhắc tới">
          {products.map((p) => {
            const href = safeHttpUrl(p.product_url);
            return (
              <li key={p.image_id} className="mini-card">
                <BookCover src={p.image_url} title={p.title} width={40} sizes="40px" className="mini-card__cover" />
                <div className="mini-card__body">
                  <p className="mini-card__title">{p.title}</p>
                  {p.author && <p className="mini-card__author">{p.author}</p>}
                  {href && (
                    <a className="link-out" href={href} target="_blank" rel="noopener noreferrer">
                      Fahasa<span aria-hidden="true"> ↗</span>
                      <span className="sr-only"> (mở thẻ mới)</span>
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
