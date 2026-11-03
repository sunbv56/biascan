"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { chat, errorMessage } from "@/lib/api";
import { EASE_IN, EASE_OUT, prefersReducedMotion } from "@/lib/motion";
import { getSessionId } from "@/lib/session";
import type { BookCard } from "@/lib/types";
import { useAppState } from "./AppState";
import { ChatMessage } from "./ChatMessage";

gsap.registerPlugin(useGSAP);

export interface ChatTurn {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
  products?: BookCard[];
}

const STARTERS_WITH_CONTEXT = ["So sánh giúp mình 3 cuốn khớp nhất.", "Cuốn nào hợp với người mới đọc?", "Có cuốn nào tương tự cuốn đầu tiên không?"];
const STARTERS_DEFAULT = ["Gợi ý sách kỹ năng cho sinh viên năm nhất", "Truyện thiếu nhi cho bé 6 tuổi", "Sách lịch sử Việt Nam dễ đọc"];

export function ChatDrawer() {
  const { chatOpen, closeChat, chatInput: input, setChatInput: setInput, lastResults, returnFocusRef } = useAppState();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const titleId = useId();
  const inputId = useId();

  const contextIds = lastResults.map((r) => r.image_id);

  const wasOpen = useRef(false);

  useGSAP(
    () => {
      if (!chatOpen && !wasOpen.current) return;
      wasOpen.current = chatOpen;
      const reduce = prefersReducedMotion();
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      if (!panel || !scrim) return;
      if (chatOpen) {
        document.documentElement.dataset.chatOpen = "true";
        gsap.fromTo(scrim, { autoAlpha: 0 }, { autoAlpha: 1, duration: reduce ? 0.15 : 0.42, ease: EASE_OUT });
        gsap.fromTo(
          panel,
          reduce ? { autoAlpha: 0 } : { xPercent: 100, autoAlpha: 1 },
          { xPercent: 0, autoAlpha: 1, duration: reduce ? 0.15 : 0.42, ease: EASE_OUT, onComplete: () => inputRef.current?.focus() },
        );
      } else {
        delete document.documentElement.dataset.chatOpen;
        gsap.to(scrim, { autoAlpha: 0, duration: reduce ? 0.12 : 0.3, ease: EASE_IN });
        gsap.to(panel, {
          ...(reduce ? { autoAlpha: 0 } : { xPercent: 100 }),
          duration: reduce ? 0.12 : 0.3,
          ease: EASE_IN,
          onComplete: () => gsap.set(panel, { autoAlpha: 0 }),
        });
        returnFocusRef.current?.focus?.();
      }
    },
    { dependencies: [chatOpen], scope: rootRef },
  );

  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeChat();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chatOpen, closeChat]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns, sending]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || sending) return;
      setTurns((t) => [...t, { id: nextId.current++, role: "user", text: message }]);
      setInput("");
      setSending(true);
      inputRef.current?.focus();
      try {
        const res = await chat({ session_id: getSessionId(), message, context_ids: contextIds });
        setTurns((t) => [...t, { id: nextId.current++, role: "assistant", text: res.reply, products: res.products }]);
        setSuggestions(res.suggestions.slice(0, 4));
      } catch (err) {
        setTurns((t) => [...t, { id: nextId.current++, role: "error", text: errorMessage(err).message }]);
      } finally {
        setSending(false);
      }
    },
    [contextIds, sending, setInput],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const chips = turns.length === 0 ? (contextIds.length ? STARTERS_WITH_CONTEXT : STARTERS_DEFAULT) : suggestions;

  return (
    <div ref={rootRef} className="drawer-root" inert={!chatOpen} data-open={chatOpen}>
      <div ref={scrimRef} className="drawer-scrim" onClick={closeChat} aria-hidden="true" />
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onPanelKeyDown}
      >
        <header className="drawer__head">
          <div>
            <h2 id={titleId} className="drawer__title">
              Trợ lý chọn sách
            </h2>
            <p className="mono-note">
              {contextIds.length ? `Đang dựa trên ${contextIds.length} kết quả tìm gần nhất` : "Chưa có kết quả tìm — trợ lý tìm trong cả kho"}
            </p>
          </div>
          <button type="button" className="btn btn--text drawer__close" onClick={closeChat}>
            Đóng
          </button>
        </header>

        <div ref={logRef} className="drawer__log" role="log" aria-live="polite" aria-relevant="additions">
          {turns.length === 0 && (
            <p className="drawer__intro">
              Hỏi về nội dung, độ khó, đối tượng đọc, hay nhờ so sánh vài cuốn. Trợ lý chỉ gợi ý sách có trong kho dữ liệu.
            </p>
          )}
          {turns.map((t) => (
            <ChatMessage key={t.id} turn={t} />
          ))}
          {sending && (
            <p className="chat-typing" role="status">
              Trợ lý đang viết…
            </p>
          )}
        </div>

        {chips.length > 0 && !sending && (
          <ul className="chips" aria-label="Câu hỏi gợi ý">
            {chips.map((c) => (
              <li key={c}>
                <button type="button" className="chip" onClick={() => void send(c)}>
                  {c}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="drawer__form" onSubmit={onSubmit}>
          <label htmlFor={inputId} className="sr-only">
            Câu hỏi cho trợ lý
          </label>
          <textarea
            id={inputId}
            ref={inputRef}
            className="textarea drawer__input"
            rows={2}
            maxLength={1000}
            value={input}
            placeholder="Hỏi về một cuốn sách…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <button type="submit" className="btn btn--primary" disabled={sending || !input.trim()}>
            Gửi
          </button>
        </form>
      </div>
    </div>
  );
}
