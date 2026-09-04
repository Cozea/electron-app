import { useCallback, useEffect, useState } from "react";

import type { DevAppInstallationV3 } from "@shared/devAppInstallationV3";

export function useDevAppInstallations() {
  const [installations, setInstallations] = useState<DevAppInstallationV3[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.devApp.listInstallations();
      if (!result.success) throw new Error(result.error);
      setInstallations(result.installations);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "DevApp installations could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void refresh();
    const unsubscribe = window.electronAPI.devApp.onInstallationsChanged((next) => {
      if (!mounted) return;
      setInstallations(next);
      setLoading(false);
      setError(null);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [refresh]);

  return { installations, loading, error, refresh };
}
