/**
 * Estado e lógica da busca no navegador de repositórios. Vive num hook único,
 * chamado uma vez pela `ReposView`, e compartilhado entre a barra de busca (que
 * tem o input) e a lista de resultados (que substitui a árvore enquanto a busca
 * está ativa).
 *
 * Dois modos:
 * - **nome** (arquivo/pasta): filtro client-side instantâneo sobre a listagem
 *   recursiva (`list_tree`) do escopo, com debounce. Sem ida ao servidor a cada tecla.
 * - **conteúdo**: busca explícita (Enter/botão) via `search_content` — baixa
 *   (`svn cat`) cada arquivo do escopo. Custosa, então é manual e mostra progresso.
 *
 * Escopo = a pasta selecionada (ou a raiz da localização, se nada selecionado).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import * as api from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import type { ListEntry, OpProgress, SearchMatch } from "@/lib/types";
import { decodeUrlSafe, dirName } from "@/lib/utils";
import { nodeKind, useRepoBrowserStore, type RepoNode } from "@/store/repoBrowser";

export type SearchMode = "name" | "content";

/** Teto de itens de nome exibidos (a lista é plana e barata, mas evitamos milhares). */
const NAME_RESULTS_LIMIT = 500;

/** Um resultado da busca por nome: nó já pronto + caminho relativo (p/ exibição). */
export interface NameResult {
  node: RepoNode;
  /** Caminho relativo ao escopo (cru/encodado). */
  rel: string;
}

export interface UseRepoSearch {
  mode: SearchMode;
  query: string;
  /** Escopo atual (vivo), derivado da seleção/localização. */
  scope: string | null;
  /** `true` quando os resultados devem substituir a árvore. */
  active: boolean;
  setMode: (m: SearchMode) => void;
  setQuery: (q: string) => void;
  /** Dispara a busca por conteúdo (Enter/botão). No-op fora do modo conteúdo. */
  submit: () => void;
  clear: () => void;
  // --- nome ---
  nameResults: NameResult[];
  nameLoading: boolean;
  nameTotal: number;
  // --- conteúdo ---
  contentScope: string | null;
  contentResults: SearchMatch[] | null;
  contentLoading: boolean;
  contentScanned: number;
  contentMatchedFiles: number;
  contentTruncated: boolean;
  contentError: string | null;
}

export function useRepoSearch(): UseRepoSearch {
  const selected = useRepoBrowserStore((s) => s.selected);
  const activeLocation = useRepoBrowserStore((s) => s.activeLocation);
  const fetchSubtree = useRepoBrowserStore((s) => s.fetchSubtree);

  const [mode, setModeState] = useState<SearchMode>("name");
  const [query, setQuery] = useState("");

  // Escopo vivo: pasta selecionada (ou seu pai, se for arquivo) ou a localização.
  const scope = useMemo(() => {
    if (selected) return selected.kind === "dir" ? selected.url : dirName(selected.url);
    return activeLocation;
  }, [selected, activeLocation]);

  // --- busca por nome (client-side, com cache da subárvore por escopo) ---
  const subtreeCache = useRef(new Map<string, ListEntry[]>());
  const [nameResults, setNameResults] = useState<NameResult[]>([]);
  const [nameTotal, setNameTotal] = useState(0);
  const [nameLoading, setNameLoading] = useState(false);

  useEffect(() => {
    if (mode !== "name") return;
    const q = query.trim().toLowerCase();
    if (!q || !scope) {
      setNameResults([]);
      setNameTotal(0);
      setNameLoading(false);
      return;
    }
    let alive = true;
    const run = async () => {
      let entries = subtreeCache.current.get(scope);
      if (!entries) {
        setNameLoading(true);
        entries = await fetchSubtree(scope);
        if (!alive) return;
        subtreeCache.current.set(scope, entries);
        setNameLoading(false);
      }
      const matched: NameResult[] = [];
      for (const e of entries) {
        const rel = e.name;
        const leaf = rel.split("/").pop() ?? rel;
        if (
          decodeUrlSafe(leaf).toLowerCase().includes(q) ||
          decodeUrlSafe(rel).toLowerCase().includes(q)
        ) {
          matched.push({
            node: { url: `${scope}/${rel}`, name: leaf, kind: nodeKind(e.kind), size: e.size },
            rel,
          });
        }
      }
      if (!alive) return;
      setNameTotal(matched.length);
      setNameResults(matched.slice(0, NAME_RESULTS_LIMIT));
    };
    const t = setTimeout(run, 250); // debounce
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [mode, query, scope, fetchSubtree]);

  // --- busca por conteúdo (manual; progresso via `op-progress`) ---
  const [contentScope, setContentScope] = useState<string | null>(null);
  const [contentResults, setContentResults] = useState<SearchMatch[] | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentScanned, setContentScanned] = useState(0);
  const [contentMatchedFiles, setContentMatchedFiles] = useState(0);
  const [contentTruncated, setContentTruncated] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const resetContent = useCallback(() => {
    setContentScope(null);
    setContentResults(null);
    setContentLoading(false);
    setContentScanned(0);
    setContentMatchedFiles(0);
    setContentTruncated(false);
    setContentError(null);
    unlistenRef.current?.();
    unlistenRef.current = null;
  }, []);

  const submit = useCallback(async () => {
    if (mode !== "content") return;
    const q = query.trim();
    if (q.length < 2 || !scope) return;
    unlistenRef.current?.(); // cancela um listener anterior, se houver
    setContentScope(scope);
    setContentResults(null);
    setContentError(null);
    setContentTruncated(false);
    setContentMatchedFiles(0);
    setContentScanned(0);
    setContentLoading(true);
    try {
      // Escuta o progresso ANTES do invoke (o backend emite durante a varredura).
      unlistenRef.current = await listen<OpProgress>("op-progress", (e) => {
        if (e.payload.op === "search") setContentScanned(e.payload.count);
      });
      const res = await api.searchContent(scope, q);
      setContentResults(res.matches);
      setContentMatchedFiles(res.filesMatched);
      setContentTruncated(res.truncated);
    } catch (err) {
      setContentError(friendlyErrorMessage(err));
    } finally {
      setContentLoading(false);
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  }, [mode, query, scope]);

  // Garante a remoção do listener ao desmontar.
  useEffect(() => () => unlistenRef.current?.(), []);

  const setMode = useCallback(
    (m: SearchMode) => {
      setModeState(m);
      resetContent(); // troca de modo não arrasta resultados obsoletos
    },
    [resetContent],
  );

  const clear = useCallback(() => {
    setQuery("");
    setNameResults([]);
    setNameTotal(0);
    setNameLoading(false);
    resetContent();
  }, [resetContent]);

  const active =
    mode === "name"
      ? query.trim().length > 0
      : contentLoading || contentResults !== null || contentError !== null;

  return {
    mode,
    query,
    scope,
    active,
    setMode,
    setQuery,
    submit,
    clear,
    nameResults,
    nameLoading,
    nameTotal,
    contentScope,
    contentResults,
    contentLoading,
    contentScanned,
    contentMatchedFiles,
    contentTruncated,
    contentError,
  };
}
