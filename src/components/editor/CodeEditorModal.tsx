/**
 * Editor de código embutido (modal). Abre o arquivo da cópia de trabalho para
 * edição rápida sem sair do app — realce de sintaxe, busca, múltiplos cursores e
 * desfazer/refazer via CodeMirror 6. Salvar grava no disco (não no servidor): o
 * arquivo aparece como "modificado" na lista, pronto para commitar.
 *
 * Lê o conteúdo ATUAL do arquivo (com as alterações locais) via `api.readTextFile`
 * — diferente do diff/prévia, que mostram a BASE do SVN. O EOL original (LF/CRLF)
 * é detectado e restaurado na gravação para não gerar diffs espúrios. O editor em
 * si (`CmEditor`) é carregado sob demanda (code-splitting), por ser pesado.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, FileCode2, Save } from "lucide-react";

import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Loading } from "@/components/ui/Spinner";
import { HELP } from "@/lib/help";
import { tryRun } from "@/lib/op";
import { baseName } from "@/lib/utils";
import { confirm } from "@/store/confirm";
import { useConfigStore } from "@/store/config";
import { toast } from "@/store/toast";

const CmEditor = lazy(() => import("./CmEditor"));

/** Resolve o modo efetivo (o tema "system" segue a preferência do SO). */
function resolveDark(theme: "dark" | "light" | "system"): boolean {
  if (theme === "system") return !window.matchMedia?.("(prefers-color-scheme: light)").matches;
  return theme !== "light";
}

export function CodeEditorModal({
  open,
  path,
  relPath,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Caminho absoluto do arquivo da cópia de trabalho a editar. */
  path: string | null;
  /** Caminho relativo, só para exibição. */
  relPath?: string | null;
  onClose: () => void;
  /** Chamado após salvar com sucesso (para a lista/diff se atualizarem). */
  onSaved?: () => void;
}) {
  const theme = useConfigStore((s) => s.config?.theme ?? "dark");
  const externalEditor = useConfigStore((s) => s.config?.externalEditor ?? "");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [baseline, setBaseline] = useState("");
  const [eol, setEol] = useState<"\n" | "\r\n">("\n");
  // Codificação detectada na leitura, devolvida ao salvar para preservar o arquivo
  // (ISO-8859-1 continua ISO-8859-1 — não vira UTF-8 sem querer).
  const [encoding, setEncoding] = useState("utf-8");
  const [saving, setSaving] = useState(false);

  const dirty = !loading && !error && text !== baseline;
  const name = relPath ?? (path ? baseName(path) : "");
  const encLabel = encoding === "iso-8859-1" ? "ISO-8859-1" : "UTF-8";

  // Carrega o conteúdo ao abrir / trocar de arquivo. Normaliza CRLF→LF para o
  // editor (o EOL original é restaurado ao salvar).
  useEffect(() => {
    if (!open || !path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setText("");
    setBaseline("");
    api
      .readTextFile(path)
      .then(({ content, encoding: enc }) => {
        if (!alive) return;
        setEncoding(enc);
        const crlf = content.includes("\r\n");
        setEol(crlf ? "\r\n" : "\n");
        const norm = crlf ? content.replace(/\r\n/g, "\n") : content;
        setText(norm);
        setBaseline(norm);
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, path]);

  const isDark = useMemo(() => resolveDark(theme), [theme]);

  const doSave = async () => {
    if (!path || saving || !dirty) return;
    setSaving(true);
    try {
      const restored = eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
      await api.writeTextFile(path, restored, encoding);
      setBaseline(text);
      toast.success("Arquivo salvo", name || undefined);
      onSaved?.();
    } catch (e) {
      toast.error("Falha ao salvar o arquivo", String(e));
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+S salva. Via ref para não reassinar o listener a cada tecla digitada.
  const saveRef = useRef(doSave);
  saveRef.current = doSave;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Fechar com alterações pendentes pede confirmação (Esc, backdrop, X, botão).
  const requestClose = async () => {
    if (saving) return;
    if (dirty) {
      const ok = await confirm({
        title: "Descartar alterações?",
        message: "Você editou este arquivo e ainda não salvou. As mudanças no editor serão perdidas.",
        danger: true,
        confirmLabel: "Descartar",
      });
      if (!ok) return;
    }
    onClose();
  };

  const openExternal = () => {
    if (!path) return;
    void tryRun(
      () => api.openInEditor(path, externalEditor || undefined),
      "Não consegui abrir o editor externo",
    );
  };

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={openExternal} disabled={!path}>
          <ExternalLink className="size-3.5" />
          Abrir no editor externo
        </Button>
        {!loading && !error && (
          <span
            className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-faint"
            title="Codificação do arquivo — preservada ao salvar"
          >
            {encLabel}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={requestClose} disabled={saving}>
          {dirty ? "Descartar" : "Fechar"}
        </Button>
        <Button variant="primary" onClick={doSave} loading={saving} disabled={!dirty}>
          {!saving && <Save className="size-4" />}
          Salvar
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={requestClose}
      size="full"
      locked={saving}
      icon={<FileCode2 className="size-5" />}
      title={name || "Editar arquivo"}
      description={dirty ? "Alterações não salvas · Ctrl+S para salvar" : (path ?? undefined)}
      help={HELP.editor}
      footer={footer}
    >
      <div className="flex h-[78vh] flex-col">
        {loading ? (
          <Loading label="Abrindo o arquivo…" />
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <AlertTriangle className="size-7 text-warn" />
            <div className="text-sm text-ink">Não dá para editar este arquivo aqui.</div>
            <div className="max-w-md text-[12px] text-faint">{error}</div>
            {path && (
              <Button variant="secondary" onClick={openExternal}>
                <ExternalLink className="size-4" />
                Abrir no editor externo
              </Button>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-line">
            <Suspense fallback={<Loading label="Carregando editor…" />}>
              <CmEditor value={text} onChange={setText} path={path ?? ""} isDark={isDark} />
            </Suspense>
          </div>
        )}
      </div>
    </Modal>
  );
}
