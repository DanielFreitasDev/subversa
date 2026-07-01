/**
 * Badge com a codificação de um arquivo (UTF-8 / ISO-8859-1). Use de dois jeitos:
 * passe `encoding` quando já souber (ex.: o editor, que detecta ao abrir), ou
 * passe `path` para detectar sob demanda via `api.detectEncoding` (ex.: cabeçalho
 * de cada arquivo no diff). ISO-8859-1 sai em âmbar para destacar os arquivos
 * propensos a mojibake; UTF-8 fica discreto. Some para binário/desconhecido.
 */

import { useEffect, useState } from "react";

import * as api from "@/lib/api";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  "utf-8": "UTF-8",
  "iso-8859-1": "ISO-8859-1",
};

// A codificação de um arquivo quase nunca muda durante a sessão e o mesmo arquivo
// pode aparecer em vários cabeçalhos — cacheia por caminho para não reler do disco.
const cache = new Map<string, string>();

export function EncodingBadge({
  path,
  encoding: given,
  className,
}: {
  path?: string;
  encoding?: string;
  className?: string;
}) {
  const [enc, setEnc] = useState<string | undefined>(
    given ?? (path ? cache.get(path) : undefined),
  );

  useEffect(() => {
    if (given !== undefined) {
      setEnc(given);
      return;
    }
    if (!path) return;
    const hit = cache.get(path);
    if (hit !== undefined) {
      setEnc(hit);
      return;
    }
    let alive = true;
    api
      .detectEncoding(path)
      .then((e) => {
        cache.set(path, e);
        if (alive) setEnc(e);
      })
      .catch(() => alive && setEnc("unknown"));
    return () => {
      alive = false;
    };
  }, [path, given]);

  const label = enc ? LABELS[enc] : undefined;
  if (!label) return null; // binário/desconhecido/carregando → nada

  const latin1 = enc === "iso-8859-1";
  return (
    <span
      className={cn(
        "shrink-0 select-none rounded border px-1.5 py-0.5 font-mono text-[10.5px] leading-none",
        latin1 ? "border-warn/40 bg-warn/10 text-warn" : "border-line text-faint",
        className,
      )}
      title={
        latin1
          ? "Arquivo em ISO-8859-1 (latino-1) — preservado ao editar/salvar"
          : "Arquivo em UTF-8"
      }
    >
      {label}
    </span>
  );
}
