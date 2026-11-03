import { BookCover } from "./BookCover";
import { formatDecimal, safeHttpUrl } from "@/lib/format";
import type { BookCard, SearchResult } from "@/lib/types";

function Meta({ book }: { book: BookCard }) {
  return (
    <dl className="book-meta">
      {book.author && (
        <div>
          <dt>Tác giả</dt>
          <dd>{book.author}</dd>
        </div>
      )}
      {book.publisher && (
        <div>
          <dt>NXB</dt>
          <dd>{book.publisher}</dd>
        </div>
      )}
    </dl>
  );
}

function FahasaLink({ book, compact }: { book: BookCard; compact?: boolean }) {
  const href = safeHttpUrl(book.product_url);
  if (!href) return null;
  return (
    <a className="link-out" href={href} target="_blank" rel="noopener noreferrer">
      {compact ? "Fahasa" : "Xem trên Fahasa"}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (mở thẻ mới)</span>
    </a>
  );
}

export function TopResultCard({ book, rank }: { book: SearchResult; rank: number }) {
  return (
    <article className="top-card" data-reveal>
      <span className="top-card__rank" aria-hidden="true">
        {rank}
      </span>
      <BookCover src={book.image_url} title={book.title} width={132} sizes="(min-width: 40rem) 132px, 96px" priority={rank === 1} className="top-card__cover" />
      <div className="top-card__body">
        <h3 className="top-card__title">
          <span className="sr-only">Hạng {rank}: </span>
          {book.title || "Không rõ tên sách"}
        </h3>
        <Meta book={book} />
        {book.reason && (
          <p className="top-card__reason">
            <span className="top-card__reason-label">Vì sao khớp</span>
            {book.reason.replace(/\*\*|__/g, "")}
          </p>
        )}
        <div className="top-card__foot">
          <FahasaLink book={book} />
          <span className="score" title="Điểm tương đồng từ pgvector (đã cộng điểm khớp tên)">
            điểm {formatDecimal(book.score, 2)}
          </span>
        </div>
      </div>
    </article>
  );
}

export function CompactCard({ book }: { book: SearchResult | BookCard }) {
  return (
    <article className="compact-card" data-reveal>
      <BookCover src={book.image_url} title={book.title} width={72} sizes="72px" className="compact-card__cover" />
      <div className="compact-card__body">
        <h3 className="compact-card__title">{book.title || "Không rõ tên sách"}</h3>
        {book.author && <p className="compact-card__author">{book.author}</p>}
        {book.publisher && <p className="compact-card__pub">{book.publisher}</p>}
        <FahasaLink book={book} compact />
      </div>
    </article>
  );
}
