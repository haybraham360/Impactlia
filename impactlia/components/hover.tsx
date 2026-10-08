"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

// What the pointer is over, in the graph or in the detail pane. A hovered file
// also names its folder, because a closed folder is the only place that file
// is drawn.
export type Hover = { file: string | null; folder: string | null };

const NOTHING: Hover = { file: null, folder: null };

export type HoverStore = {
  get: () => Hover;
  set: (hover: Hover | null) => void;
  subscribe: (listener: () => void) => () => void;
};

// Hover is kept outside React state on purpose. Each row subscribes to one
// yes-or-no answer about itself, so moving the pointer re-renders the two rows
// whose answer changed instead of the whole graph.
export function createHoverStore(): HoverStore {
  let current = NOTHING;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(hover) {
      const next = hover ?? NOTHING;
      if (next.file === current.file && next.folder === current.folder) return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const HoverContext = createContext<HoverStore | null>(null);

function useHoverStore(): HoverStore {
  const store = useContext(HoverContext);
  if (!store) throw new Error("Hover is used outside the analysis workspace.");
  return store;
}

export function useHovered(matches: (hover: Hover) => boolean): boolean {
  const store = useHoverStore();
  return useSyncExternalStore(
    store.subscribe,
    () => matches(store.get()),
    () => false,
  );
}

// Props for an element that stands for a file or folder. Keyboard focus counts
// as hovering.
export function useHoverTarget(target: Hover) {
  const store = useHoverStore();
  const enter = () => store.set(target);
  const leave = () => store.set(null);
  return { onMouseEnter: enter, onMouseLeave: leave, onFocus: enter, onBlur: leave };
}

// How a row looks while its counterpart is hovered. The same in the graph and
// in the pane, and distinct from the selection's filled accent.
export const HOVERED_CLASS = "bg-canvas outline-1 -outline-offset-1 outline-ink";
