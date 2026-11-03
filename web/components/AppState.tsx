"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { SearchResult } from "@/lib/types";

interface AppState {
  lastResults: SearchResult[];
  setLastResults: (r: SearchResult[]) => void;
  chatOpen: boolean;
  chatInput: string;
  setChatInput: (v: string) => void;
  openChat: (draft?: string) => void;
  closeChat: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [lastResults, setLastResults] = useState<SearchResult[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openChat = useCallback((draft?: string) => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    if (draft) setChatInput(draft);
    setChatOpen(true);
  }, []);

  const closeChat = useCallback(() => setChatOpen(false), []);

  const value = useMemo(
    () => ({ lastResults, setLastResults, chatOpen, chatInput, setChatInput, openChat, closeChat, returnFocusRef }),
    [lastResults, chatOpen, chatInput, openChat, closeChat],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState phải nằm trong AppStateProvider");
  return v;
}
