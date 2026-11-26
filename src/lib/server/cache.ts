import "server-only";

/**
 * 서버 메모리 TTL 캐시.
 * - 성공한 결과만 저장합니다 (실패는 캐시하지 않음).
 * - 같은 키의 동시 요청은 하나의 외부 호출로 합칩니다.
 * - Next.js "use cache"와 달리 ApiError 같은 오류 타입·메시지를 그대로 전달합니다.
 * 서버 인스턴스별 메모리이므로 여러 인스턴스로 배포하면 인스턴스마다 따로 캐시됩니다.
 */
type Entry = { value?: unknown; expires: number; pending?: Promise<unknown> };

const MAX_ENTRIES = 500;
const g = globalThis as typeof globalThis & { __safeBikeCache?: Map<string, Entry> };
const store = (g.__safeBikeCache ??= new Map<string, Entry>());

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && "value" in hit && hit.expires > now) return Promise.resolve(hit.value as T);
  if (hit?.pending) return hit.pending as Promise<T>;

  const pending = load().then(
    (value) => {
      store.delete(key);
      store.set(key, { value, expires: Date.now() + ttlMs });
      if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
      return value;
    },
    (e: unknown) => {
      // 실패 시 이전 값(만료됨)은 남겨 두되 대기 상태만 해제
      if (hit && "value" in hit) store.set(key, { value: hit.value, expires: hit.expires });
      else store.delete(key);
      throw e;
    },
  );
  store.set(key, { ...(hit && "value" in hit ? { value: hit.value } : {}), expires: hit?.expires ?? 0, pending });
  return pending;
}
