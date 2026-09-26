"use client";

import { createContext, useContext, useState } from "react";

interface CompletionState {
  /** The item reads as finished for this reader (struck title). */
  done: boolean;
  /** It became finished by an action on this page view — the strike sweeps instead of standing. */
  animate: boolean;
}

const CompletionContext = createContext<{ state: CompletionState; set: (done: boolean) => void } | null>(null);

/**
 * The work item page's «finished» state, shared by the title and the action row so «انجام شد» can strike the title
 * the moment it is tapped (optimistic) and un-strike it if the server says no. `initialDone` is the server's truth
 * (my own assignment done, or the item closed as done); when a refresh changes it, it wins.
 */
export function CompletionProvider({ initialDone, children }: { initialDone: boolean; children: React.ReactNode }) {
  const [state, setState] = useState<CompletionState & { server: boolean }>({ done: initialDone, animate: false, server: initialDone });
  if (state.server !== initialDone) setState({ done: initialDone, animate: state.animate && initialDone, server: initialDone });
  const set = (done: boolean) => setState((s) => ({ ...s, done, animate: done }));
  return <CompletionContext.Provider value={{ state, set }}>{children}</CompletionContext.Provider>;
}

/** The setter for the action row; `null` outside a provider (the row then just refreshes, as before). */
export function useCompletion(): ((done: boolean) => void) | null {
  return useContext(CompletionContext)?.set ?? null;
}

/**
 * The item's title: struck through and muted once finished. Finished by a tap on this page, the strike sweeps in
 * from the start side (RTL: from the right) over 350 ms; opened already finished, it simply stands.
 */
export function CompletableTitle({ children }: { children: React.ReactNode }) {
  const state = useContext(CompletionContext)?.state;
  const cls = state?.done ? `strike text-text-muted${state.animate ? " strike-sweep" : ""}` : "";
  return <bdi className={`transition-colors duration-(--duration-slow) ${cls}`.trim()}>{children}</bdi>;
}
