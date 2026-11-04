"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, chat, errorMessage, searchBooks } from "@/lib/api";
import { fetchSampleImage, ImagePrepError } from "@/lib/image";
import { prefersReducedMotion } from "@/lib/motion";
import type { SampleCover } from "@/lib/samples";
import { getSessionId, resetSessionId } from "@/lib/session";
import type { ApiErrorCode, BookCard, SearchRequest, SearchResponse } from "@/lib/types";
import { ChatError, ChatMessage } from "../ChatMessage";
import { Composer, type ComposerSend } from "./Composer";
import { EmptyState, ERROR_TITLES, ErrorState, LoadingState, NoResults, Results, RETRYABLE } from "./SearchStates";

type SearchReq = Omit<SearchRequest, "session_id">;
type SearchTurn = Extract<Turn, { role: "search" }>;

const WIDE = "(min-width: 60rem)";

function subscribeWide(cb: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
}

function summaryText(t: SearchTurn): string {
  if (t.phase.kind === "loading") return "Đang tìm…";
  if (t.phase.kind === "error") return ERROR_TITLES[t.phase.code];
  const n = t.phase.data.results.length;
  return n ? `${n} kết quả · ${t.phase.data.results[0].title || "Không rõ tên sách"}` : "Không tìm thấy cuốn nào";
}

type SearchPhase =
  | { kind: "loading"; startedAt: number }
  | { kind: "error"; code: ApiErrorCode; message: string; status: number }
  | { kind: "done"; data: SearchResponse };

type Turn =
  | { id: number; role: "user"; text: string; image: string | null; imageName: string }
  | { id: number; role: "search"; req: SearchReq; phase: SearchPhase; cover?: SampleCover; reasons?: Record<string, string> }
  | { id: number; role: "assistant"; text: string; products: BookCard[] }
  | { id: number; role: "chat-error"; code: ApiErrorCode; message: string; retryText: string };

const STARTERS = ["So sánh giúp mình 3 cuốn khớp nhất.", "Cuốn nào hợp với người mới đọc?", "Có cuốn nào tương tự cuốn đầu tiên không?"];
const COMPARE = STARTERS[0];

function statusText(turns: Turn[], asking: boolean): string {
  if (asking) return "Trợ lý đang viết…";
  const last = turns[turns.length - 1];
  if (last?.role !== "search") return "";
  if (last.phase.kind === "loading") return "Đang tìm sách…";
  if (last.phase.kind === "done") return last.phase.data.results.length ? `Đã có ${last.phase.data.results.length} kết quả.` : "Không có kết quả.";
  return "";
}

function latestContext(turns: Turn[]): { latestSearchId: number | null; contextIds: string[] } {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === "search" && t.phase.kind === "done" && t.phase.data.results.length) {
      return { latestSearchId: t.id, contextIds: t.phase.data.results.map((r) => r.image_id) };
    }
  }
  return { latestSearchId: null, contextIds: [] };
}

interface SearchViewProps {
  turn: SearchTurn;
  onRetry: () => void;
  onAsk?: () => void;
  onReasons: (r: Record<string, string>) => void;
}

function SearchView({ turn: t, onRetry, onAsk, onReasons }: SearchViewProps) {
  if (t.phase.kind === "loading") return <LoadingState hasImage={Boolean(t.req.image)} startedAt={t.phase.startedAt} />;
  if (t.phase.kind === "error") return <ErrorState code={t.phase.code} message={t.phase.message} status={t.phase.status} onRetry={onRetry} />;
  if (t.phase.data.results.length === 0) return <NoResults ocrText={t.phase.data.ocr_text} />;
  return <Results data={t.phase.data} query={t.req.query?.trim() || null} onAsk={onAsk} savedReasons={t.reasons} onReasons={onReasons} />;
}

export function SearchClient() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [loadingCover, setLoadingCover] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const scrollTo = useRef<number | null>(null);
  const wide = useWide();

  const searching = turns.some((t) => t.role === "search" && t.phase.kind === "loading");
  const busy = searching || asking || loadingCover !== null;

  const { latestSearchId, contextIds } = useMemo(() => latestContext(turns), [turns]);

  useEffect(() => () => inflight.current?.abort(), []);

  useEffect(() => {
    if (scrollTo.current === null) return;
    const log = logRef.current;
    const el = log?.querySelector<HTMLElement>(`[data-turn="${scrollTo.current}"]`);
    scrollTo.current = null;
    if (!log || !el) return;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (log.scrollHeight > log.clientHeight) log.scrollTo({ top: el.offsetTop - 8, behavior });
    else if (!window.matchMedia(WIDE).matches) el.scrollIntoView({ behavior, block: "start" });
  }, [turns]);

  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);

  const append = useCallback((...items: Turn[]) => {
    setTurns((t) => [...t, ...items]);
    if (items.length) scrollTo.current = items[0].id;
  }, []);

  const patchSearch = (id: number, phase: SearchPhase) =>
    setTurns((all) => all.map((t) => (t.id === id && t.role === "search" ? { ...t, phase } : t)));

  const runSearch = useCallback(async (id: number, req: SearchReq) => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    patchSearch(id, { kind: "loading", startedAt: Date.now() });
    try {
      const data = await searchBooks({ ...req, session_id: getSessionId() }, controller.signal);
      if (controller.signal.aborted) return;
      patchSearch(id, { kind: "done", data });
      setSuggestions(data.results.length ? STARTERS : []);
    } catch (err) {
      if (controller.signal.aborted) return;
      const { code, message } = errorMessage(err);
      patchSearch(id, { kind: "error", code, message, status: err instanceof ApiError ? err.status : 0 });
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  }, []);

  const search = useCallback(
    (req: SearchReq, echo: { text: string; image: string | null; imageName: string }) => {
      const userId = nextId.current++;
      const searchId = nextId.current++;
      setSuggestions([]);
      setSelectedId(searchId);
      append(
        { id: userId, role: "user", ...echo },
        { id: searchId, role: "search", req, phase: { kind: "loading", startedAt: Date.now() } },
      );
      void runSearch(searchId, req);
    },
    [append, runSearch],
  );

  const ask = useCallback(
    async (message: string, echo = true) => {
      if (!message || asking) return;
      if (echo) append({ id: nextId.current++, role: "user", text: message, image: null, imageName: "" });
      setSuggestions([]);
      setAsking(true);
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      try {
        const res = await chat({ session_id: getSessionId(), message, context_ids: contextIds }, controller.signal);
        if (controller.signal.aborted) return;
        append({ id: nextId.current++, role: "assistant", text: res.reply, products: res.products });
        setSuggestions(res.suggestions.slice(0, 4));
      } catch (err) {
        if (controller.signal.aborted) return;
        const { code, message: msg } = errorMessage(err);
        append({ id: nextId.current++, role: "chat-error", code, message: msg, retryText: message });
      } finally {
        if (inflight.current === controller) inflight.current = null;
        if (!controller.signal.aborted) setAsking(false);
      }
    },
    [append, asking, contextIds],
  );

  function retryChat(turnId: number, text: string) {
    setTurns((all) => all.filter((t) => t.id !== turnId));
    void ask(text, false);
  }

  function onSend(msg: ComposerSend) {
    if (msg.mode === "ask") {
      void ask(msg.text);
      return;
    }
    search({ query: msg.text || undefined, image: msg.image ?? undefined }, { text: msg.text, image: msg.image, imageName: msg.imageName });
  }

  async function runSampleCover(cover: SampleCover) {
    if (busy) return;
    setLoadingCover(cover.image_id);
    try {
      const url = await fetchSampleImage(cover.image_url);
      search({ image: url }, { text: "", image: url, imageName: `Ảnh mẫu: ${cover.title}` });
    } catch (err) {
      const message = err instanceof ImagePrepError ? err.message : "Không tải được ảnh mẫu. Thử lại sau.";
      const id = nextId.current++;
      setSelectedId(id);
      append({ id, role: "search", req: {}, cover, phase: { kind: "error", code: "network", message, status: 0 } });
    } finally {
      setLoadingCover(null);
    }
  }

  function newConversation() {
    inflight.current?.abort();
    inflight.current = null;
    resetSessionId();
    setSelectedId(null);
    setTurns([]);
    setSuggestions([]);
    setAsking(false);
  }

  function retrySearch(t: SearchTurn) {
    if (busy) return;
    if (t.cover) {
      const cover = t.cover;
      setTurns((all) => all.filter((x) => x.id !== t.id));
      void runSampleCover(cover);
    } else void runSearch(t.id, t.req);
  }

  function saveReasons(id: number, r: Record<string, string>) {
    setTurns((all) => all.map((x) => (x.id === id && x.role === "search" ? { ...x, reasons: r } : x)));
  }

  const selected = turns.find((t): t is SearchTurn => t.role === "search" && t.id === selectedId) ?? null;
  const empty = <EmptyState disabled={busy} loadingCover={loadingCover} onQuery={(q) => search({ query: q }, { text: q, image: null, imageName: "" })} onCover={(c) => void runSampleCover(c)} />;

  return (
    <div className="convo">
      <header className="convo__head">
        <div>
          <h1 className="page-title">Tìm sách</h1>
          <p className="page-lede">Chụp bìa, tải ảnh lên, hoặc kể vài dòng về cuốn sách — rồi hỏi tiếp trợ lý ngay tại đây.</p>
        </div>
        {turns.length > 0 && (
          <button type="button" className="btn btn--ghost convo__new" onClick={newConversation}>
            Cuộc hội thoại mới
          </button>
        )}
      </header>

      <div className="convo__body">
        <section className="convo__chat" aria-label="Hội thoại">
          <div ref={logRef} className="convo__log" role="log" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
            <p className="sr-only" role="status">
              {statusText(turns, asking)}
            </p>

            {turns.length === 0 && (wide ? <p className="convo__intro">Kết quả hiện ở khung bên phải; câu hỏi tiếp và câu trả lời của trợ lý nằm ở đây.</p> : empty)}

            {turns.map((t) => (
              <div key={t.id} data-turn={t.id} className={`turn turn--${t.role}`}>
                {t.role === "user" && (
                  <div className="msg msg--user">
                    <span className="sr-only">Bạn: </span>
                    {t.image && (
                      // eslint-disable-next-line @next/next/no-img-element -- data URL cục bộ, next/image không tối ưu được
                      <img src={t.image} alt={t.imageName || "Ảnh bìa đã gửi"} className="msg__img" />
                    )}
                    {t.text && <span className="msg__text">{t.text}</span>}
                  </div>
                )}
                {t.role === "search" && (
                  <>
                    <button
                      type="button"
                      className="search-chip"
                      data-status={t.phase.kind}
                      aria-pressed={wide ? t.id === selectedId : undefined}
                      aria-expanded={wide ? undefined : t.id === selectedId}
                      onClick={() => setSelectedId(wide || t.id !== selectedId ? t.id : null)}
                    >
                      <span className="search-chip__text">{summaryText(t)}</span>
                      <span className="search-chip__action">{t.id === selectedId ? (wide ? "Đang xem" : "Thu gọn") : "Xem"}</span>
                    </button>
                    {!wide && t.id === selectedId && (
                      <div className="turn__results">
                        <SearchView
                          turn={t}
                          onRetry={() => retrySearch(t)}
                          onAsk={t.id === latestSearchId && !busy ? () => void ask(COMPARE) : undefined}
                          onReasons={(r) => saveReasons(t.id, r)}
                        />
                      </div>
                    )}
                  </>
                )}
                {t.role === "assistant" && <ChatMessage text={t.text} products={t.products} />}
                {t.role === "chat-error" && (
                  <ChatError message={t.message} onRetry={RETRYABLE.has(t.code) && !busy ? () => retryChat(t.id, t.retryText) : undefined} />
                )}
              </div>
            ))}

            {asking && (
              <p className="chat-typing" aria-hidden="true">
                Trợ lý đang viết…
              </p>
            )}

            {suggestions.length > 0 && !busy && (
              <ul className="chips" aria-label="Câu hỏi gợi ý">
                {suggestions.map((c) => (
                  <li key={c}>
                    <button type="button" className="chip" onClick={() => void ask(c)}>
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="convo__dock">
            <Composer busy={busy} hasResults={contextIds.length > 0} onSend={onSend} />
          </div>
        </section>

        {wide && (
          <section ref={panelRef} className="convo__panel" aria-label="Kết quả">
            {selected ? (
              <SearchView
                key={selected.id}
                turn={selected}
                onRetry={() => retrySearch(selected)}
                onAsk={selected.id === latestSearchId && !busy ? () => void ask(COMPARE) : undefined}
                onReasons={(r) => saveReasons(selected.id, r)}
              />
            ) : turns.length === 0 ? empty : <p className="convo__intro">Chọn một lượt tìm bên trái để xem lại kết quả.</p>}
          </section>
        )}
      </div>
    </div>
  );
}
