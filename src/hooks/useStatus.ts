import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "@/lib/api";
import type { StatusResult } from "@/lib/types";

/** Carrega e mantém o `svn status` de uma working copy. */
export function useStatus(path: string | undefined) {
  const [data, setData] = useState<StatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aliveRef = useRef(true);
  // Token de requisição: entre dois reload() do mesmo path (ex.: local e depois
  // remoto), só o mais recente pode escrever — o último a iniciar vence.
  const reqRef = useRef(0);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(
    async (remote = false) => {
      if (!path) return;
      const req = ++reqRef.current;
      const ok = () => aliveRef.current && req === reqRef.current;
      setLoading(true);
      setError(null);
      try {
        const r = await api.getStatus(path, remote);
        if (ok()) setData(r);
      } catch (e) {
        if (ok()) setError(String(e));
      } finally {
        if (ok()) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    setData(null);
    reload(false);
  }, [path, reload]);

  return { data, loading, error, reload };
}
