import type { ForecastSlot } from "@/lib/api-types";

/** 모든 시각은 한국 표준시(KST)로 표시 */
const KST = { timeZone: "Asia/Seoul" } as const;

/** 14:32:05 */
export const fmtTimeSec = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString("ko-KR", { ...KST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "-";

/** 11. 26. 14:00 */
export const fmtDateTime = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", { ...KST, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    : "-";

/** 현재 시각이 속한 시간대 이후의 예보시각들 (nowMs가 없으면 빈 배열) */
export function upcomingSlots(slots: ForecastSlot[] | undefined, nowMs: number | null): ForecastSlot[] {
  if (!slots || nowMs === null) return [];
  const hourStart = Math.floor(nowMs / 3_600_000) * 3_600_000;
  return slots.filter((s) => new Date(s.forecastAt).getTime() >= hourStart);
}
