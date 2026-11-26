import "server-only";

/**
 * 클라이언트(IP)별 요청 속도 제한 — 토큰 버킷 방식.
 * - 버킷마다 최대 `capacity`번까지 연달아 요청할 수 있고, 초당 `refillPerSec`개씩 다시 채워집니다.
 * - `perDay`가 있으면 IP별 하루(KST) 요청 수도 제한합니다.
 *
 * 한계: 서버 메모리에 저장하므로 서버를 여러 대로 늘리면 서버마다 따로 셉니다(공유하려면 Redis 등 필요).
 * IP는 프록시가 넣어 주는 x-forwarded-for / x-real-ip 헤더를 씁니다. 프록시 없이 직접 노출하면
 * 이 헤더는 위조할 수 있으므로, 외부 API 한도는 quota.ts의 서비스 전체 일일 한도로 따로 지킵니다.
 */

type Rule = { capacity: number; refillPerSec: number; perDay?: number; label: string };

export const RATE_LIMITS = {
  /** 경로 조회: 1회에 카카오 자전거 경로 API 2건 사용 (하루 무료 1,000건) */
  "bike-route": { capacity: 10, refillPerSec: 10 / 60, perDay: 150, label: "자전거 경로 조회" },
  /** 장소 검색: 입력 중 자동 검색 (0.25초 디바운스) */
  places: { capacity: 40, refillPerSec: 40 / 60, label: "장소 검색" },
  /** 그 밖의 조회 (대여소·사고·예보): 서버 캐시를 거치므로 넉넉하게 */
  default: { capacity: 120, refillPerSec: 2, label: "데이터 조회" },
} satisfies Record<string, Rule>;

export type RateBucket = keyof typeof RATE_LIMITS;

type State = { tokens: number; updatedAt: number; day: string; dayCount: number };

const MAX_KEYS = 20_000;
const g = globalThis as typeof globalThis & { __safeBikeRate?: Map<string, State> };
const store = (g.__safeBikeRate ??= new Map<string, State>());

/** KST 기준 날짜 (하루 한도 초기화 기준: 매일 0시 KST) */
export function kstDay(now = Date.now()): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 다음 KST 0시까지 남은 초 */
export function secondsUntilKstMidnight(now = Date.now()): number {
  const k = now + 9 * 3_600_000;
  return Math.max(1, Math.ceil((86_400_000 - (k % 86_400_000)) / 1000));
}

export function clientId(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  return (fwd || real || "local").slice(0, 64);
}

function prune(now: number) {
  if (store.size <= MAX_KEYS) return;
  const today = kstDay(now);
  for (const [k, s] of store) {
    if (s.day !== today) store.delete(k);
    if (store.size <= MAX_KEYS * 0.8) return;
  }
  // 그래도 많으면 오래된 항목부터 정리
  for (const k of store.keys()) {
    store.delete(k);
    if (store.size <= MAX_KEYS * 0.8) return;
  }
}

export type RateResult =
  | { ok: true; limit: number; remaining: number }
  | { ok: false; limit: number; retryAfterSec: number; reason: "burst" | "daily"; label: string };

export function checkRateLimit(id: string, bucket: RateBucket, now = Date.now()): RateResult {
  const rule: Rule = RATE_LIMITS[bucket];
  const key = `${bucket}:${id}`;
  const today = kstDay(now);
  const s = store.get(key) ?? { tokens: rule.capacity, updatedAt: now, day: today, dayCount: 0 };

  // 토큰 다시 채우기
  s.tokens = Math.min(rule.capacity, s.tokens + ((now - s.updatedAt) / 1000) * rule.refillPerSec);
  s.updatedAt = now;
  if (s.day !== today) {
    s.day = today;
    s.dayCount = 0;
  }

  if (rule.perDay !== undefined && s.dayCount >= rule.perDay) {
    store.set(key, s);
    return { ok: false, limit: rule.perDay, retryAfterSec: secondsUntilKstMidnight(now), reason: "daily", label: rule.label };
  }
  if (s.tokens < 1) {
    store.set(key, s);
    return { ok: false, limit: rule.capacity, retryAfterSec: Math.ceil((1 - s.tokens) / rule.refillPerSec), reason: "burst", label: rule.label };
  }

  s.tokens -= 1;
  s.dayCount += 1;
  store.set(key, s);
  prune(now);
  return { ok: true, limit: rule.capacity, remaining: Math.floor(s.tokens) };
}

/**
 * 라우트 핸들러 맨 앞에서 호출. 제한에 걸리면 429 응답을, 통과하면 null을 돌려줍니다.
 * 사용: const limited = rateLimit(request, "bike-route"); if (limited) return limited;
 */
export function rateLimit(request: Request, bucket: RateBucket): Response | null {
  const r = checkRateLimit(clientId(request), bucket);
  if (r.ok) return null;
  const wait = r.retryAfterSec >= 3600 ? `${Math.ceil(r.retryAfterSec / 3600)}시간` : r.retryAfterSec >= 60 ? `${Math.ceil(r.retryAfterSec / 60)}분` : `${r.retryAfterSec}초`;
  const message =
    r.reason === "daily"
      ? `오늘 ${r.label} 요청 한도(${r.limit}회)를 모두 사용했습니다. 내일 0시(한국 시간)에 다시 이용할 수 있습니다.`
      : `${r.label} 요청이 너무 잦습니다. ${wait} 후 다시 시도하세요.`;
  return Response.json(
    { error: message },
    {
      status: 429,
      headers: { "Retry-After": String(r.retryAfterSec), "RateLimit-Limit": String(r.limit), "RateLimit-Remaining": "0" },
    },
  );
}
