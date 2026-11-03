"use client";

import Markdown, { type Components } from "react-markdown";
import { safeHttpUrl } from "@/lib/format";
import type { ChatTurn } from "./ChatDrawer";
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

export function ChatMessage({ turn }: { turn: ChatTurn }) {
  if (turn.role === "user") {
    return (
      <div className="msg msg--user">
        <span className="sr-only">Bạn: </span>
        {turn.text}
      </div>
    );
  }
  if (turn.role === "error") {
    return (
      <div className="msg msg--error" role="alert">
        <span className="msg__who">Không gửi được</span>
        {turn.text}
      </div>
    );
  }
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
          {turn.text}
        </Markdown>
      </div>
      {turn.products && turn.products.length > 0 && (
        <ul className="mini-cards" aria-label="Sách được nhắc tới">
          {turn.products.map((p) => {
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
