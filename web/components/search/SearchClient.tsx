"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useCallback, useRef, useState } from "react";
import { ApiError, errorMessage, searchBooks } from "@/lib/api";
import { prefersReducedMotion, EASE_OUT } from "@/lib/motion";
import { getSessionId } from "@/lib/session";
import type { ApiErrorCode, SearchRequest, SearchResponse } from "@/lib/types";
import { useAppState } from "../AppState";
import { SearchForm } from "./SearchForm";
import { EmptyState, ErrorState, LoadingState, NoResults, Results } from "./SearchStates";

gsap.registerPlugin(useGSAP);

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; hasImage: boolean; startedAt: number }
  | { kind: "error"; code: ApiErrorCode; message: string; status: number }
  | { kind: "done"; data: SearchResponse; query: string | null; runId: number };

function statusText(phase: Phase): string {
  if (phase.kind === "loading") return "Đang tìm sách…";
  if (phase.kind === "error") return "";
  if (phase.kind === "done") return phase.data.results.length ? `Đã có ${phase.data.results.length} kết quả.` : "Không có kết quả.";
  return "";
}

export function SearchClient() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const lastRequest = useRef<Omit<SearchRequest, "session_id"> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const runCounter = useRef(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const resultsColRef = useRef<HTMLElement>(null);
  const { setLastResults, openChat } = useAppState();

  const run = useCallback(
    async (req: Omit<SearchRequest, "session_id">) => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      lastRequest.current = req;
      setPhase({ kind: "loading", hasImage: Boolean(req.image), startedAt: Date.now() });
      if (window.matchMedia("(max-width: 59.99rem)").matches) {
        resultsColRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      }
      try {
        const data = await searchBooks({ ...req, session_id: getSessionId() }, controller.signal);
        if (controller.signal.aborted) return;
        setPhase({ kind: "done", data, query: req.query?.trim() || null, runId: ++runCounter.current });
        if (data.results.length) setLastResults(data.results);
      } catch (err) {
        if (controller.signal.aborted) return;
        const { code, message } = errorMessage(err);
        setPhase({ kind: "error", code, message, status: err instanceof ApiError ? err.status : 0 });
      } finally {
        if (inflight.current === controller) inflight.current = null;
      }
    },
    [setLastResults],
  );

  const retry = useCallback(() => {
    if (lastRequest.current) void run(lastRequest.current);
  }, [run]);

  useGSAP(
    () => {
      if (phase.kind !== "done" || prefersReducedMotion()) return;
      gsap.from("[data-reveal]", { autoAlpha: 0, y: 10, duration: 0.42, ease: EASE_OUT, stagger: 0.05, clearProps: "all" });
    },
    { dependencies: [phase], scope: resultsRef, revertOnUpdate: true },
  );

  return (
    <div className="search-layout">
      <section className="search-form-col" aria-labelledby="tieu-de-tim">
        <h1 id="tieu-de-tim" className="page-title">
          Tìm sách
        </h1>
        <p className="page-lede">Chụp bìa, tải ảnh lên, hoặc kể vài dòng về cuốn sách. Dùng cả hai thì càng chính xác.</p>
        <SearchForm busy={phase.kind === "loading"} onSubmit={run} />
      </section>

      <section ref={resultsColRef} className="search-results-col" aria-labelledby="tieu-de-ket-qua" aria-busy={phase.kind === "loading"}>
        <h2 id="tieu-de-ket-qua" className="sr-only">
          Kết quả
        </h2>
        <p className="sr-only" role="status">
          {statusText(phase)}
        </p>
        <div ref={resultsRef}>
          {phase.kind === "idle" && <EmptyState />}
          {phase.kind === "loading" && <LoadingState hasImage={phase.hasImage} startedAt={phase.startedAt} />}
          {phase.kind === "error" && <ErrorState code={phase.code} message={phase.message} status={phase.status} onRetry={retry} />}
          {phase.kind === "done" &&
            (phase.data.results.length === 0 ? (
              <NoResults ocrText={phase.data.ocr_text} />
            ) : (
              <Results key={phase.runId} data={phase.data} query={phase.query} onAsk={() => openChat("So sánh giúp mình 3 cuốn khớp nhất.")} />
            ))}
        </div>
      </section>
    </div>
  );
}
