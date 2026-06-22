import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "@/lib/api";
import type { StatusResult } from "@/lib/types";

/** Carrega e mantém o `svn status` de uma working copy. */
export function useStatus(path: string | undefined) {
  const [data, setData] = useState<StatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(
    async (remote = false) => {
      if (!path) return;
      setLoading(true);
      setError(null);
      try {
        const r = await api.getStatus(path, remote);
        if (aliveRef.current) setData(r);
      } catch (e) {
        if (aliveRef.current) setError(String(e));
      } finally {
        if (aliveRef.current) setLoading(false);
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
