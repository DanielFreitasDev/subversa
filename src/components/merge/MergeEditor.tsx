/**
 * Editor de conflitos em 3 painéis (estilo IntelliJ): LOCAL (meu, à esquerda) │
 * RESULTADO (centro, editável) │ SERVIDOR (deles, à direita). As mudanças que não
 * brigam entram sozinhas; cada conflito real é destacado e resolvido trecho a
 * trecho (escolher um lado, juntar ambos, descartar ou editar na mão). Ao salvar,
 * grava o resultado e marca o conflito como resolvido (`svn resolve`).
 *
 * As três versões vêm de `api.conflictDetails`; a classificação mudança×conflito é
 * feita pelo motor `diff3` (`@/lib/merge3`). Só conflitos de TEXTO abrem aqui;
 * binário/árvore/propriedade caem nas opções rápidas (`onFallback`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, GitMerge, ListChecks, Save } from "lucide-react";

import * as api from "@/lib/api";
import { tokenizeText, type Span } from "@/components/diff/highlight";
import { Button } from "@/components/ui/Button";
import { Loading } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import { HELP } from "@/lib/help";
import { reportOutput, tryRun } from "@/lib/op";
import { diff3, detectEol, fromLines, toLines, type MergeRegion } from "@/lib/merge3";
import type { ConflictDetails } from "@/lib/types";
import { baseName, cn } from "@/lib/utils";
import { MergeBlock, type Choice } from "./MergeBlock";

/** Resolução de uma região: o lado escolhido (+ texto, quando editado à mão). */
interface Res {
  choice: Choice;
  text?: string;
}

/** Acima disto, uma região estável (inalterada) é dobrada para focar nas mudanças. */
const STABLE_COLLAPSE = 8;

const NULLS = (n: number): null[] => new Array(n).fill(null);

/** Fatia os spans de um lado (alinhados 1:1 com as linhas) para uma região. */
function sliceSpans(spans: Span[][] | null, start: number, count: number): (Span[] | null)[] {
  if (!spans) return NULLS(count);
  return Array.from({ length: count }, (_, k) => spans[start + k] ?? null);
}

/** Estado inicial: mudanças não-conflitantes já aplicadas; conflitos pendentes. */
function defaultRes(regions: MergeRegion[]): Record<number, Res> {
  const out: Record<number, Res> = {};
  regions.forEach((r, i) => {
    if (r.kind === "left" || r.kind === "both") out[i] = { choice: "left" };
    else if (r.kind === "right") out[i] = { choice: "right" };
    // conflict / stable ficam de fora (pendente / sempre base).
  });
  return out;
}

export function MergeEditor({
  open,
  path,
  onClose,
  onResolved,
  onFallback,
}: {
  open: boolean;
  path: string | null;
  onClose: () => void;
  onResolved: () => void;
  /** Conflito não-texto (árvore/propriedade/binário): abrir as opções rápidas. */
  onFallback: (path: string) => void;
}) {
  const [details, setDetails] = useState<ConflictDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [res, setRes] = useState<Record<number, Res>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Carrega as três versões ao abrir / trocar de arquivo.
  useEffect(() => {
    if (!open || !path) return;
    let alive = true;
    setDetails(null);
    setError(null);
    setLoading(true);
    api
      .conflictDetails(path)
      .then((d) => alive && setDetails(d))
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, path]);

  // Modelo derivado (regiões + tokens + índices), memoizado por `details`.
  const model = useMemo(() => {
    if (!details || details.kind !== "text") return null;
    if (details.base == null || details.mine == null || details.theirs == null) return null;
    const baseLines = toLines(details.base).lines;
    const mine = toLines(details.mine);
    const theirsLines = toLines(details.theirs).lines;
    const regions = diff3(baseLines, mine.lines, theirsLines);

    const baseSpans = tokenizeText(baseLines.join("\n"), details.path);
    const mineSpans = tokenizeText(mine.lines.join("\n"), details.path);
    const theirsSpans = tokenizeText(theirsLines.join("\n"), details.path);

    let b = 0;
    let m = 0;
    let t = 0;
    const starts = regions.map((r) => {
      const s = { base: b, mine: m, theirs: t };
      b += r.base.length;
      m += r.mine.length;
      t += r.theirs.length;
      return s;
    });

    return {
      regions,
      baseSpans,
      mineSpans,
      theirsSpans,
      starts,
      eol: detectEol(details.mine),
      trailingEol: mine.trailingEol,
    };
  }, [details]);

  // (Re)inicializa as decisões quando o modelo muda.
  useEffect(() => {
    if (model) setRes(defaultRes(model.regions));
    setEditing(null);
    setActive(null);
    setExpanded(new Set());
  }, [model]);

  const regions = model?.regions ?? [];
  const pendingCount = regions.reduce(
    (n, r, i) => n + (r.kind === "conflict" && !res[i] ? 1 : 0),
    0,
  );

  /** Linhas resolvidas de uma região, conforme a decisão atual. */
  const resolvedLines = useCallback(
    (i: number): string[] => {
      const r = regions[i];
      if (!r) return [];
      if (r.kind === "stable") return r.base;
      const c = res[i];
      if (!c) return [];
      switch (c.choice) {
        case "left":
          return r.mine;
        case "right":
          return r.theirs;
        case "both":
          return [...r.mine, ...r.theirs];
        case "base":
          return r.base;
        case "custom":
          return toLines(c.text ?? "").lines;
      }
    },
    [regions, res],
  );

  const choose = (i: number, choice: Choice) => {
    setEditing(null);
    setRes((prev) => ({ ...prev, [i]: { choice } }));
  };

  const startEdit = (i: number) => {
    setActive(i);
    setDraft(resolvedLines(i).join("\n"));
    setEditing(i);
    setRes((prev) => ({ ...prev, [i]: { choice: "custom", text: resolvedLines(i).join("\n") } }));
  };

  const changeDraft = (i: number, text: string) => {
    setDraft(text);
    setRes((prev) => ({ ...prev, [i]: { choice: "custom", text } }));
  };

  // Ações em massa da barra de ferramentas.
  const applyAllNonConflicting = () => setRes(defaultRes(regions));
  const takeAllConflicts = (choice: "left" | "right") =>
    setRes((prev) => {
      const next = { ...prev };
      regions.forEach((r, i) => {
        if (r.kind === "conflict") next[i] = { choice };
      });
      return next;
    });

  // Navegação por teclado entre conflitos (n / p), como no IntelliJ.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (editing !== null) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key !== "n" && e.key !== "p") return;
      const conflicts = regions.flatMap((r, i) => (r.kind === "conflict" ? [i] : []));
      if (!conflicts.length) return;
      e.preventDefault();
      const cur = active ?? -1;
      const target =
        e.key === "n"
          ? (conflicts.find((i) => i > cur) ?? conflicts[0])
          : ([...conflicts].reverse().find((i) => i < cur) ?? conflicts[conflicts.length - 1]);
      setActive(target);
      document.getElementById(`mblk-${target}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, editing, regions, active]);

  const onSave = async () => {
    if (!model || !path || pendingCount > 0) return;
    const lines: string[] = [];
    regions.forEach((_, i) => lines.push(...resolvedLines(i)));
    const text = fromLines(lines, model.eol, model.trailingEol);
    setSaving(true);
    const out = await tryRun(() => api.resolveWithContent(path, text), "Falha ao salvar a resolução");
    setSaving(false);
    if (out && reportOutput(out, "Conflito resolvido")) {
      onResolved();
      onClose();
    }
  };

  const quickResolve = async (accept: "mine-full" | "theirs-full") => {
    if (!path) return;
    setSaving(true);
    const out = await tryRun(() => api.resolve(path, accept), "Falha ao resolver");
    setSaving(false);
    if (out && reportOutput(out, "Conflito resolvido")) {
      onResolved();
      onClose();
    }
  };

  // Conteúdo não-texto / não-carregável → cai nas opções rápidas.
  const fallbackNeeded = !loading && !error && details != null && model == null;

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[12px] text-faint">
        {model && (
          <>
            <span>Ficar com:</span>
            <button
              onClick={() => quickResolve("mine-full")}
              disabled={saving}
              className="rounded border border-line px-2 py-0.5 text-mod hover:bg-panel-2 disabled:opacity-50"
            >
              Minha versão
            </button>
            <button
              onClick={() => quickResolve("theirs-full")}
              disabled={saving}
              className="rounded border border-line px-2 py-0.5 text-info hover:bg-panel-2 disabled:opacity-50"
            >
              Do servidor
            </button>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        {model && (
          <Button variant="primary" onClick={onSave} loading={saving} disabled={pendingCount > 0}>
            {!saving && <Save className="size-4" />}
            Salvar resolução
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      locked={saving}
      icon={<GitMerge className="size-5" />}
      title="Resolver conflito"
      description={path ? baseName(path) : undefined}
      help={HELP.mergeEditor}
      footer={footer}
    >
      <div className="flex h-[78vh] flex-col">
        {loading ? (
          <Loading label="Lendo as três versões…" />
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <AlertTriangle className="size-7 text-conflict" />
            <div className="text-sm text-ink">Não consegui carregar o conflito.</div>
            <div className="max-w-md text-[12px] text-faint">{error}</div>
            {path && (
              <Button variant="secondary" onClick={() => onFallback(path)}>
                Abrir opções rápidas
              </Button>
            )}
          </div>
        ) : fallbackNeeded ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <AlertTriangle className="size-7 text-warn" />
            <div className="text-sm text-ink">
              {details?.binary
                ? "Arquivo binário — não dá para mesclar linha a linha."
                : details?.hasTreeConflict
                  ? "Conflito de árvore (arquivo movido/apagado) — resolva pelas opções rápidas."
                  : "Este conflito não pode ser editado em 3 painéis."}
            </div>
            {path && (
              <Button variant="secondary" onClick={() => onFallback(path)}>
                Abrir opções rápidas
              </Button>
            )}
          </div>
        ) : model ? (
          <>
            {/* Barra de ferramentas */}
            <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2.5">
              <Button variant="outline" size="sm" onClick={applyAllNonConflicting}>
                <ListChecks className="size-3.5" />
                Aceitar não-conflitantes
              </Button>
              <Button variant="outline" size="sm" onClick={() => takeAllConflicts("left")}>
                Tudo: meu
              </Button>
              <Button variant="outline" size="sm" onClick={() => takeAllConflicts("right")}>
                Tudo: servidor
              </Button>
              <div className="ml-auto flex items-center gap-2 text-[12px]">
                <span className="text-faint">n/p: pular conflito</span>
                {pendingCount > 0 ? (
                  <span className="rounded-full bg-conflict/15 px-2 py-0.5 font-medium text-conflict">
                    {pendingCount} conflito{pendingCount > 1 ? "s" : ""} restante
                    {pendingCount > 1 ? "s" : ""}
                  </span>
                ) : (
                  <span className="rounded-full bg-add/15 px-2 py-0.5 font-medium text-add">
                    Sem conflitos pendentes
                  </span>
                )}
              </div>
            </div>

            {/* Corpo: grid de 3 colunas com cabeçalho fixo */}
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="grid grid-cols-3">
                {(["LOCAL (meu)", "RESULTADO (editável)", "SERVIDOR (deles)"] as const).map(
                  (h, idx) => (
                    <div
                      key={h}
                      className={cn(
                        "sticky top-0 z-10 bg-panel px-3 py-1.5 text-[11px] font-semibold tracking-wide text-muted",
                        idx === 1 && "border-x border-line",
                      )}
                    >
                      {h}
                      {idx === 0 && details?.baseLabel && (
                        <span className="ml-2 font-normal text-faint">ancestral: {details.baseLabel}</span>
                      )}
                      {idx === 2 && details?.theirsLabel && (
                        <span className="ml-2 font-normal text-faint">{details.theirsLabel}</span>
                      )}
                    </div>
                  ),
                )}

                {regions.map((r, i) => {
                  // Região estável longa: dobra para focar nas mudanças.
                  if (
                    r.kind === "stable" &&
                    r.base.length > STABLE_COLLAPSE &&
                    !expanded.has(i)
                  ) {
                    return (
                      <button
                        key={i}
                        onClick={() => setExpanded((s) => new Set(s).add(i))}
                        className="col-span-3 border-t border-line/60 bg-panel-2/40 py-1 text-center text-[11px] text-faint hover:bg-panel-2"
                      >
                        ⋯ {r.base.length} linhas iguais — mostrar
                      </button>
                    );
                  }

                  const st = model.starts[i];
                  const leftSpans = sliceSpans(model.mineSpans, st.mine, r.mine.length);
                  const rightSpans = sliceSpans(model.theirsSpans, st.theirs, r.theirs.length);

                  // Conteúdo + spans da coluna central conforme a decisão.
                  const choice = r.kind === "stable" ? "base" : res[i]?.choice;
                  let centerLines: string[];
                  let centerSpans: (Span[] | null)[];
                  if (r.kind === "stable" || choice === "base") {
                    centerLines = r.base;
                    centerSpans = sliceSpans(model.baseSpans, st.base, r.base.length);
                  } else if (choice === "left") {
                    centerLines = r.mine;
                    centerSpans = leftSpans;
                  } else if (choice === "right") {
                    centerLines = r.theirs;
                    centerSpans = rightSpans;
                  } else if (choice === "both") {
                    centerLines = [...r.mine, ...r.theirs];
                    centerSpans = [...leftSpans, ...rightSpans];
                  } else if (choice === "custom") {
                    centerLines = toLines(res[i]?.text ?? "").lines;
                    const sp = tokenizeText(centerLines.join("\n"), details!.path);
                    centerSpans = centerLines.map((_, k) => (sp ? (sp[k] ?? null) : null));
                  } else {
                    centerLines = [];
                    centerSpans = [];
                  }

                  return (
                    <MergeBlock
                      key={i}
                      domId={`mblk-${i}`}
                      region={r}
                      leftSpans={leftSpans}
                      rightSpans={rightSpans}
                      centerLines={centerLines}
                      centerSpans={centerSpans}
                      leftNo={st.mine + 1}
                      rightNo={st.theirs + 1}
                      activeChoice={r.kind === "stable" ? undefined : res[i]?.choice}
                      active={active === i}
                      editing={editing === i}
                      draft={draft}
                      onChoose={(c) => choose(i, c)}
                      onStartEdit={() => startEdit(i)}
                      onDraftChange={(text) => changeDraft(i, text)}
                      onActivate={() => setActive(i)}
                    />
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
