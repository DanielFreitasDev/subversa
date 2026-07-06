/**
 * Pilha de desfazer/refazer genérica e PURA (sem React), sobre um valor `T`.
 *
 * Modelo clássico `{ past, present, future }`: `push` empilha o `present` atual em
 * `past` e adota o novo valor; `undo`/`redo` andam entre as pilhas. Um `push` pode
 * COALESCER com o anterior passando a mesma `coalesceKey` — assim uma rajada de
 * digitação (várias teclas no mesmo trecho) vira uma única entrada de histórico,
 * em vez de uma por tecla. A lógica fica aqui (testável sem DOM); o `useHistory`
 * (em `@/hooks/useHistory`) é só um invólucro fino de React por cima.
 */

/** Teto de entradas guardadas (evita memória sem limite em sessões longas). */
const LIMIT = 200;

export interface History<T> {
  /** Estados anteriores (mais antigo → mais recente). */
  past: T[];
  /** Estado atual. */
  present: T;
  /** Estados refeitíveis (próximo redo primeiro). */
  future: T[];
  /** Chave do último `push` coalescível; o próximo `push` com a mesma chave agrupa. */
  coalesceKey?: string;
}

/** Histórico inicial: só o `present`, sem nada para desfazer/refazer. */
export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Adota `next` como novo `present`. Se `coalesceKey` for igual à do `push`
 * anterior, substitui o `present` sem empilhar (agrupa a edição contínua);
 * caso contrário empilha o `present` atual. Sempre limpa o `future` (um novo
 * caminho invalida o que havia para refazer).
 */
export function push<T>(h: History<T>, next: T, coalesceKey?: string): History<T> {
  if (coalesceKey !== undefined && coalesceKey === h.coalesceKey) {
    return { past: h.past, present: next, future: [], coalesceKey };
  }
  const past = h.past.length >= LIMIT ? h.past.slice(h.past.length - LIMIT + 1) : h.past.slice();
  past.push(h.present);
  return { past, present: next, future: [], coalesceKey };
}

/** Volta um passo (ou devolve `h` inalterado se não há o que desfazer). */
export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const present = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present,
    future: [h.present, ...h.future],
    coalesceKey: undefined,
  };
}

/** Refaz um passo (ou devolve `h` inalterado se não há o que refazer). */
export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [present, ...future] = h.future;
  return {
    past: [...h.past, h.present],
    present,
    future,
    coalesceKey: undefined,
  };
}

/** Recomeça do zero com `present` (limpa past/future) — ex.: ao trocar de arquivo. */
export function reset<T>(present: T): History<T> {
  return initHistory(present);
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}
