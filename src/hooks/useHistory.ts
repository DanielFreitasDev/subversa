/**
 * Invólucro React da pilha de desfazer/refazer pura (`@/lib/history`). Guarda o
 * histórico num `useReducer` e expõe o `present` mais as ações. `set` aceita um
 * valor novo ou uma função atualizadora (como `setState`), e uma `coalesceKey`
 * opcional para agrupar edições contínuas numa entrada só de histórico.
 */

import { useCallback, useMemo, useReducer } from "react";

import {
  type History,
  initHistory,
  push,
  redo as redoH,
  reset as resetH,
  undo as undoH,
} from "@/lib/history";

type Action<T> =
  | { type: "set"; updater: T | ((cur: T) => T); coalesceKey?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; value: T };

function reduce<T>(h: History<T>, a: Action<T>): History<T> {
  switch (a.type) {
    case "set": {
      const next =
        typeof a.updater === "function" ? (a.updater as (cur: T) => T)(h.present) : a.updater;
      return push(h, next, a.coalesceKey);
    }
    case "undo":
      return undoH(h);
    case "redo":
      return redoH(h);
    case "reset":
      return resetH(a.value);
  }
}

export interface UseHistory<T> {
  present: T;
  set: (updater: T | ((cur: T) => T), coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  reset: (value: T) => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useHistory<T>(initial: T): UseHistory<T> {
  const [state, dispatch] = useReducer(reduce<T>, initial, initHistory);

  const set = useCallback(
    (updater: T | ((cur: T) => T), coalesceKey?: string) =>
      dispatch({ type: "set", updater, coalesceKey }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const reset = useCallback((value: T) => dispatch({ type: "reset", value }), []);

  return useMemo(
    () => ({
      present: state.present,
      set,
      undo,
      redo,
      reset,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state, set, undo, redo, reset],
  );
}
