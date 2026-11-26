"use client";

import { useEffect, useState } from "react";

type Loaded<T> = { key: string; data?: T; error?: string; fetchedAt?: string };

/**
 * 내부 API Route(/api/...)를 호출하는 훅.
 * refreshToken이 바뀌면 다시 불러오고, 새로 불러오는 동안·실패 시에도 직전 데이터를 유지합니다.
 */
export function useApi<T>(url: string | null, refreshToken = 0) {
  const key = `${url}#${refreshToken}`;
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);

  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || "error" in json) throw new Error(json?.error ?? `요청 실패 (HTTP ${res.status})`);
        setLoaded({ key, data: json.data as T, fetchedAt: json.fetchedAt });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = e instanceof Error && e.message !== "Failed to fetch" ? e.message : "서버에 연결하지 못했습니다.";
        setLoaded((prev) => ({ ...prev, key, error: message }));
      });
    return () => ctrl.abort();
  }, [url, key]);

  return {
    data: loaded?.data,
    fetchedAt: loaded?.fetchedAt,
    error: loaded?.key === key ? loaded.error : undefined,
    loading: url !== null && loaded?.key !== key,
  };
}
