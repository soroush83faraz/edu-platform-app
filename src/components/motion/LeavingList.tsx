"use client";

import { useRouter } from "next/navigation";
import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { takeStaleCompleted } from "@/lib/completion-moment";
import { prefersReducedMotion } from "./CrossFade";

type Item = { key: string; node: React.ReactNode; leaving: boolean };

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function keyed(children: React.ReactNode): Item[] {
  return Children.toArray(children)
    .filter(isValidElement)
    .map((node) => ({ key: String(node.key), node, leaving: false }));
}

/** The previous items merged with the next: kept order, a vanished key stays in place marked `leaving`. */
export function mergeItems(prev: readonly Item[], next: readonly Item[]): Item[] {
  const nextKeys = new Set(next.map((i) => i.key));
  const out: Item[] = [];
  let n = 0;
  for (const p of prev) {
    if (nextKeys.has(p.key)) {
      // Everything new that comes before this kept item in the next order goes first.
      while (n < next.length && next[n]!.key !== p.key) {
        if (!out.some((o) => o.key === next[n]!.key)) out.push(next[n]!);
        n++;
      }
      if (n < next.length) {
        out.push(next[n]!);
        n++;
      }
    } else {
      out.push({ ...p, leaving: true });
    }
  }
  for (; n < next.length; n++) if (!out.some((o) => o.key === next[n]!.key)) out.push(next[n]!);
  return out;
}

/**
 * A list whose rows LEAVE instead of popping: when a row (a keyed child rendering an `<li data-row-id>`) is no
 * longer in `children`, it stays in place while it collapses — height to zero and fades out, 280 ms — and is then
 * dropped. Rows that arrive or stay render as usual.
 *
 * `completedFrom` hands over what the detail page just finished (`src/lib/completion-moment.ts`): when the router
 * brought this list back from its cache still showing such a row, the row is struck through at once and the list
 * refreshes — the fresh server list no longer has it, so it collapses away. Under reduced motion rows go at once.
 */
export function LeavingList({ children, className, completedFrom = false }: { children: React.ReactNode; className?: string; completedFrom?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLUListElement>(null);
  const [state, setState] = useState(() => ({ source: children, items: keyed(children) }));
  if (state.source !== children) setState({ source: children, items: mergeItems(state.items, keyed(children)) });
  const items = state.items;
  const leavingKeys = items.filter((i) => i.leaving).map((i) => i.key).join(",");

  useLayoutEffect(() => {
    const list = ref.current;
    if (!leavingKeys || !list) return;
    const keys = leavingKeys.split(",");
    const done = () => setState((s) => ({ ...s, items: s.items.filter((i) => !(i.leaving && keys.includes(i.key))) }));
    if (prefersReducedMotion()) {
      done();
      return;
    }
    const animations = keys.flatMap((key) => {
      const li = list.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(key.replace(/^\.\$/, ""))}"]`);
      if (!li || typeof li.animate !== "function") return [];
      li.style.overflow = "hidden";
      li.style.pointerEvents = "none";
      return [
        li.animate(
          [
            // min-height and padding go too, so a row that sets its own minimum still folds all the way.
            { height: `${li.offsetHeight}px`, minHeight: "0px", opacity: 1 },
            { height: "0px", minHeight: "0px", paddingBlock: "0px", borderBlockWidth: "0px", opacity: 0 },
          ],
          { duration: 280, easing: EASE, fill: "forwards" },
        ),
      ];
    });
    if (animations.length === 0) {
      done();
      return;
    }
    let cancelled = false;
    void Promise.all(animations.map((a) => a.finished)).then(
      () => !cancelled && done(),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [leavingKeys]);

  // A row finished on the detail page but still here: this render came from the router's cache.
  useEffect(() => {
    if (!completedFrom || !ref.current) return;
    const ids = [...ref.current.querySelectorAll<HTMLElement>("[data-row-id]")].map((li) => li.dataset.rowId!);
    const stale = takeStaleCompleted(ids);
    if (stale.length === 0) return;
    for (const id of stale) ref.current.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.setAttribute("data-completing", "");
    router.refresh();
  }, [completedFrom, router]);

  return (
    <ul ref={ref} className={className}>
      {items.map((i) => i.node)}
    </ul>
  );
}
