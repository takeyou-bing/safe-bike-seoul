import "server-only";

import { ApiError } from "./http";
import { kstDay, secondsUntilKstMidnight } from "./rateLimit";

/**
 * 서비스 전체의 외부 API 일일 호출 한도 (KST 0시 초기화).
 * 캐시에 없어 실제로 외부 API를 부를 때만 셉니다. IP를 바꿔 가며 요청해도 이 한도는 지켜집니다.
 * 기본값은 각 API의 공식 무료 한도보다 약간 낮게 잡아 여유를 둡니다. .env에서 바꿀 수 있습니다.
 *
 * 한계: 서버 메모리에 저장하므로 서버를 재시작하면 0부터 다시 세고, 서버가 여러 대면 서버마다 따로 셉니다.
 */
const QUOTAS = {
  /** 카카오맵 자전거 경로 조회: 공식 무료 1,000건/일 */
  "kakao-bike-route": { env: "KAKAO_BIKE_ROUTE_DAILY_LIMIT", fallback: 900, label: "카카오 자전거 경로" },
  /** 카카오 로컬 키워드 검색: 공식 무료 100,000건/일 */
  "kakao-local": { env: "KAKAO_LOCAL_DAILY_LIMIT", fallback: 90_000, label: "카카오 장소 검색" },
} as const;

export type QuotaName = keyof typeof QUOTAS;

const g = globalThis as typeof globalThis & { __safeBikeQuota?: Map<string, number> };
const used = (g.__safeBikeQuota ??= new Map<string, number>());

function limitOf(name: QuotaName): number {
  const q = QUOTAS[name];
  const v = Number(process.env[q.env]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : q.fallback;
}

/** 외부 호출 직전에 n건을 차감. 한도를 넘으면 외부 API를 부르지 않고 429 오류. */
export function consumeQuota(name: QuotaName, n = 1): void {
  const key = `${name}:${kstDay()}`;
  const count = used.get(key) ?? 0;
  const limit = limitOf(name);
  if (count + n > limit) {
    const e = new ApiError(
      429,
      `오늘 서비스 전체의 ${QUOTAS[name].label} 호출 한도(${limit.toLocaleString()}건)에 도달해 새 조회를 멈췄습니다. 이미 조회된 결과는 계속 볼 수 있으며, 내일 0시(한국 시간)에 다시 열립니다.`,
    );
    e.retryAfterSec = secondsUntilKstMidnight();
    throw e;
  }
  used.set(key, count + n);
  // 지난 날짜 기록 정리
  if (used.size > 20) for (const k of used.keys()) if (!k.endsWith(kstDay())) used.delete(k);
}

/** 오늘 사용량 (개발용 /api/health 표시) */
export function quotaUsage(): Record<QuotaName, { used: number; limit: number }> {
  const day = kstDay();
  return Object.fromEntries(
    (Object.keys(QUOTAS) as QuotaName[]).map((n) => [n, { used: used.get(`${n}:${day}`) ?? 0, limit: limitOf(n) }]),
  ) as Record<QuotaName, { used: number; limit: number }>;
}
